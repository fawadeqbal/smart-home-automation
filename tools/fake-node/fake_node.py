"""
fake_node.py - pretends to be an ESP8266 board running firmware/home_node.

It speaks exactly the same MQTT protocol (packages/contracts/src/topics.ts), so you can try
adoption, devices, pins, buttons, sensors and voice commands before flashing a real board.

    pip install paho-mqtt
    python tools/fake-node/fake_node.py                         # uses ../../.env for the password
    python tools/fake-node/fake_node.py --id esp-kitchen01 --host 192.168.1.20

Then open the web app > Boards: the board appears under "New boards".

While it runs, type in this window:
    press D5        press the wall button wired to D5 (or GPIO number: press 14)
    trip door       open/close the contact sensor with key "door" (door, motion, leak...)
    temp 31.5       next sensor reading uses this temperature
    state           print every device
    drop            lose the connection abruptly (the broker announces it offline)
    rejoin          connect again after a drop, without restarting (Wi-Fi or internet back)
    quit

Local control (like firmware 2.5.0): with --local-port 8081 it also answers the phone app straight
over HTTP (GET /local/hello, POST /local/state, POST /local/command), checking passes the same way
the board does (apps/api/src/hardware/local-pass.ts). `drop` keeps it answering, like a board whose
internet is down but whose Wi-Fi still works.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import json
import os
import random
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

try:
    import paho.mqtt.client as mqtt
except ImportError:
    sys.exit("Install the MQTT library first:  pip install paho-mqtt")

ROOT = "home/v1"
FIRMWARE = "2.5.0-fake"   # what the fake can do: wall switches, double-press and long press, local control
# Same rules as packages/contracts/src/boards.ts
PINS = {5: "D1", 4: "D2", 14: "D5", 12: "D6", 13: "D7", 16: "D0", 15: "D8", 0: "D3", 2: "D4", 3: "RX", 17: "A0"}
USES = {5: "ois", 4: "ois", 14: "ois", 12: "ois", 13: "ois", 16: "o", 15: "o", 0: "i", 2: "oi", 3: "is", 17: "a"}
NEEDS = {"switch": "o", "dht": "s", "contact": "i", "analog": "a", "toggle_button": "i", "wall_switch": "i"}


def load_env(path: Path) -> dict:
    env = {}
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
    return env


class FakeNode:
    def __init__(self, node_id: str, board: str, host: str, port: int, user: str, password: str,
                 quiet: bool = False, keepalive: int = 15, local_port: int = 0):
        self.node_id, self.board, self.quiet, self.keepalive = node_id, board, quiet, keepalive
        self.local_port = local_port
        self.local_key = ""        # from the server's {"action": "local"} command
        self.local_epoch = 0
        self.nonces: dict[str, float] = {}
        self.offline_src = ""   # set when something changed while the server was away: "local" (phone) or "button"
        self.dropped = False
        self.firmware = FIRMWARE
        self.devices: dict[str, dict] = {}   # key -> {"type", "pin", "settings", "state"}
        self.inputs: dict[int, str] = {}     # pin -> target key ('' for a button that only runs actions)
        self.saved_switches: dict[str, bool] = {}
        self.rev = -1
        self.started = time.time()
        self.connects = 0
        self.next_temperature: float | None = None
        self.telemetry_sec = 60
        self.lock = threading.RLock()
        self.stop = threading.Event()

        self.user, self.password = user, password
        self.client = self.make_client()
        self.host, self.port = host, port

    def make_client(self) -> mqtt.Client:
        client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=self.node_id)
        client.username_pw_set(self.user, self.password)
        client.will_set(self.t("status"), json.dumps({"online": False}), qos=1, retain=True)
        client.on_connect = self.on_connect
        client.on_message = self.on_message
        client.reconnect_delay_set(1, 30)
        return client

    # ------------------------------------------------------------ helpers
    def t(self, *parts: str) -> str:
        return "/".join([ROOT, "nodes", self.node_id, *parts])

    def say(self, text: str, level: str = "info") -> None:
        """Print, and send it as a live log line like the real board does (Boards > Logs)."""
        if not self.quiet and level != "debug":   # sensor readings go to the web app only
            print(f"  [{self.node_id}] {text}", flush=True)
        if self.client.is_connected():
            self.client.publish(self.t("log"), json.dumps(
                {"level": level, "msg": text, "uptime": int(time.time() - self.started)}), qos=0)

    def publish(self, topic: str, payload: dict, retain: bool = False) -> None:
        self.client.publish(topic, json.dumps(payload), qos=1, retain=retain)

    def ip(self) -> str:
        # the real board answers on port 80; the fake says where it listens
        return f"127.0.0.1:{self.local_port}" if self.local_port and self.local_port != 80 else "127.0.0.1"

    def publish_state(self, key: str, src: str, cid: str | None = None) -> None:
        state = dict(self.devices[key]["state"], src=src)
        if cid:
            state["cid"] = cid
        self.publish(self.t("devices", key, "state"), state, retain=True)

    # ------------------------------------------------------------ MQTT
    def start(self) -> None:
        self.client.connect_async(self.host, self.port, keepalive=self.keepalive)
        self.client.loop_start()
        threading.Thread(target=self.sensor_loop, daemon=True).start()
        threading.Thread(target=self.telemetry_loop, daemon=True).start()
        if self.local_port:
            self.serve_local()

    def on_connect(self, client, userdata, flags, reason, properties=None):
        if reason.is_failure:
            self.say(f"broker refused the connection: {reason}")
            return
        self.say(f"connected to {self.host}:{self.port}")
        self.connects += 1
        self.publish(self.t("status"), {"online": True, "fw": self.firmware, "ip": self.ip()}, retain=True)
        self.publish(self.t("announce"), {"board": self.board, "fw": self.firmware, "mac": "02:00:00:00:00:01", "ip": self.ip()}, retain=True)
        client.subscribe([(self.t("config"), 1), (self.t("devices", "+", "set"), 1), (self.t("cmd"), 1)])
        if self.offline_src:   # like the firmware: tell the server what changed while it was away
            with self.lock:
                for key, d in self.devices.items():
                    if d["type"] == "switch":
                        self.publish_state(key, self.offline_src)
            self.offline_src = ""
        self.report()   # fresh health right away, like the firmware

    def on_message(self, client, userdata, msg):
        try:
            payload = json.loads(msg.payload or b"null")
        except ValueError:
            return
        if msg.topic == self.t("config") and isinstance(payload, dict):
            self.apply_config(payload)
        elif msg.topic.endswith("/set") and isinstance(payload, dict):
            self.handle_set(msg.topic.split("/")[-2], payload)
        elif msg.topic == self.t("cmd") and isinstance(payload, dict) and payload.get("action") == "local":
            key, epoch = str(payload.get("key", "")), int(payload.get("epoch", 0))
            if len(key) == 64 and epoch > 0:
                self.local_key, self.local_epoch = key, epoch
                self.say(f"local control key {self.local_tag()} saved")
                self.report()
        elif msg.topic == self.t("cmd") and isinstance(payload, dict) and payload.get("action") == "local-off":
            self.local_key, self.local_epoch = "", 0
            self.say("local control key forgotten")
            self.report()
        elif msg.topic == self.t("cmd") and isinstance(payload, dict) and payload.get("action") == "reboot":
            self.say("reboot requested (ignored by the fake board)")
        elif msg.topic == self.t("cmd") and isinstance(payload, dict) and payload.get("action") == "ota":
            threading.Thread(target=self.fake_ota, args=(str(payload.get("url", "")), str(payload.get("version", "?"))), daemon=True).start()
        elif msg.topic == self.t("cmd") and isinstance(payload, dict) and payload.get("action") == "scan":
            self.say("Wi-Fi scan requested")
            # a real scan takes a few seconds
            threading.Timer(2.5, lambda: self.publish(self.t("network"), {"scan": [
                {"ssid": "HomeWiFi", "rssi": -52, "channel": 6, "secure": True},
                {"ssid": "HomeWiFi-Guest", "rssi": -61, "channel": 6, "secure": True},
                {"ssid": "Upstairs-Extender", "rssi": -68, "channel": 1, "secure": True},
                {"ssid": "Neighbour_2.4", "rssi": -79, "channel": 6, "secure": True},
                {"ssid": "Cafe Free", "rssi": -88, "channel": 11, "secure": False},
            ]})).start()
        elif msg.topic == self.t("cmd") and isinstance(payload, dict) and payload.get("action") == "wifi":
            ssid = str(payload.get("ssid", ""))
            ok = len(str(payload.get("password", ""))) != 9  # a 9-character password "fails", to test the fallback
            self.say(f"Wi-Fi change to {ssid!r} requested -> {'ok' if ok else 'fails'}")
            result = {"ok": ok, "ssid": ssid, "message": "connected, signal -55 dBm" if ok else "wrong password - stayed on \"HomeWiFi\""}
            threading.Timer(6, lambda: self.publish(self.t("network"), {"result": result})).start()  # joining takes a few seconds

    # ------------------------------------------------------------ config (same checks as the firmware)
    def apply_config(self, config: dict) -> None:
        rev = int(config.get("rev", 0))
        used: set[int] = set()
        devices, inputs = {}, {}
        try:
            for d in config.get("devices", []):
                self.check_pin(d["pin"], NEEDS.get(d["type"]), used, d["type"])
                devices[d["key"]] = {"type": d["type"], "pin": d["pin"], "settings": d.get("settings", {}),
                                     "activeLow": d.get("activeLow", False)}
            for i in config.get("inputs", []):
                self.check_pin(i["pin"], NEEDS.get(i["type"]), used, i["type"])
                if i["target"] and i["target"] not in devices:
                    raise ValueError(f"input on pin {i['pin']} targets unknown device {i['target']}")
                inputs[i["pin"]] = i["target"]
        except (ValueError, KeyError) as exc:
            self.publish(self.t("config", "applied"), {"rev": rev, "ok": False, "error": str(exc)})
            self.say(f"config rev {rev} REJECTED: {exc}", "warn")
            return

        with self.lock:
            for key, d in devices.items():
                if d["type"] == "switch":
                    d["state"] = {"on": self.saved_switches.get(key, False)}
                elif d["type"] == "contact":
                    d["state"] = {"active": False}
                elif d["type"] == "analog":
                    d["state"] = {"level": 50, "raw": 512}
                else:
                    d["state"] = {}
            self.devices, self.inputs, self.rev = devices, inputs, rev
            self.telemetry_sec = int(config.get("telemetrySec", 60))
        self.publish(self.t("config", "applied"), {"rev": rev, "ok": True})
        adopted = "adopted" if config.get("adopted") else "waiting to be adopted"
        summary = ", ".join(f"{k}={v['type']}@{PINS[v['pin']]}" for k, v in devices.items()) or "no devices"
        self.say(f"config rev {rev} applied ({adopted}): {summary}")
        for key, d in devices.items():
            if d["type"] == "switch":
                self.publish_state(key, "boot")
            else:
                self.read_sensor(key)

    @staticmethod
    def check_pin(pin: int, need: str | None, used: set[int], what: str) -> None:
        if need is None:
            raise ValueError(f"unknown type {what}")
        if pin not in PINS or need not in USES[pin]:
            raise ValueError(f"GPIO {pin} cannot be used for {what}")
        if pin in used:
            raise ValueError(f"GPIO {pin} used twice")
        used.add(pin)

    # ------------------------------------------------------------ devices
    def handle_set(self, key: str, command: dict) -> None:
        cid = command.get("cid")
        self.say(f"Command for {key} from the server")
        with self.lock:
            device = self.devices.get(key)
            if device is None or device["type"] != "switch":
                self.publish(self.t("devices", key, "state"), {"cid": cid, "src": "remote", "error": "not a switch"})
                return
            if isinstance(command.get("on"), bool):
                device["state"]["on"] = command["on"]
            elif command.get("toggle") is True:
                device["state"]["on"] = not device["state"]["on"]
            else:
                self.publish(self.t("devices", key, "state"), {"cid": cid, "src": "remote", "error": "bad command"})
                return
            self.saved_switches[key] = device["state"]["on"]
            self.publish_state(key, "remote", cid)
        self.say(f"{key} -> {'ON' if device['state']['on'] else 'OFF'} (remote)")

    def press(self, pin: int, gesture: str = "single") -> None:
        """A press ("single", "double", "long") or a wall switch "flip": like the board, a single press or a
        flip toggles its own switch at once, then the gesture goes to the server."""
        with self.lock:
            key = self.inputs.get(pin)
            if key is None:
                self.say(f"no button configured on {PINS.get(pin, pin)}")
                return
            if key and gesture in ("single", "flip"):
                device = self.devices[key]
                device["state"]["on"] = not device["state"]["on"]
                self.saved_switches[key] = device["state"]["on"]
                self.publish_state(key, "button")
                self.say(f"[button {PINS[pin]}] {key} -> {'ON' if device['state']['on'] else 'OFF'}")
            self.publish(self.t("inputs", str(pin), "event"), {"gesture": gesture})

    def read_sensor(self, key: str) -> None:
        with self.lock:
            d = self.devices.get(key)
            if d and d["type"] in ("contact", "analog"):
                if d["type"] == "analog":
                    level = max(0, min(100, d["state"].get("level", 50) + random.randint(-3, 3)))
                    d["state"] = {"level": level, "raw": round(level * 10.23)}
                self.publish_state(key, "sensor")
                return
            if not d or d["type"] != "dht":
                return
            last = d["state"].get("temperature", 26.0)
            temp = self.next_temperature if self.next_temperature is not None else last + random.uniform(-0.3, 0.3)
            self.next_temperature = None
            d["state"] = {"temperature": round(temp, 1), "humidity": round(random.uniform(45, 60), 1)}
            self.publish_state(key, "sensor")
        self.say(f"{key}: {d['state']['temperature']} C, {d['state']['humidity']} %", "debug")

    def sensor_loop(self) -> None:
        last: dict[str, float] = {}
        while not self.stop.is_set():
            now = time.time()
            with self.lock:
                sensors = [(k, d["settings"].get("intervalSec", 30)) for k, d in self.devices.items() if d["type"] == "dht"]
            for key, interval in sensors:
                if now - last.get(key, 0) >= interval:
                    last[key] = now
                    self.read_sensor(key)
            self.stop.wait(1)

    def report(self) -> None:
        """Health, like the real board: uptime since this process started, why it started, connections since."""
        self.publish(self.t("telemetry"), {
            "rssi": random.randint(-70, -50), "heap": random.randint(26000, 32000), "heapFrag": random.randint(3, 12),
            "maxBlock": 22000, "uptime": int(time.time() - self.started), "vcc": random.randint(3250, 3330), "cpuMhz": 80,
            "flashKb": 4096, "sketchKb": 484, "freeSketchKb": 1560, "reset": "Power On", "ssid": "HomeWiFi",
            "channel": 6, "connects": self.connects, "bssid": "A4:2B:B0:1C:7E:22", "gateway": "192.168.1.1", "mac": "02:00:00:00:00:01",
            "local": self.local_tag(),
        })

    # ------------------------------------------------------------ local control (no server in between)
    def local_tag(self) -> str:
        if not self.local_key:
            return ""
        return f"{hashlib.sha256(self.local_key.encode()).hexdigest()[:8]}:{self.local_epoch}"

    def new_nonce(self) -> str:
        now = time.time()
        self.nonces = {n: t for n, t in self.nonces.items() if now - t < 60}
        if len(self.nonces) >= 8:
            self.nonces.pop(min(self.nonces, key=self.nonces.get))
        nonce = os.urandom(8).hex()
        self.nonces[nonce] = now
        return nonce

    def check_pass(self, headers, path: str, body: str) -> tuple[dict | None, str]:
        """(pass, "") when the request is signed by a valid pass for this board, else (None, why)."""
        if not self.local_key:
            return None, "no local key yet"
        p, nonce, sig = headers.get("X-Pass", ""), headers.get("X-Nonce", ""), headers.get("X-Sig", "")
        if self.nonces.pop(nonce, None) is None:
            return None, "unknown or used nonce"
        try:
            info = json.loads(base64.urlsafe_b64decode(p + "=" * (-len(p) % 4)))
        except ValueError:
            return None, "bad pass"
        if info.get("n") != self.node_id or info.get("e") != self.local_epoch:
            return None, "pass for another board or an old pass"
        key = hmac.new(self.local_key.encode(), f"pass:{p}".encode(), hashlib.sha256).hexdigest()
        want = hmac.new(key.encode(), f"{nonce}\n{path}\n{body}".encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(want, sig):
            return None, "bad signature"
        return info, ""

    def local_command(self, info: dict, command: dict) -> tuple[int, dict]:
        key = command.get("key")
        with self.lock:
            device = self.devices.get(key)
            if device is None or key not in info.get("v", []):
                return 404, {"error": "no such device"}
            if key not in info.get("c", []):
                return 403, {"error": "you may not switch this"}
            if device["type"] != "switch":
                return 400, {"error": "not a switch"}
            if isinstance(command.get("on"), bool):
                device["state"]["on"] = command["on"]
            elif command.get("toggle") is True:
                device["state"]["on"] = not device["state"]["on"]
            else:
                return 400, {"error": "bad command"}
            self.saved_switches[key] = device["state"]["on"]
            if self.client.is_connected() and not self.dropped:
                self.publish_state(key, "local")
            else:
                self.offline_src = "local"
        self.say(f"{key} -> {'ON' if device['state']['on'] else 'OFF'} (phone over Wi-Fi, {info.get('u')})")
        return 200, {"ok": True, "key": key, "state": device["state"]}

    def local_state(self, info: dict) -> dict:
        with self.lock:
            return {"id": self.node_id, "devices": [
                {"key": k, "type": d["type"], "state": d["state"]} for k, d in self.devices.items() if k in info.get("v", [])]}

    def serve_local(self) -> None:
        node = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):  # quiet
                pass

            def reply(self, code: int, body: dict) -> None:
                data = json.dumps(body).encode()
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def do_GET(self):
                if self.path != "/local/hello":
                    return self.reply(404, {"error": "not found"})
                self.reply(200, {"id": node.node_id, "fw": node.firmware, "local": bool(node.local_key), "nonce": node.new_nonce()})

            def do_POST(self):
                body = self.rfile.read(min(int(self.headers.get("Content-Length") or 0), 512)).decode("utf-8", "replace")
                if self.path not in ("/local/state", "/local/command"):
                    return self.reply(404, {"error": "not found"})
                info, why = node.check_pass(self.headers, self.path, body)
                if info is None:
                    return self.reply(401, {"error": why})
                if self.path == "/local/state":
                    return self.reply(200, node.local_state(info))
                try:
                    command = json.loads(body or "{}")
                except ValueError:
                    return self.reply(400, {"error": "bad JSON"})
                code, out = node.local_command(info, command if isinstance(command, dict) else {})
                self.reply(code, out)

        server = ThreadingHTTPServer(("127.0.0.1", self.local_port), Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.say(f"local control on http://127.0.0.1:{self.local_port}")

    def telemetry_loop(self) -> None:
        time.sleep(2)
        self.report()   # once more shortly after start (by then the server usually has it adopted)
        while not self.stop.wait(self.telemetry_sec):
            self.report()

    def fake_ota(self, url: str, version: str) -> None:
        """Downloads the image like the real board, checks the x-MD5 header, then 'restarts' on the new version."""
        import hashlib
        import urllib.request
        self.say(f"firmware update to {version} from {url.split('?')[0]}")
        try:
            with urllib.request.urlopen(url, timeout=20) as r:
                data = r.read()
                md5 = r.headers.get("x-MD5", "")
            if hashlib.md5(data).hexdigest() != md5:
                raise ValueError("MD5 mismatch")
            self.publish(self.t("network"), {"ota": {"ok": True, "version": version, "message": "installed, restarting"}})
            time.sleep(0.5)
            # like the real board: after restarting it runs (and reports) the version compiled into the file
            import re
            stamp = re.search(rb"@@HOMENODE-FW:([\w.+-]{1,40})@@", data)
            running = stamp.group(1).decode() if stamp else self.firmware
            self.firmware = running
            self.publish(self.t("announce"), {"board": self.board, "fw": running, "mac": "02:00:00:00:00:01", "ip": "127.0.0.1"}, retain=True)
            self.say(f"now running firmware {running}")
        except Exception as exc:  # noqa: BLE001
            self.publish(self.t("network"), {"ota": {"ok": False, "version": version, "message": str(exc)[:150]}})

    def drop(self) -> None:
        """Abrupt disconnect: the broker publishes our Last Will (offline)."""
        self.dropped = True
        self.client.loop_stop()
        self.client.socket().close() if self.client.socket() else None
        self.say("connection dropped; the broker will announce this board offline")

    def rejoin(self) -> None:
        """Connect again after `drop`, without restarting (uptime goes on): like the Wi-Fi coming back."""
        # a fresh connection (with its Last Will) like the firmware makes, while uptime goes on
        self.dropped = False
        self.client = self.make_client()
        self.client.connect_async(self.host, self.port, keepalive=self.keepalive)
        self.client.loop_start()
        self.say("connection back after a drop")

    def close(self) -> None:
        self.stop.set()
        self.publish(self.t("status"), {"online": False}, retain=True)
        time.sleep(0.2)
        self.client.disconnect()
        self.client.loop_stop()


def pin_from(text: str) -> int | None:
    text = text.upper()
    for gpio, label in PINS.items():
        if text == label:
            return gpio
    return int(text) if text.isdigit() else None


def main() -> None:
    env = load_env(Path(__file__).resolve().parents[2] / ".env")
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--id", default="esp-fake01", help="node id (the real board uses esp-<chip id>)")
    parser.add_argument("--board", default="NODEMCU_V2")
    # defaults from MQTT_URL (mqtt://host:port), like the API
    broker = urlparse(os.environ.get("MQTT_URL") or env.get("MQTT_URL") or "mqtt://localhost:1883")
    parser.add_argument("--host", default=broker.hostname or "localhost")
    parser.add_argument("--port", type=int, default=broker.port or 1883)
    parser.add_argument("--user", default="node")
    parser.add_argument("--password", default=env.get("MQTT_NODE_PASSWORD", ""))
    parser.add_argument("--keepalive", type=int, default=15, help="seconds; the broker declares the board offline after 1.5x this")
    parser.add_argument("--no-console", action="store_true", help="run without reading commands (for tests)")
    parser.add_argument("--local-port", type=int, default=0, help="answer the phone app over HTTP on this port (0: off)")
    args = parser.parse_args()

    node = FakeNode(args.id, args.board, args.host, args.port, args.user, args.password, keepalive=args.keepalive,
                    local_port=args.local_port)
    node.start()
    print(f"Fake board {args.id} -> mqtt://{args.host}:{args.port}. Type 'press D5', 'temp 30', 'state', 'drop', 'quit'.")
    try:
        if args.no_console:
            while True:
                time.sleep(1)
        for line in sys.stdin:
            parts = line.split()
            if not parts:
                continue
            cmd = parts[0].lower()
            if cmd == "quit":
                break
            if cmd in ("press", "double", "hold", "flip") and len(parts) > 1 and (pin := pin_from(parts[1])) is not None:
                node.press(pin, {"press": "single", "double": "double", "hold": "long", "flip": "flip"}[cmd])
            elif cmd == "temp" and len(parts) > 1:
                node.next_temperature = float(parts[1])
            elif cmd == "trip" and len(parts) > 1:
                key = parts[1]
                d = node.devices.get(key)
                if d and d["type"] == "contact":
                    d["state"] = {"active": not d["state"].get("active", False)}
                    node.publish_state(key, "sensor")
                    print(f"  {key} -> {d['state']}")
                else:
                    print(f"  no contact sensor called {key}")
            elif cmd == "state":
                for k, d in node.devices.items():
                    print(f"  {k}: {d['type']} on {PINS[d['pin']]} -> {d['state']}")
            elif cmd == "drop":
                node.drop()
            elif cmd == "rejoin":
                node.rejoin()
            else:
                print("  commands: press D5 | double D5 | hold D5 | flip D6 | temp 30 | trip <contact key> | state | drop | quit")
    except KeyboardInterrupt:
        pass
    if not node.stop.is_set():
        node.close()


if __name__ == "__main__":
    main()

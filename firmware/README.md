# Home node firmware (ESP8266) — version 2

One firmware for every board. You flash it once; after that:

- **Wi‑Fi and the server** are typed into the board's own setup page (no passwords in code)
- **devices, pins and wall buttons** are set in the web app, sent to the board over MQTT, checked, applied and saved in flash
- the board keeps working from flash when Wi‑Fi or the server is down (wall buttons, last states)

## 1. Arduino IDE (once)

1. **File → Preferences → Additional boards manager URLs:** `https://arduino.esp8266.com/stable/package_esp8266com_index.json`
2. **Boards Manager:** install **esp8266** by ESP8266 Community (3.1.x)
3. **Library Manager:** install
   - **ArduinoJson** by Benoit Blanchon (7.x)
   - **PubSubClient** by Nick O'Leary (2.8)
   - **WiFiManager** by tzapu (2.0.x)
   - **DHT sensor library** by Adafruit (also installs **Adafruit Unified Sensor** — accept it)
4. **Tools → Board:** *NodeMCU 1.0 (ESP-12E Module)* or *LOLIN(WEMOS) D1 R2 & mini*. Keep the default **Flash Size (4MB, FS:2MB)**.

If you use a Wemos D1 mini, change `BOARD_TYPE` in `config.h` to `"WEMOS_D1_MINI"` (you can also pick the board type when adopting it in the web app).

## 2. Flash

Open `home_node/home_node.ino`, plug the board in by USB, choose its COM port, **Upload**. Open the **Serial Monitor at 115200 baud**.

## 3. Connect it to your server (the setup page)

The first time, or whenever you hold the **FLASH** button for **5 seconds** while the board runs (firmware 2.3.0+: the LED blinks fast while you hold, then stays on), or hold it during the first 3 seconds after power‑on while the LED blinks fast — press it *after* releasing RST: FLASH held while the board resets starts the chip's programming mode instead:

1. On your phone, join the Wi‑Fi **`HomeNode-xxxxxx`**. The setup page opens (or browse to `http://192.168.4.1`).
2. **Configure WiFi** → pick your home Wi‑Fi (2.4 GHz) and type its password.
3. Fill in the server fields:

| Field | While testing on your PC | In the cloud (later) |
|---|---|---|
| Server address | your PC's IP, e.g. `192.168.1.20` (run `ipconfig` on the PC) | `mqtt.your-domain.com` |
| Port | `1883` | `8883` |
| Board login | `node` | `node` |
| Board password | `MQTT_NODE_PASSWORD` from `.env` | same |
| Encrypted | `no` | `yes` |

4. **Save**. The board joins your Wi‑Fi and connects. The Serial Monitor shows:
   ```
   INFO  Node id esp-3c71bf, server 192.168.1.20:1883
   INFO  Connected to the server
   INFO  Configuration rev 0 applied: 0 devices (waiting to be adopted in the web app)
   ```

**Windows Firewall:** the board must reach port 1883 on your PC. Allow it once (PowerShell as administrator):
```powershell
New-NetFirewallRule -DisplayName "Home MQTT" -Direction Inbound -Protocol TCP -LocalPort 1883 -Action Allow -Profile Private
```

## 4. Adopt it and add devices (web app → Boards)

The board appears under **New boards** within seconds. **Adopt** it, then **Add device** / **Add wall button**. The form only offers pins that are safe and free. The board applies each change in about a second ("Up to date").

## 5. Wiring

| Part | Board pin | Notes |
|---|---|---|
| Relay module **IN** (bulb) | **D1** (GPIO 5) | VCC → VIN (5 V relay modules), GND → GND. Most modules switch on LOW: keep "Switches on LOW" |
| **DHT22 / DHT11** DATA | **D2** (GPIO 4) | VCC → **3V3**, GND → GND. A bare 4‑pin sensor needs a 10 kΩ resistor DATA → 3V3; 3‑pin modules have it |
| Wall **push‑button** | **D5** (GPIO 14) | Other leg → GND. No resistor needed (internal pull‑up) |
| Free for more | D6, D7, D0 (output only), D3/D4 (buttons only) | D8, RX, TX are never offered |

> ⚠️ **Mains (220 V) can kill.** Test with an LED or a 12 V lamp first. Wire the bulb only with the breaker off, inside a closed enclosure, or let an electrician do it.

## 6. What the LED means

| Built‑in LED | Meaning |
|---|---|
| fast blink, first 3 s | setup window: hold FLASH now to open the setup page |
| fast blink while you hold FLASH, then on | 5‑second press: let go, the setup hotspot opens (2.3.0+) |
| fast blink | no Wi‑Fi |
| slow blink | Wi‑Fi OK, server not reachable (check address, password, firewall) |
| off | connected |

## 6b. Live logs (no USB cable needed)

Everything the board prints to the Serial Monitor is also sent to the server. In the web app: **Boards → Logs** on the board.

- Lines in **blue (server)** are what the server did: configuration sent/applied, commands and their confirmation, online/offline.
- **debug** lines are sensor readings; choose *All* in the level menu to see them.
- Lines written while the board is offline (up to 16) are sent when it reconnects.
- To change what is sent, edit `REMOTE_LOGS` / `REMOTE_LOG_MIN_LEVEL` in `config.h`.

## 6c. Updating over Wi‑Fi (no USB cable)

1. In `config.h`, **raise `FIRMWARE_VERSION`** (e.g. `2.2.1` → `2.2.2`). The number is stamped into the .bin
   (`@@HOMENODE-FW:2.2.2@@`), and it is what a board reports after installing it.
2. Arduino: **Sketch → Export Compiled Binary** → `build/…/home_node.ino.bin`.
3. Web app → a board → **Firmware** → **Upload build**. The version is read from the file, so it can't be mislabelled;
   the same number twice is refused.
4. **Install** on any board (firmware 2.2+). Every page shows "update available" next to boards that run an older version.

If you keep `FIRMWARE_VERSION` unchanged, the board installs the file but still reports the old number — the update
shows as failed with that explanation.

## 6d. Phone control without internet (2.5.0+)

When the home's internet is down but its Wi‑Fi works, the phone app switches the board straight over
the Wi‑Fi: `GET /local/hello`, `POST /local/state`, `POST /local/command` on port 80, and the board
answers to `<node id>.local`. Each request carries the person's pass for this board and a signature
made with a one-time number from `/local/hello`; `src/net/LocalAuth.h` checks them. The server sends
the board its key over MQTT (never retained) and the board keeps it in `/local.json`. A board taken
out of a home forgets it. Changes made this way reach the server as `"src": "local"` once it is back.

Test the checks on a PC (same test vector as the server and the phone app):

    g++ -std=c++17 -I ~/Arduino/libraries/ArduinoJson/src test/local_auth_test.cpp -lcrypto -o /tmp/t && /tmp/t

## 7. How it is built

```
home_node/
├── home_node.ino            composition root: creates the parts and wires them
├── config.h                 compile-time settings (board type, limits, timings)
└── src/
    ├── core/                Device (interface), DeviceRegistry (owns devices, forwards changes), Log
    ├── devices/             RelayDevice "switch", DhtSensor "dht", DeviceFactory (JSON entry -> object)
    ├── inputs/              Input (interface), ToggleButton "toggle_button"
    ├── config/              NodeSettings (setup page), ConfigManager (server config), BoardPins (allowed pins)
    ├── storage/             StateStore (switch states), Files (atomic JSON files in LittleFS)
    └── net/                 MqttBridge (link to the server), Topics, CaCert (Let's Encrypt root for cloud TLS)
```

- **Open/closed:** a new device type = one class + one `if` in `DeviceFactory` + one entry in `packages/contracts/src/device-types.ts`. MQTT, storage and the web app don't change.
- **Safe configuration changes:** `ConfigManager` builds and checks the whole new set (type, allowed pin, no pin used twice, button targets) before swapping it in; a rejected config leaves the board as it was and the reason shows in the web app.
- **Observer:** devices only call `notifyChanged()`; `StateStore` (flash) and `MqttBridge` (server) both listen.
- **Acknowledged commands:** each command's id is echoed in the state the board publishes; the server reports "not responding" after 3 s without it.
- **Never blocks:** buttons, sensors, Wi‑Fi and MQTT share `loop()`; reconnects back off from 1 s to 60 s.
- **Ready for the cloud:** with "Encrypted: yes" it connects with TLS and checks the server certificate against the Let's Encrypt root (time from NTP first).

The protocol is the same as `tools/fake-node/fake_node.py`, which you can use to try everything without a board.

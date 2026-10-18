"""Actions the AI can take. Built fresh for every request from the devices the speaking person may see,
so the AI is only ever told about (and can only reach) their devices.

To add a tool: subclass Tool (name, description, parameters, run) and add it in build_tools().
"""
from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timedelta, timezone, tzinfo
from abc import ABC, abstractmethod
from typing import Any, Callable, Dict, Iterable, List, Optional
from zoneinfo import ZoneInfo

from .domain.models import ToolCall, ToolSpec
from .home_api import HomeApi, HomeApiError
from .knowledge import KnowledgeBase

log = logging.getLogger(__name__)


class Tool(ABC):
    name: str = ""
    description: str = ""

    @property
    def parameters(self) -> dict:
        return {"type": "object", "properties": {}}

    def is_available(self) -> bool:
        return True

    @abstractmethod
    def run(self, args: dict) -> str:
        """Do the action and return a short text result for the AI."""

    def spec(self) -> ToolSpec:
        return ToolSpec(self.name, self.description, self.parameters)


class ToolRegistry:
    def __init__(self, tools: Iterable[Tool] = ()) -> None:
        self._tools: Dict[str, Tool] = {t.name: t for t in tools}

    def get(self, name: str) -> Optional["Tool"]:
        return self._tools.get(name)

    def specs(self) -> List[ToolSpec]:
        return [t.spec() for t in self._tools.values() if t.is_available()]

    def execute(self, call: ToolCall) -> str:
        tool = self._tools.get(call.name)
        if tool is None or not tool.is_available():
            return f"Error: there is no tool called {call.name}."
        try:
            return tool.run(call.arguments or {})
        except HomeApiError as exc:
            return f"Error: {exc}"
        except Exception as exc:  # noqa: BLE001 - report to the AI instead of crashing the conversation
            log.exception("Tool %s failed", call.name)
            return f"Error: {call.name} failed ({exc})."


# ------------------------------------------------------------------ the home's clock
DEFAULT_TIMEZONE = "Asia/Karachi"


def home_zone(name: Optional[str]) -> tzinfo:
    """The home's time zone (the server itself runs on UTC, which is never what people mean by "11 pm")."""
    for candidate in (name, DEFAULT_TIMEZONE):
        if candidate:
            try:
                return ZoneInfo(candidate)
            except Exception:  # noqa: BLE001 - unknown or missing zone data: try the next one
                log.warning("Unknown time zone %r", candidate)
    return timezone(timedelta(hours=5))                 # Pakistan, even without zone data


# ------------------------------------------------------------------ device helpers
def _norm(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def find_device(devices: List[dict], spoken: str) -> List[dict]:
    """Match what the person said to devices: exact name / alias / key, then "room + name", then partial."""
    wanted = _norm(spoken)
    if not wanted:
        return []

    def names(d: dict) -> List[str]:
        return [_norm(n) for n in [d["name"], d["key"], *d.get("aliases", [])]]

    exact = [d for d in devices if wanted in names(d)]
    if exact:
        return exact
    with_room = [d for d in devices if d.get("roomName") and any(
        wanted in (f"{_norm(d['roomName'])} {n}", f"{n} in {_norm(d['roomName'])}") for n in names(d))]
    if with_room:
        return with_room
    return [d for d in devices if any(wanted in n or (n and n in wanted) for n in names(d))]


def _describe(d: dict) -> str:
    where = f" in the {d['roomName']}" if d.get("roomName") else ""
    return f"{d['name']}{where}"


def _state_text(d: dict) -> str:
    if d.get("waiting"):
        return "waiting for a replacement board"   # its board was marked faulty; the installer swaps it
    if not d.get("online"):
        return "offline"
    state = d.get("state") or {}
    if d.get("type") == "fan":
        return f"on at speed {state.get('speed')} of {d.get('speeds') or 4}" if state.get("on") else \
            f"off (speeds 1-{d.get('speeds') or 4})"
    if d.get("controllable"):
        return "on" if state.get("on") else "off"
    if d.get("type") == "tank" and isinstance(state.get("level"), (int, float)):
        alarm = {"dry": "the motor was stopped because the water wasn't rising",
                 "long": "the motor was stopped because it ran too long",
                 "sensor": "the motor was stopped because the sensor gave no reading"}.get(state.get("alarm") or "")
        return f"{state['level']}% full" + (f"; {alarm}" if alarm else "")
    parts = []
    for field in d.get("stateFields", []):
        if field["key"] in state:
            parts.append(f"{field['label'].lower()} {state[field['key']]}{field.get('unit', '')}")
    return ", ".join(parts) or "no reading yet"


# ------------------------------------------------------------------ tools
class SetDeviceTool(Tool):
    name = "set_device"

    def __init__(self, api: HomeApi, devices: List[dict]) -> None:
        self._api = api
        self._switches = [d for d in devices if d.get("controllable") and d.get("access") in ("CONTROL", "MANAGE")]

    @property
    def description(self) -> str:  # type: ignore[override]
        names = ", ".join(_describe(d) for d in self._switches)
        fans = [d for d in self._switches if d.get("type") == "fan"]
        speed = (" A fan with speeds (" + ", ".join(d["name"] for d in fans) + ") also takes a speed: "
                 "'tez' / faster / full = a higher speed, 'dheema' / slower = a lower one.") if fans else ""
        return f"Switch a device in the home on or off. Devices you may switch: {names}.{speed}"

    @property
    def parameters(self) -> dict:
        props: Dict[str, Any] = {
            "device": {"type": "string", "description": "The device name as the person said it"},
            "state": {"type": "string", "enum": ["on", "off"]},
        }
        if any(d.get("type") == "fan" for d in self._switches):
            props["speed"] = {"type": "integer", "minimum": 1, "maximum": 6,
                              "description": "Only for a fan with speeds: the speed to run at (state must be on)"}
        return {"type": "object", "properties": props, "required": ["device", "state"]}

    def is_available(self) -> bool:
        return bool(self._switches)

    def run(self, args: dict) -> str:
        state = str(args.get("state", "")).lower()
        if state not in ("on", "off"):
            return "Error: state must be 'on' or 'off'."
        matches = find_device(self._switches, str(args.get("device", "")))
        if not matches:
            return f"Error: no device called {args.get('device')} that you may switch. Available: " + \
                   ", ".join(_describe(d) for d in self._switches)
        if len(matches) > 1:
            return "Error: that could mean " + " or ".join(_describe(d) for d in matches) + ". Ask which one."
        device = matches[0]
        speed = args.get("speed")
        if speed is not None and state == "on" and device.get("type") == "fan":
            try:
                speed = int(speed)
            except (TypeError, ValueError):
                return "Error: speed must be a number."
            top = int(device.get("speeds") or 4)
            if not 1 <= speed <= top:
                return f"Error: {device['name']} has speeds 1 to {top}."
            result = self._api.command(device["id"], {"speed": speed})
            now = result.get("state") or {}
            return f"{_describe(device)} is now on at speed {now.get('speed', speed)} (confirmed by the device)"
        result = self._api.command(device["id"], {"on": state == "on"})
        actual = "on" if (result.get("state") or {}).get("on") else "off"
        return f"{_describe(device)} is now {actual} (confirmed by the device)"


class GetDevicesTool(Tool):
    name = "get_devices"
    description = "Get every device the person can see, with its room and state (on, off, offline, or sensor readings)."

    def __init__(self, devices: List[dict]) -> None:
        self._devices = devices

    def is_available(self) -> bool:
        return bool(self._devices)

    def run(self, args: dict) -> str:
        return json.dumps({_describe(d): _state_text(d) for d in self._devices}, ensure_ascii=False)


class ReadSensorsTool(Tool):
    name = "read_sensors"
    description = "Read temperature, humidity and other sensors in the home."

    def __init__(self, devices: List[dict]) -> None:
        self._sensors = [d for d in devices if not d.get("controllable")]

    def is_available(self) -> bool:
        return bool(self._sensors)

    def run(self, args: dict) -> str:
        return json.dumps({_describe(d): _state_text(d) for d in self._sensors}, ensure_ascii=False)


DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]


def spoken_clock(h: int, m: int) -> str:
    """19:30 -> "7:30 pm", 7:00 -> "7 am"."""
    suffix = "am" if h < 12 else "pm"
    h12 = h % 12 or 12
    return f"{h12}:{m:02d} {suffix}" if m else f"{h12} {suffix}"


def _when_text(s: dict, tz: Optional[tzinfo] = None) -> str:
    if s.get("kind") == "SUN":
        days = s.get("days") or []
        on_days = "every day" if not days or len(days) == 7 else "on " + ", ".join(DAY_NAMES[d].capitalize() for d in days)
        event = "sunrise" if s.get("sunEvent") == "SUNRISE" else "sunset"
        off = int(s.get("offsetMin") or 0)
        rel = f"{abs(off)} minutes {'before' if off < 0 else 'after'} {event}" if off else f"at {event}"
        return f"{on_days} {rel}"
    if s.get("kind") == "DAILY":
        days = s.get("days") or []
        on_days = "every day" if not days or len(days) == 7 else "on " + ", ".join(DAY_NAMES[d].capitalize() for d in days)
        t = re.match(r"^(\d{1,2}):(\d{2})$", str(s.get("time") or ""))
        return f"{on_days} at {spoken_clock(int(t.group(1)), int(t.group(2))) if t else s.get('time')}"
    at = s.get("nextRunAt") or s.get("runAt")
    if not at:
        return "already ran"
    zone = tz or home_zone(None)
    local = datetime.fromisoformat(at.replace("Z", "+00:00")).astimezone(zone)
    today = datetime.now(zone).date()
    day = "today" if local.date() == today else "tomorrow" if local.date() == today + timedelta(days=1) \
        else local.strftime("on %A %d %B")
    return f"at {spoken_clock(local.hour, local.minute)} {day}"


class ScheduleDeviceTool(Tool):
    name = "schedule_device"

    def __init__(self, api: HomeApi, devices: List[dict], tz: Optional[tzinfo] = None,
                 clock: Optional[Callable[[], datetime]] = None) -> None:
        self._api = api
        self._tz = tz or home_zone(None)
        self._clock = clock or (lambda: datetime.now(self._tz))
        self._switches = [d for d in devices if d.get("controllable") and d.get("access") in ("CONTROL", "MANAGE")]

    @property
    def description(self) -> str:  # type: ignore[override]
        return ("Switch a device on or off LATER: after a number of minutes (a timer), at a clock time today/tomorrow, "
                "every day at a time, or every day at sunrise/sunset (with an offset, e.g. 15 minutes after sunset). "
                "The home server runs it even if nobody has the app open. "
                "Devices: " + ", ".join(_describe(d) for d in self._switches) + ".")

    @property
    def parameters(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "device": {"type": "string", "description": "The device name as the person said it"},
                "state": {"type": "string", "enum": ["on", "off"]},
                "in_minutes": {"type": "number", "description": "Run after this many minutes (for 'in 30 minutes', 'after an hour' = 60)"},
                "at_time": {"type": "string", "description": "Clock time in 24-hour HH:MM, e.g. 19:30 for 7:30 pm"},
                "repeat_daily": {"type": "boolean", "description": "true for 'every day' / 'every night' schedules"},
                "at_sun": {"type": "string", "enum": ["sunrise", "sunset"],
                           "description": "Every day at sunrise or sunset (Maghrib time), instead of a clock time"},
                "sun_offset_minutes": {"type": "integer", "description": "With at_sun: minutes after (positive) or before (negative)"},
                "days": {"type": "array", "items": {"type": "string", "enum": DAY_NAMES},
                         "description": "Only these weekdays (with repeat_daily). Empty = every day"},
            },
            "required": ["device", "state"],
        }

    def is_available(self) -> bool:
        return bool(self._switches)

    def run(self, args: dict) -> str:
        state = str(args.get("state", "")).lower()
        if state not in ("on", "off"):
            return "Error: state must be 'on' or 'off'."
        matches = find_device(self._switches, str(args.get("device", "")))
        if not matches:
            return f"Error: no device called {args.get('device')} that you may switch."
        if len(matches) > 1:
            return "Error: that could mean " + " or ".join(_describe(d) for d in matches) + ". Ask which one."
        device = matches[0]
        body: Dict[str, Any] = {"actions": [{"deviceId": device["id"], "on": state == "on"}]}
        at_time = str(args.get("at_time") or "").strip()
        sun = str(args.get("at_sun") or "").lower()
        if sun in ("sunrise", "sunset"):
            days = [DAY_NAMES.index(d.lower()) for d in (args.get("days") or []) if str(d).lower() in DAY_NAMES]
            offset = max(-180, min(180, int(args.get("sun_offset_minutes") or 0)))
            body.update({"kind": "SUN", "sunEvent": sun.upper(), "offsetMin": offset, "days": days})
        elif args.get("repeat_daily"):
            if not re.match(r"^\d{1,2}:\d{2}$", at_time):
                return "Error: a daily schedule needs at_time as HH:MM."
            days = [DAY_NAMES.index(d.lower()) for d in (args.get("days") or []) if str(d).lower() in DAY_NAMES]
            body.update({"kind": "DAILY", "time": at_time, "days": days})
        elif args.get("in_minutes") not in (None, ""):
            minutes = float(args["in_minutes"])
            if minutes < 1:
                return "Error: in_minutes must be at least 1."
            body.update({"kind": "ONCE", "inMinutes": minutes})
        elif at_time:
            m = re.match(r"^(\d{1,2}):(\d{2})$", at_time)
            if not m:
                return "Error: at_time must be HH:MM."
            now = self._clock().astimezone(self._tz)    # the home's clock, not the server's
            when = now.replace(hour=int(m.group(1)), minute=int(m.group(2)), second=0, microsecond=0)
            if when <= now:
                when += timedelta(days=1)
            body.update({"kind": "ONCE", "runAt": when.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")})
        else:
            return "Error: say when - in_minutes, at_time, or repeat_daily with at_time."
        created = self._api.create_schedule(body)
        return f"Scheduled (saved on the home server): {_describe(device)} {state} {_when_text(created, self._tz)}."


class ListSchedulesTool(Tool):
    name = "list_schedules"
    description = "List the timers and daily schedules that are set (numbered, so one can be cancelled)."

    def __init__(self, api: HomeApi, tz: Optional[tzinfo] = None) -> None:
        self._api = api
        self._tz = tz

    def run(self, args: dict) -> str:
        rows = [s for s in self._api.schedules() if s.get("enabled")]
        if not rows:
            return "There are no timers or schedules."
        return "; ".join(f"{i + 1}. {s['name']} {_when_text(s, self._tz)}" for i, s in enumerate(rows))


class CancelScheduleTool(Tool):
    name = "cancel_schedule"
    description = "Cancel a timer or schedule, by its number from list_schedules or by the device name in it."

    def __init__(self, api: HomeApi, tz: Optional[tzinfo] = None) -> None:
        self._api = api
        self._tz = tz

    @property
    def parameters(self) -> dict:
        return {"type": "object", "properties": {"which": {"type": "string", "description": "Number from list_schedules, or a device/schedule name"}},
                "required": ["which"]}

    def run(self, args: dict) -> str:
        rows = [s for s in self._api.schedules() if s.get("enabled")]
        which = str(args.get("which", "")).strip()
        picked: List[dict]
        if which.isdigit() and 1 <= int(which) <= len(rows):
            picked = [rows[int(which) - 1]]
        else:
            wanted = _norm(which)
            picked = [s for s in rows if wanted and (wanted in _norm(s["name"]) or any(wanted in _norm(a.get("deviceName", "")) for a in s.get("actions", [])))]
        if not picked:
            return "Error: no matching timer or schedule. Use list_schedules first."
        if len(picked) > 1:
            return "Error: that matches several: " + "; ".join(f"{s['name']} {_when_text(s, self._tz)}" for s in picked) + ". Ask which one."
        self._api.delete_schedule(picked[0]["id"])
        return f"Cancelled: {picked[0]['name']} {_when_text(picked[0], self._tz)}."


class RunSceneTool(Tool):
    name = "run_scene"

    def __init__(self, api: HomeApi, scenes: List[dict]) -> None:
        self._api = api
        self._scenes = [s for s in scenes if s.get("canRun")]

    @property
    def description(self) -> str:  # type: ignore[override]
        return "Run a scene (a saved group of actions). Scenes: " + ", ".join(s["name"] for s in self._scenes) + "."

    @property
    def parameters(self) -> dict:
        return {"type": "object", "properties": {"scene": {"type": "string"}}, "required": ["scene"]}

    def is_available(self) -> bool:
        return bool(self._scenes)

    def run(self, args: dict) -> str:
        wanted = _norm(str(args.get("scene", "")))
        found = [s for s in self._scenes if _norm(s["name"]) == wanted] or [s for s in self._scenes if wanted and wanted in _norm(s["name"])]
        if len(found) != 1:
            return "Error: which scene? Available: " + ", ".join(s["name"] for s in self._scenes)
        result = self._api.run_scene(found[0]["id"])
        return f"Scene {found[0]['name']}: {result.get('summary', 'done')}"


class SearchHelpTool(Tool):
    name = "search_help"
    description = (
        "Search the Help Center: how to use the app and the assistant, fixing problems (board offline, "
        "Wi-Fi, sensors, sign-in, voice), how installation and support work, and the company's policies "
        "(warranty, service visits and charges, refunds, privacy). Use it for any question about the product "
        "or the company that isn't switching a device right now. Write the query in English with the key "
        "words, even when the person spoke Urdu or Roman Urdu."
    )

    def __init__(self, api: HomeApi, knowledge: KnowledgeBase, customer_view: bool = False) -> None:
        self._api = api
        self._kb = knowledge
        self._customer_view = customer_view

    @property
    def parameters(self) -> dict:
        return {"type": "object", "properties": {
            "query": {"type": "string", "description": "What to look for, in English: 'board offline after power cut'"},
        }, "required": ["query"]}

    def hits(self, query: str, limit: int = 4):
        key = self._api.help_key(self._customer_view)
        index = self._kb.index(key, lambda: self._api.help_articles(self._customer_view))
        return index.search(query, limit=limit)

    def run(self, args: dict) -> str:
        found = self.hits(str(args.get("query", "")))
        if not found:
            return ("No Help Center article matches. Say you don't have that information; offer to pass the "
                    "question on to their installer (Me, then Message your expert) instead of guessing.")
        parts = []
        for n, h in enumerate(found, 1):
            text = h.chunk.text if len(h.chunk.text) <= 1500 else h.chunk.text[:1500] + " ..."
            parts.append(f"[{n}] {h.chunk.title} ({h.chunk.category.lower()})\n{text}")
        return ("Answer only from these Help Center excerpts; if they don't answer the question, say so.\n\n"
                + "\n\n".join(parts))


class DiagnoseHomeTool(Tool):
    name = "diagnose_home"
    description = (
        "Check this home right now: boards that are offline (and since when), weak Wi-Fi, settings not applied "
        "to a board, devices not responding, sensors without readings. Use it when the person says something "
        "isn't working, before suggesting a fix."
    )

    def __init__(self, api: HomeApi, devices: List[dict], tz: Optional[tzinfo] = None) -> None:
        self._api = api
        self._devices = devices
        self._tz = tz or home_zone(None)

    def _ago(self, iso: Optional[str]) -> str:
        if not iso:
            return "never"
        then = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        minutes = int((datetime.now(timezone.utc) - then).total_seconds() // 60)
        if minutes < 2:
            return "just now"
        if minutes < 120:
            return f"{minutes} minutes ago"
        if minutes < 48 * 60:
            return f"{minutes // 60} hours ago"
        local = then.astimezone(self._tz)
        return local.strftime("on %d %B at ") + spoken_clock(local.hour, local.minute)

    def run(self, args: dict) -> str:
        lines: List[str] = []
        waiting = [d for d in self._devices if d.get("waiting")]
        if waiting:
            lines.append("Devices waiting for a replacement board (their board is broken; the installer replaces it, "
                         "and their timers, scenes and rules work again then): " + ", ".join(_describe(d) for d in waiting) + ".")
        offline = [d for d in self._devices if not d.get("online") and not d.get("waiting")]
        if offline:
            lines.append("Devices not responding (their board is offline): " + ", ".join(_describe(d) for d in offline) + ".")
        silent = [d for d in self._devices if d.get("online") and not d.get("controllable") and _state_text(d) == "no reading yet"]
        if silent:
            lines.append("Sensors online but without a reading yet: " + ", ".join(_describe(d) for d in silent) + ".")
        try:
            boards = self._api.nodes()
        except HomeApiError:
            boards = None                                 # members don't see boards: devices are enough
        if boards is not None:
            for b in boards:
                name = b.get("name") or b.get("id")
                problems = []
                if b.get("status") == "FAULTY":
                    problems.append("marked faulty: its devices wait for a replacement board"
                                    + (f" ({b['note']})" if b.get("note") else ""))
                elif b.get("status") != "ADOPTED":
                    problems.append(f"not set up yet (status {str(b.get('status', '')).lower()})")
                if not b.get("online") and b.get("status") != "FAULTY":
                    problems.append(f"offline, last seen {self._ago(b.get('lastSeenAt'))}")
                rssi = (b.get("health") or {}).get("rssi", b.get("rssi"))
                if b.get("online") and isinstance(rssi, (int, float)) and rssi < -80:
                    problems.append(f"weak Wi-Fi ({rssi} dBm; under -80 drops out)")
                if b.get("configError"):
                    problems.append(f"its settings were refused: {b['configError']}")
                elif b.get("online") and b.get("appliedRev") is not None and b.get("appliedRev") != b.get("configRev"):
                    problems.append("new settings not applied yet")
                lines.append(f"Board {name}: " + ("; ".join(problems) if problems else
                                                  f"online, Wi-Fi {rssi} dBm, firmware {b.get('firmware')}") + ".")
        if not lines:
            return "Everything this person can see is online and reporting."
        return " ".join(lines)


def build_tools(api: Optional[HomeApi], devices: List[Dict[str, Any]], tz: Optional[tzinfo] = None,
                clock: Optional[Callable[[], datetime]] = None, knowledge: Optional[KnowledgeBase] = None,
                me: str = "", public_url: str = "") -> ToolRegistry:
    if api is None:
        return ToolRegistry()
    try:
        scenes = api.scenes()
    except Exception:  # noqa: BLE001 - no scenes is fine
        scenes = []
    from .connections import BoardConnectionsTool  # here: connections.py builds on this module
    from .manage import management_tools
    return ToolRegistry([
        SetDeviceTool(api, devices), GetDevicesTool(devices), ReadSensorsTool(devices),
        ScheduleDeviceTool(api, devices, tz, clock), ListSchedulesTool(api, tz), CancelScheduleTool(api, tz),
        RunSceneTool(api, scenes), DiagnoseHomeTool(api, devices, tz), BoardConnectionsTool(api, tz),
        *([SearchHelpTool(api, knowledge)] if knowledge is not None else []),
        *management_tools(api, devices, me, public_url, tz),
    ])


def build_console_tools(api: Optional[HomeApi], tz: Optional[tzinfo] = None,
                        knowledge: Optional[KnowledgeBase] = None) -> ToolRegistry:
    """The console (staff): read-only tools about the boards in the homes they look after, and the Help Center
    as staff see it. No device switching here: that happens inside a home."""
    if api is None:
        return ToolRegistry()
    from .connections import BoardConnectionsTool, FleetStatusTool
    from .manage import FleetOutagesTool, HomeDetailsTool
    return ToolRegistry([
        FleetStatusTool(api, tz), BoardConnectionsTool(api, tz, console=True), HomeDetailsTool(api), FleetOutagesTool(api, tz),
        *([SearchHelpTool(api, knowledge, customer_view=False)] if knowledge is not None else []),
    ])


def describe_home(devices: List[Dict[str, Any]], scenes: Iterable[dict] = ()) -> str:
    """What the AI is told about the home before each answer: every device the person can see, by room,
    with its state right now and whether they may switch it. With this it answers "is the fan on?" and
    resolves "the bedroom one" without guessing or an extra tool round."""
    if not devices:
        return "This person cannot see any devices in this home yet."
    by_room: Dict[str, List[str]] = {}
    for d in devices:
        if d.get("controllable"):
            right = "you may switch it" if d.get("access") in ("CONTROL", "MANAGE") else "view only, they may NOT switch it"
        else:
            right = "sensor"
        names = [d["name"], *[a for a in d.get("aliases", []) if a]]
        called = names[0] + (f" (also called {', '.join(names[1:])})" if len(names) > 1 else "")
        by_room.setdefault(d.get("roomName") or "No room", []).append(f"{called}: {_state_text(d)}; {right}")
    lines = ["Devices this person can see, right now:"]
    for room, items in by_room.items():
        lines.append(f"- {room}: " + " | ".join(items))
    runnable = [s["name"] for s in scenes if s.get("canRun")]
    if runnable:
        lines.append("Scenes they can run: " + ", ".join(runnable) + ".")
    return "\n".join(lines)

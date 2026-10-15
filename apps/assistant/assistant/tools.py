"""Actions the AI can take. Built fresh for every request from the devices the speaking person may see,
so the AI is only ever told about (and can only reach) their devices.

To add a tool: subclass Tool (name, description, parameters, run) and add it in build_tools().
"""
from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timedelta, timezone
from abc import ABC, abstractmethod
from typing import Any, Dict, Iterable, List, Optional

from .domain.models import ToolCall, ToolSpec
from .home_api import HomeApi, HomeApiError

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
    if not d.get("online"):
        return "offline"
    state = d.get("state") or {}
    if d.get("controllable"):
        return "on" if state.get("on") else "off"
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
        return f"Switch a device in the home on or off. Devices you may switch: {names}."

    @property
    def parameters(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "device": {"type": "string", "description": "The device name as the person said it"},
                "state": {"type": "string", "enum": ["on", "off"]},
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
            return f"Error: no device called {args.get('device')} that you may switch. Available: " + \
                   ", ".join(_describe(d) for d in self._switches)
        if len(matches) > 1:
            return "Error: that could mean " + " or ".join(_describe(d) for d in matches) + ". Ask which one."
        device = matches[0]
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


def _when_text(s: dict) -> str:
    if s.get("kind") == "DAILY":
        days = s.get("days") or []
        on_days = "every day" if not days or len(days) == 7 else "on " + ", ".join(DAY_NAMES[d].capitalize() for d in days)
        return f"{on_days} at {s.get('time')}"
    at = s.get("nextRunAt") or s.get("runAt")
    if not at:
        return "already ran"
    local = datetime.fromisoformat(at.replace("Z", "+00:00")).astimezone()
    return "at " + local.strftime("%H:%M on %A %d %B")


class ScheduleDeviceTool(Tool):
    name = "schedule_device"

    def __init__(self, api: HomeApi, devices: List[dict]) -> None:
        self._api = api
        self._switches = [d for d in devices if d.get("controllable") and d.get("access") in ("CONTROL", "MANAGE")]

    @property
    def description(self) -> str:  # type: ignore[override]
        return ("Switch a device on or off LATER: after a number of minutes (a timer), at a clock time today/tomorrow, "
                "or every day at a time. The home server runs it even if nobody has the app open. "
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
        if args.get("repeat_daily"):
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
            now = datetime.now().astimezone()
            when = now.replace(hour=int(m.group(1)), minute=int(m.group(2)), second=0, microsecond=0)
            if when <= now:
                when += timedelta(days=1)
            body.update({"kind": "ONCE", "runAt": when.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")})
        else:
            return "Error: say when - in_minutes, at_time, or repeat_daily with at_time."
        created = self._api.create_schedule(body)
        return f"Scheduled (saved on the home server): {_describe(device)} {state} {_when_text(created)}."


class ListSchedulesTool(Tool):
    name = "list_schedules"
    description = "List the timers and daily schedules that are set (numbered, so one can be cancelled)."

    def __init__(self, api: HomeApi) -> None:
        self._api = api

    def run(self, args: dict) -> str:
        rows = [s for s in self._api.schedules() if s.get("enabled")]
        if not rows:
            return "There are no timers or schedules."
        return "; ".join(f"{i + 1}. {s['name']} {_when_text(s)}" for i, s in enumerate(rows))


class CancelScheduleTool(Tool):
    name = "cancel_schedule"
    description = "Cancel a timer or schedule, by its number from list_schedules or by the device name in it."

    def __init__(self, api: HomeApi) -> None:
        self._api = api

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
            return "Error: that matches several: " + "; ".join(f"{s['name']} {_when_text(s)}" for s in picked) + ". Ask which one."
        self._api.delete_schedule(picked[0]["id"])
        return f"Cancelled: {picked[0]['name']} {_when_text(picked[0])}."


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


def build_tools(api: Optional[HomeApi], devices: List[Dict[str, Any]]) -> ToolRegistry:
    if api is None:
        return ToolRegistry()
    try:
        scenes = api.scenes()
    except Exception:  # noqa: BLE001 - no scenes is fine
        scenes = []
    return ToolRegistry([
        SetDeviceTool(api, devices), GetDevicesTool(devices), ReadSensorsTool(devices),
        ScheduleDeviceTool(api, devices), ListSchedulesTool(api), CancelScheduleTool(api), RunSceneTool(api, scenes),
    ])

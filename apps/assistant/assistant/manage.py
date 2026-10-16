"""Knowing the whole home and managing it from the assistant: rooms, device names and rooms, people and
invites, scenes. Every tool calls the platform API with the speaking person's own token, so the API
allows exactly what the app allows them (owners and admins manage; members and guests switch what
they may). Deleting or removing something needs `confirmed: true`, which the AI may only send after
the person said yes to the exact thing in this conversation.

The console has one read-only tool here, home_details: any home the staff member looks after, with its
rooms, boards, device counts and people.
"""
from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Sequence, Tuple

from .home_api import HomeApi, HomeApiError
from .tools import Tool, _describe, _norm, find_device

log = logging.getLogger(__name__)
_POOL = ThreadPoolExecutor(max_workers=6, thread_name_prefix="home-facts")

ROLES = {"owner": "OWNER", "admin": "ADMIN", "member": "MEMBER", "family": "MEMBER", "guest": "GUEST"}
ACCESS = {"view": "VIEW", "see": "VIEW", "control": "CONTROL", "switch": "CONTROL", "manage": "MANAGE"}
CONFIRM = ("Not done yet: this can't be undone. Tell them exactly what will happen and ask them to say yes; "
           "call again with confirmed true only after they agree.")


def _ago(iso: Optional[str]) -> str:
    if not iso:
        return "never"
    minutes = int((datetime.now(timezone.utc) - datetime.fromisoformat(iso.replace("Z", "+00:00"))).total_seconds() // 60)
    if minutes < 2:
        return "just now"
    if minutes < 60:
        return f"{minutes} minutes ago"
    if minutes < 48 * 60:
        return f"{minutes // 60} hours ago"
    return f"{minutes // 1440} days ago"


def match_one(items: Sequence[dict], spoken: str, what: str, *keys: str) -> Tuple[Optional[dict], Optional[str]]:
    """The one item the person meant, by name (exact first, then partial), or an error to say."""
    wanted = _norm(spoken)
    if not wanted:
        return None, f"Error: say which {what}."
    keys = keys or ("name",)

    def names(i: dict) -> List[str]:
        return [_norm(str(i.get(k) or "")) for k in keys if i.get(k)]
    exact = [i for i in items if wanted in names(i)]
    found = exact or [i for i in items if any(wanted in n or n in wanted for n in names(i) if n)]
    if not found:
        known = ", ".join(str(i.get(keys[0])) for i in items[:12]) or "none"
        return None, f"Error: there is no {what} called {spoken!r}. The {what}s are: {known}."
    if len(found) > 1:
        return None, f"Error: {spoken!r} matches several {what}s: " + ", ".join(str(i.get(keys[0])) for i in found) + ". Ask which one."
    return found[0], None


def _safe(fn) -> Any:
    try:
        return fn()
    except HomeApiError as exc:
        return exc
    except Exception as exc:  # noqa: BLE001 - one missing part must not lose the rest of the picture
        log.warning("Home facts: %s", exc)
        return exc


# ------------------------------------------------------------------ the whole home, in words
def home_facts(api: HomeApi, devices: Sequence[dict], me: str = "", tz=None) -> str:
    """Rooms (with empty ones), boards, people and invites, timers: what the AI is told on top of the
    devices. Parts this person may not see (people and boards are for owners and admins) are left out
    and their role says why."""
    names = ("rooms", "nodes", "users", "invites", "schedules", "outages")
    calls = [getattr(api, n, None) for n in names]
    got = dict(zip(names, _POOL.map(lambda f: _safe(f) if callable(f) else None, calls)))
    lines: List[str] = []

    users = got["users"]
    if isinstance(users, list):
        mine = next((u for u in users if u.get("id") == me), None)
        role = (mine or {}).get("role") or ("INSTALLER" if (mine or {}).get("staff") else "")
        lines.append(f"Their role in this home: {role or 'unknown'}. "
                     + ("They may manage rooms, devices, people and scenes." if role in ("OWNER", "ADMIN", "INSTALLER", "")
                        else ""))
    else:
        lines.append("Their role in this home: member or guest. They may switch the devices they have access to, "
                     "but not manage rooms, people, boards or device names: only the owner and admins can.")

    rooms = got["rooms"]
    if isinstance(rooms, list):
        lines.append(f"\nRooms ({len(rooms)}):")
        for r in rooms:
            inside = [d for d in devices if d.get("roomId") == r["id"]]
            on = sum(1 for d in inside if (d.get("state") or {}).get("on") is True and d.get("online"))
            lines.append(f"- {r['name']}: " + (f"{len(inside)} device{'s' if len(inside) != 1 else ''}"
                                               + (f", {on} on" if on else "") if inside else "no devices yet"))
        loose = [d for d in devices if not d.get("roomId")]
        if loose:
            lines.append(f"- Not in a room: {', '.join(d['name'] for d in loose)}")
    lines.append(f"Devices they can see: {len(devices)} in total "
                 f"({sum(1 for d in devices if d.get('controllable'))} switchable, "
                 f"{sum(1 for d in devices if not d.get('controllable'))} sensors).")

    nodes = got["nodes"]
    if isinstance(nodes, list) and nodes:
        lines.append(f"\nBoards ({len(nodes)}):")
        for n in nodes:
            count = sum(1 for d in devices if d.get("nodeId") == n.get("id"))
            state = "online" if n.get("online") else f"OFFLINE, last heard from {_ago(n.get('lastSeenAt'))}"
            lines.append(f"- {n.get('name') or n.get('id')}: {state}" + (f"; {count} devices" if count else ""))

    if isinstance(users, list):
        lines.append(f"\nPeople ({len(users)}):")
        for u in users:
            who = u.get("name") or u.get("email")
            role = (u.get("role") or ("installer" if u.get("staff") else "")).lower()
            extra = " (this is them)" if u.get("id") == me else ""
            extra += " (disabled)" if u.get("disabled") else ""
            lines.append(f"- {who}: {role}{extra}")
        invites = got["invites"]
        if isinstance(invites, list) and invites:
            lines.append("Invited, not joined yet: " + "; ".join(
                f"{i.get('name') or i.get('email')} ({str(i.get('role', '')).lower()})" for i in invites))

    outages = got["outages"]
    if isinstance(outages, dict):
        s = outages.get("summary") or {}
        last = s.get("lastPower")
        lines.append(f"\nPower this week: {s.get('powerCuts', 0)} power cuts, {_dur(s.get('powerSeconds', 0))} without power"
                     + (f"; the last one {_local(last['startedAt'], tz)} for {_dur(last['seconds'])}" if last else "")
                     + f". Internet or Wi-Fi down {s.get('networkOuts', 0)} times (power_history has the details).")

    schedules = got["schedules"]
    if isinstance(schedules, list):
        active = [s for s in schedules if s.get("enabled", True)]
        lines.append(f"\nTimers and daily schedules: {len(active)} active" + (" (list_schedules shows them)" if active else "."))
    return "\n".join(lines)


class HomeOverviewTool(Tool):
    name = "home_overview"
    description = ("The whole home right now, fresh: rooms (also empty ones) with device counts, boards online or "
                   "offline, people and pending invites (owners and admins), timers. Use it for 'how many rooms', "
                   "'give me a summary', 'who has access', or after changing something.")

    def __init__(self, api: HomeApi, me: str = "", tz=None) -> None:
        self._api, self._me, self._tz = api, me, tz

    def run(self, args: dict) -> str:
        return home_facts(self._api, self._api.devices(), self._me, self._tz)


# ------------------------------------------------------------------ rooms
class AddRoomTool(Tool):
    name = "add_room"
    description = "Add a room to the home (owners and admins)."

    def __init__(self, api: HomeApi) -> None:
        self._api = api

    @property
    def parameters(self) -> dict:
        return {"type": "object", "properties": {"name": {"type": "string", "description": "The new room's name"}}, "required": ["name"]}

    def run(self, args: dict) -> str:
        name = str(args.get("name", "")).strip()
        if not name:
            return "Error: say the room's name."
        same = next((r for r in self._api.rooms() if _norm(r["name"]) == _norm(name)), None)
        if same:
            return f"There is already a room called {same['name']}; nothing added."
        room = self._api.create_room(name)
        return f"Added the room {room.get('name', name)}. It has no devices yet: move devices into it with update_device."


class RenameRoomTool(Tool):
    name = "rename_room"
    description = "Rename a room (owners and admins)."

    def __init__(self, api: HomeApi) -> None:
        self._api = api

    @property
    def parameters(self) -> dict:
        return {"type": "object", "properties": {"room": {"type": "string"}, "new_name": {"type": "string"}},
                "required": ["room", "new_name"]}

    def run(self, args: dict) -> str:
        room, err = match_one(self._api.rooms(), str(args.get("room", "")), "room")
        if err:
            return err
        new = str(args.get("new_name", "")).strip()
        if not new:
            return "Error: say the new name."
        self._api.update_room(room["id"], new)
        return f"Renamed the room {room['name']} to {new}."


class DeleteRoomTool(Tool):
    name = "delete_room"
    description = ("Delete a room (owners and admins). Its devices stay and become 'not in a room'. Needs confirmed true, "
                   "only after the person said yes.")

    def __init__(self, api: HomeApi, devices: Sequence[dict]) -> None:
        self._api, self._devices = api, devices

    @property
    def parameters(self) -> dict:
        return {"type": "object", "properties": {"room": {"type": "string"}, "confirmed": {"type": "boolean"}}, "required": ["room"]}

    def run(self, args: dict) -> str:
        room, err = match_one(self._api.rooms(), str(args.get("room", "")), "room")
        if err:
            return err
        inside = [d["name"] for d in self._devices if d.get("roomId") == room["id"]]
        if not args.get("confirmed"):
            return (f"{CONFIRM} Deleting {room['name']}" + (f" leaves its devices ({', '.join(inside)}) without a room." if inside else ".")
                    + " People's access to that room goes too.")
        self._api.delete_room(room["id"])
        return f"Deleted the room {room['name']}." + (f" {', '.join(inside)} are now not in a room." if inside else "")


# ------------------------------------------------------------------ devices
class UpdateDeviceTool(Tool):
    name = "update_device"
    description = ("Rename a device, move it to another room, or add another name people call it (an alias, e.g. "
                   "'batti'). Owners and admins.")

    def __init__(self, api: HomeApi, devices: Sequence[dict]) -> None:
        self._api, self._devices = api, devices

    @property
    def parameters(self) -> dict:
        return {"type": "object", "properties": {
            "device": {"type": "string", "description": "The device as the person called it"},
            "new_name": {"type": "string"},
            "room": {"type": "string", "description": "Move it to this room"},
            "add_alias": {"type": "string", "description": "Another name for it"},
        }, "required": ["device"]}

    def run(self, args: dict) -> str:
        found = find_device(list(self._devices), str(args.get("device", "")))
        if not found:
            return f"Error: there is no device called {args.get('device')!r}."
        if len(found) > 1:
            return "Error: that matches several devices: " + ", ".join(_describe(d) for d in found) + ". Ask which one."
        d = found[0]
        body: Dict[str, Any] = {}
        done: List[str] = []
        if str(args.get("new_name") or "").strip():
            body["name"] = str(args["new_name"]).strip()
            done.append(f"renamed it to {body['name']}")
        if str(args.get("room") or "").strip():
            room, err = match_one(self._api.rooms(), str(args["room"]), "room")
            if err:
                return err
            body["roomId"] = room["id"]
            done.append(f"moved it to {room['name']}")
        if str(args.get("add_alias") or "").strip():
            alias = str(args["add_alias"]).strip()
            body["aliases"] = [*d.get("aliases", []), alias]
            done.append(f"it can now also be called {alias}")
        if not body:
            return "Error: say what to change: a new name, a room, or another name for it."
        self._api.update_device(d["id"], body)
        return f"{_describe(d)}: " + ", ".join(done) + "."


# ------------------------------------------------------------------ people
def _rooms_text(person: dict, rooms: Sequence[dict]) -> str:
    names = {r["id"]: r["name"] for r in rooms}
    granted = [f"{names.get(r['roomId'], '?')} ({str(r['access']).lower()})" for r in person.get("rooms", [])]
    if person.get("role") in ("OWNER", "ADMIN"):
        return "every room"
    return ", ".join(granted) if granted else "no rooms yet"


class ListPeopleTool(Tool):
    name = "list_people"
    description = "Everyone in this home with their role and the rooms they may use, and invites not accepted yet (owners and admins)."

    def __init__(self, api: HomeApi) -> None:
        self._api = api

    def run(self, args: dict) -> str:
        users, rooms = self._api.users(), self._api.rooms()
        lines = [f"- {u.get('name') or u.get('email')} <{u.get('email')}>: "
                 f"{(u.get('role') or ('installer' if u.get('staff') else '')).lower()}"
                 f"{' (disabled)' if u.get('disabled') else ''}; rooms: {_rooms_text(u, rooms)}" for u in users]
        invites = self._api.invites()
        if invites:
            lines.append("Invited, not joined yet: " + "; ".join(f"{i.get('name') or i.get('email')} ({str(i.get('role')).lower()})" for i in invites))
        return "\n".join(lines) or "Nobody yet."


def _room_grants(api: HomeApi, rooms_arg: Any, access_arg: Any) -> Tuple[Optional[List[Dict[str, str]]], Optional[str]]:
    access = ACCESS.get(str(access_arg or "control").strip().lower())
    if not access:
        return None, "Error: access is view, control or manage."
    all_rooms = api.rooms()
    wanted = rooms_arg if isinstance(rooms_arg, list) else [rooms_arg] if rooms_arg else []
    if any(_norm(str(w)) in ("all", "every room", "all rooms", "everything") for w in wanted):
        return [{"roomId": r["id"], "access": access} for r in all_rooms], None
    grants = []
    for w in wanted:
        room, err = match_one(all_rooms, str(w), "room")
        if err:
            return None, err
        grants.append({"roomId": room["id"], "access": access})
    return grants, None


class InvitePersonTool(Tool):
    name = "invite_person"
    description = ("Invite someone to this home by email (owners and admins; only the owner invites an admin). Gives a "
                   "link to send them (valid 7 days). Members and guests only see the rooms you give them.")

    def __init__(self, api: HomeApi, public_url: str = "") -> None:
        self._api, self._url = api, public_url.rstrip("/")

    @property
    def parameters(self) -> dict:
        return {"type": "object", "properties": {
            "email": {"type": "string"},
            "name": {"type": "string"},
            "role": {"type": "string", "enum": ["member", "guest", "admin"], "description": "member (family) unless they say"},
            "rooms": {"type": "array", "items": {"type": "string"}, "description": "Room names, or ['all']"},
            "access": {"type": "string", "enum": ["view", "control"], "description": "In those rooms: see only, or switch (default)"},
        }, "required": ["email"]}

    def run(self, args: dict) -> str:
        email = str(args.get("email", "")).strip()
        if "@" not in email:
            return "Error: ask for their email address; the invite is sent to it."
        role = ROLES.get(str(args.get("role") or "member").strip().lower(), "MEMBER")
        body: Dict[str, Any] = {"email": email, "role": role}
        if str(args.get("name") or "").strip():
            body["name"] = str(args["name"]).strip()
        if role in ("MEMBER", "GUEST"):
            grants, err = _room_grants(self._api, args.get("rooms"), args.get("access"))
            if err:
                return err
            body["rooms"] = grants
        made = self._api.invite(body)
        link = f"{self._url}{made.get('path', '')}" if self._url else made.get("path", "")
        rooms = "" if role not in ("MEMBER", "GUEST") else (f" with {len(body['rooms'])} room(s)" if body["rooms"] else " with no rooms yet")
        return (f"Invite made for {email} as {role.lower()}{rooms}. Send them this link (valid {made.get('expiresInDays', 7)} days): "
                f"{link}" + (" They already have an account: they sign in with it." if made.get("existingAccount") else ""))


class UpdatePersonTool(Tool):
    name = "update_person"
    description = ("Change someone in this home: their role, the rooms they may use and how (view or control), or "
                   "pause/restore their access (owners and admins; admins manage members and guests only).")

    def __init__(self, api: HomeApi) -> None:
        self._api = api

    @property
    def parameters(self) -> dict:
        return {"type": "object", "properties": {
            "person": {"type": "string", "description": "Their name or email"},
            "role": {"type": "string", "enum": ["admin", "member", "guest"]},
            "rooms": {"type": "array", "items": {"type": "string"}, "description": "The rooms they may use from now on (replaces the list), or ['all']"},
            "access": {"type": "string", "enum": ["view", "control"]},
            "disabled": {"type": "boolean", "description": "true pauses their access, false restores it"},
        }, "required": ["person"]}

    def run(self, args: dict) -> str:
        person, err = match_one(self._api.users(), str(args.get("person", "")), "person", "name", "email")
        if err:
            return err
        done: List[str] = []
        body: Dict[str, Any] = {}
        if args.get("role"):
            role = ROLES.get(str(args["role"]).strip().lower())
            if not role or role == "OWNER":
                return "Error: the role can be admin, member or guest (a home has one owner)."
            body["role"] = role
            done.append(f"is now {role.lower()}")
        if args.get("disabled") is not None:
            body["disabled"] = bool(args["disabled"])
            done.append("access paused" if body["disabled"] else "access restored")
        if body:
            self._api.update_user(person["id"], body)
        if args.get("rooms") is not None:
            grants, err = _room_grants(self._api, args.get("rooms"), args.get("access"))
            if err:
                return err
            self._api.set_user_rooms(person["id"], grants or [])
            done.append(f"may now use {len(grants or [])} room(s)")
        if not done:
            return "Error: say what to change: role, rooms, or pause/restore."
        return f"{person.get('name') or person.get('email')}: " + ", ".join(done) + "."


class RemovePersonTool(Tool):
    name = "remove_person"
    description = "Remove someone from this home (owners and admins). Needs confirmed true, only after the person said yes."

    def __init__(self, api: HomeApi) -> None:
        self._api = api

    @property
    def parameters(self) -> dict:
        return {"type": "object", "properties": {"person": {"type": "string"}, "confirmed": {"type": "boolean"}}, "required": ["person"]}

    def run(self, args: dict) -> str:
        person, err = match_one(self._api.users(), str(args.get("person", "")), "person", "name", "email")
        if err:
            return err
        who = person.get("name") or person.get("email")
        if not args.get("confirmed"):
            return f"{CONFIRM} Removing {who} ends their access to this home at once; they'd need a new invite to come back."
        self._api.remove_user(person["id"])
        return f"Removed {who} from this home."


# ------------------------------------------------------------------ scenes
class CreateSceneTool(Tool):
    name = "create_scene"
    description = "Save a scene: a name and which devices it switches on or off (e.g. 'Good night': all lights off, fan on)."

    def __init__(self, api: HomeApi, devices: Sequence[dict]) -> None:
        self._api, self._devices = api, devices

    @property
    def parameters(self) -> dict:
        return {"type": "object", "properties": {
            "name": {"type": "string"},
            "actions": {"type": "array", "items": {"type": "object", "properties": {
                "device": {"type": "string"}, "state": {"type": "string", "enum": ["on", "off"]}},
                "required": ["device", "state"]}},
        }, "required": ["name", "actions"]}

    def run(self, args: dict) -> str:
        name = str(args.get("name", "")).strip()
        actions, said = [], []
        for a in args.get("actions") or []:
            found = find_device([d for d in self._devices if d.get("controllable")], str(a.get("device", "")))
            if len(found) != 1:
                return (f"Error: {a.get('device')!r} " + ("isn't a switchable device here." if not found else
                        "matches several: " + ", ".join(_describe(d) for d in found) + ". Ask which one."))
            on = str(a.get("state", "")).lower() == "on"
            actions.append({"deviceId": found[0]["id"], "on": on})
            said.append(f"{_describe(found[0])} {'on' if on else 'off'}")
        if not name or not actions:
            return "Error: a scene needs a name and at least one device to switch."
        self._api.create_scene({"name": name, "actions": actions})
        return f"Saved the scene {name}: " + ", ".join(said) + ". Say 'run " + name + "' any time."


class DeleteSceneTool(Tool):
    name = "delete_scene"
    description = "Delete a saved scene. Needs confirmed true, only after the person said yes."

    def __init__(self, api: HomeApi) -> None:
        self._api = api

    @property
    def parameters(self) -> dict:
        return {"type": "object", "properties": {"scene": {"type": "string"}, "confirmed": {"type": "boolean"}}, "required": ["scene"]}

    def run(self, args: dict) -> str:
        scene, err = match_one(self._api.scenes(), str(args.get("scene", "")), "scene")
        if err:
            return err
        if not args.get("confirmed"):
            return f"{CONFIRM} Deleting the scene {scene['name']} can't be undone."
        self._api.delete_scene(scene["id"])
        return f"Deleted the scene {scene['name']}."


def management_tools(api: HomeApi, devices: Sequence[dict], me: str = "", public_url: str = "", tz=None) -> List[Tool]:
    return [HomeOverviewTool(api, me, tz), PowerHistoryTool(api, tz), AddRoomTool(api), RenameRoomTool(api), DeleteRoomTool(api, devices),
            UpdateDeviceTool(api, devices), ListPeopleTool(api), InvitePersonTool(api, public_url),
            UpdatePersonTool(api), RemovePersonTool(api), CreateSceneTool(api, devices), DeleteSceneTool(api)]


# ------------------------------------------------------------------ the console (staff, read only)
class HomeDetailsTool(Tool):
    name = "home_details"
    description = ("One home the person looks after: its status, owner and installer, every room with how many "
                   "devices it has and how many are on, every board (online or offline, devices, firmware) and how "
                   "many people. Find it by the home's name, its owner or its city. Read only.")

    def __init__(self, api: HomeApi) -> None:
        self._api = api

    @property
    def parameters(self) -> dict:
        return {"type": "object", "properties": {"home": {"type": "string", "description": "Home name, owner or city"}},
                "required": ["home"]}

    def run(self, args: dict) -> str:
        home, err = match_one(self._api.platform_homes(), str(args.get("home", "")), "home", "name", "owner", "city")
        if err:
            return err
        w = self._api.platform_home(home["id"])
        h, stats = w.get("home", {}), w.get("stats", {})
        owner = (h.get("owner") or {}).get("name") or ((h.get("ownerInvite") or {}).get("email") and f"invited: {h['ownerInvite']['email']}") or "none yet"
        lines = [f"{h.get('name')} ({h.get('city') or 'no city'}): {h.get('statusLabel') or h.get('status')}. "
                 f"Owner: {owner}. Installer: {(h.get('installer') or {}).get('name') or 'none'}. "
                 f"People: {stats.get('people', 0)}. Devices: {stats.get('devices', 0)}. "
                 f"Boards online: {stats.get('boardsOnline', 0)} of {stats.get('boardsTotal', 0)}."]
        rooms = w.get("rooms") or []
        lines.append(f"Rooms ({len(rooms)}):")
        lines += [f"- {r['name']}: {r.get('devices', 0)} devices" + (f", {r['on']} on" if r.get("on") else "")
                  + (" (a board here is offline)" if r.get("offline") else "") for r in rooms]
        if w.get("unroomed"):
            lines.append(f"- Not in a room: {w['unroomed']} devices")
        boards = w.get("boards") or []
        lines.append(f"Boards ({len(boards)}):")
        lines += [f"- {b.get('name') or b.get('id')}: {b.get('condText') or ('online' if b.get('online') else 'offline')}, "
                  f"{b.get('devices', 0)} devices, last seen {b.get('lastSeen') or 'never'}, firmware {b.get('firmware') or '?'}"
                  + (" (update available)" if b.get("firmwareOld") else "") for b in boards]
        return "\n".join(lines)


# ------------------------------------------------------------------ power cuts and outages
def _dur(seconds: float) -> str:
    m = round(seconds / 60)
    if m < 1:
        return f"{max(1, round(seconds))} seconds"
    if m < 60:
        return f"{m} min"
    return f"{m // 60} h" + (f" {m % 60} min" if m % 60 else "")


def _local(iso: str, tz) -> str:
    at = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    if tz is not None:
        at = at.astimezone(tz)
    return at.strftime("%a %d %b %I:%M %p").replace(" 0", " ")


def outages_text(data: Dict[str, Any], tz=None, limit: int = 12) -> str:
    """A home's power cuts and internet outages, in words."""
    s = data.get("summary") or {}
    days = data.get("days", 7)
    lines = [f"Last {days} days: {s.get('powerCuts', 0)} power cuts ({_dur(s.get('powerSeconds', 0))} without power), "
             f"{s.get('networkOuts', 0)} times the Wi-Fi or internet was down ({_dur(s.get('networkSeconds', 0))}), "
             f"{s.get('restarts', 0)} board restarts, {s.get('crashes', 0)} restarts after a fault."]
    for o in (data.get("outages") or [])[:limit]:
        lines.append(f"- {o['label']}: {_local(o['startedAt'], tz)} to {_local(o['endedAt'], tz)} ({_dur(o['seconds'])}), {o['board']}"
                     + (f", the board said “{o['reset']}”" if o.get("kind") == "CRASH" and o.get("reset") else ""))
    if len(lines) == 1:
        lines.append("No power cuts or outages in that time.")
    return "\n".join(lines)


class PowerHistoryTool(Tool):
    name = "power_history"
    description = ("Power cuts and Wi-Fi/internet outages in this home, with times and how long: 'when did the power go', "
                   "'how many power cuts this week', 'was the internet down last night'. Worked out from the boards: a board "
                   "that restarted with 'Power On' lost power; one that stayed on lost the internet.")

    def __init__(self, api: HomeApi, tz=None) -> None:
        self._api, self._tz = api, tz

    @property
    def parameters(self) -> dict:
        return {"type": "object", "properties": {"days": {"type": "integer", "description": "How far back (default 7, up to 90)"}}}

    def run(self, args: dict) -> str:
        days = max(1, min(90, int(args.get("days") or 7)))
        return outages_text(self._api.outages(days), self._tz)


class FleetOutagesTool(Tool):
    name = "outages_overview"
    description = ("Across the homes this person looks after: boards offline right now and since when, area power cuts "
                   "(two or more homes in one place at once: probably load-shedding), and power cuts and internet outages "
                   "per home. Read only.")

    def __init__(self, api: HomeApi, tz=None) -> None:
        self._api, self._tz = api, tz

    @property
    def parameters(self) -> dict:
        return {"type": "object", "properties": {"days": {"type": "integer", "description": "How far back (default 7)"}}}

    def run(self, args: dict) -> str:
        days = max(1, min(30, int(args.get("days") or 7)))
        d = self._api.platform_outages(days)
        lines = [f"Last {days} days."]
        down = d.get("down") or []
        lines.append(f"Offline now: {len(down)}." + "".join(
            f"\n- {b['home']}: {b['board']} since {_local(b['since'], self._tz) if b.get('since') else 'unknown'}"
            + (f" ({b['place'].split(',')[0]})" if b.get("place") else "") for b in down[:15]))
        areas = d.get("areas") or []
        if areas:
            lines.append("Area power cuts:" + "".join(
                f"\n- {a['place'].split(',')[0]}: {_local(a['startedAt'], self._tz)} for {_dur(a['seconds'])}, homes: {', '.join(a['homes'])}" for a in areas[:10]))
        homes = d.get("homes") or []
        if homes:
            lines.append("Per home (most time without power or internet first):" + "".join(
                f"\n- {h['home']}: {h['power']} power cuts ({_dur(h['powerSeconds'])}), internet down {h['network']} times ({_dur(h['networkSeconds'])})"
                + (f", {h['crashes']} board faults" if h["crashes"] else "") for h in homes[:15]))
        else:
            lines.append("No power cuts or outages recorded.")
        return "\n".join(lines)

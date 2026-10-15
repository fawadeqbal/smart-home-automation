"""Board connections for the assistant: is a board online, since when, where it reaches the server from
(the home's internet address, its city and provider), how often it dropped and why.

Two places, same facts:
  * the console (staff): every board in the homes the person looks after. The API decides which homes
    those are from their role: super admins and support every home of the company, installers only the
    homes assigned to them. A board outside that is "not found" for them, so the assistant can't leak it.
  * a home (owners and admins): that home's boards. Family members and guests are refused by the API,
    like in the app, and the assistant says so.

Everything here only reads; nothing changes a board.
"""
from __future__ import annotations

from datetime import datetime, timezone, tzinfo
from typing import Any, Dict, List, Optional

from .home_api import HomeApi, HomeApiError
from .tools import Tool, _norm, home_zone, spoken_clock

# how a connection ended, in the words the app uses (apps/web/src/components/ConnectionPanel.tsx)
ENDS: Dict[str, str] = {
    "timeout": "lost contact (it stopped answering: power cut, or Wi-Fi or internet down)",
    "closed": "connection cut (dropped without a goodbye: the board reset, or the router or network cut it)",
    "clean": "restarted on purpose (an update, a Wi-Fi change or a restart)",
    "replaced": "short drop (it came straight back)",
    "error": "closed by the server",
}
SHORT = {"timeout": "lost contact", "closed": "cut", "clean": "restarted on purpose", "replaced": "short drop", "error": "closed by the server"}

ROLE_TEXT = {
    "SUPERADMIN": "a super admin of {company}: they see every home and every board of the company",
    "SUPPORT": "support staff of {company}: they see every home and board, read-only",
    "INSTALLER": ("an installer of {company}: they only see the homes assigned to them. Other homes and boards do "
                  "not exist for them; never guess or say anything about them"),
}


def _parse(iso: Optional[str]) -> Optional[datetime]:
    if not iso:
        return None
    return datetime.fromisoformat(iso.replace("Z", "+00:00"))


def when_text(iso: Optional[str], tz: tzinfo) -> str:
    """'just now', '25 minutes ago', '3 hours ago', 'on 14 October at seven thirty pm'."""
    then = _parse(iso)
    if then is None:
        return "never"
    minutes = int((datetime.now(timezone.utc) - then).total_seconds() // 60)
    if minutes < 2:
        return "just now"
    if minutes < 120:
        return f"{minutes} minutes ago"
    if minutes < 24 * 60:
        return f"{minutes // 60} hours ago"
    local = then.astimezone(tz)
    return local.strftime("on %d %B at ").replace(" 0", " ") + spoken_clock(local.hour, local.minute)


def span_text(seconds: float) -> str:
    s = max(0, int(seconds))
    if s < 60:
        return f"{s} seconds"
    m = s // 60
    if m < 60:
        return f"{m} minutes"
    h = m // 60
    if h < 24:
        return f"{h} hours {m % 60} minutes" if m % 60 else f"{h} hours"
    d = h // 24
    return f"{d} day{'s' if d != 1 else ''}" + (f" {h % 24} hours" if h % 24 else "")


def where_text(ip: Optional[str], place: Optional[str], isp: Optional[str]) -> str:
    if not ip:
        return "not seen yet"
    extra = ", ".join(x for x in [place, isp] if x)
    return f"{ip} ({extra})" if extra else ip


def drops_text(ends: Dict[str, int]) -> str:
    parts = [f"{SHORT[k]} {n} time{'s' if n != 1 else ''}" for k, n in ends.items() if n and k in SHORT]
    return ", ".join(parts) if parts else "no drops"


def board_line(b: Dict[str, Any], tz: tzinfo) -> str:
    """One board of the fleet in a sentence."""
    home = b.get("home") or {}
    who = ", ".join(x for x in [home.get("city"), f"installer {home['installer']}" if home.get("installer") else None] if x)
    head = f"Board \"{b.get('name') or b['id']}\" ({b['id']}) in {home.get('name', 'no home')}" + (f" ({who})" if who else "")
    if b.get("online"):
        since = _parse(b.get("connectedSince"))
        up = f"online for {span_text((datetime.now(timezone.utc) - since).total_seconds())}" if since else "online"
    else:
        up = f"OFFLINE, last heard from {when_text(b.get('lastSeenAt'), tz)}"
    last = b.get("lastEnd") or {}
    last_text = f"; last drop {when_text(last.get('at'), tz)}: {SHORT.get(last.get('reason') or '', last.get('reason') or 'ended')}" if last.get("at") else ""
    return (f"{head}: {up}; connects from {where_text(b.get('publicIp'), b.get('publicPlace'), b.get('publicIsp'))}; "
            f"last 7 days {b.get('connects7d', 0)} connections, {drops_text(b.get('ends7d') or {})}{last_text}.")


def fleet_summary(fleet: Dict[str, Any]) -> str:
    """For the console prompt: how many boards, how many offline, which ones need a look."""
    boards: List[dict] = fleet.get("boards", [])
    if not boards:
        return "No boards in the homes this person looks after yet."
    offline = [b for b in boards if not b.get("online")]
    shaky = [b for b in boards if (b.get("ends7d") or {}).get("timeout", 0) >= 3]
    homes = {(b.get("home") or {}).get("id") for b in boards}
    lines = [f"{len(boards)} boards in {len(homes)} homes: {len(boards) - len(offline)} online, {len(offline)} offline."]
    if offline:
        lines.append("Offline: " + "; ".join(f"{b.get('name') or b['id']} in {(b.get('home') or {}).get('name', '?')}" for b in offline[:10]) + ".")
    if shaky:
        lines.append("Lost contact 3 or more times this week: " + "; ".join(f"{b.get('name') or b['id']} in {(b.get('home') or {}).get('name', '?')}" for b in shaky[:10]) + ".")
    if not fleet.get("tracking", True):
        lines.append("Connection history (public IP, place, drops) is not switched on on this server, only online/offline.")
    return " ".join(lines)


def history_text(info: Dict[str, Any], tz: tzinfo, limit: int = 10) -> str:
    """One board's connection story."""
    board = info.get("board") or {}
    home = board.get("home") or {}
    cur = info.get("current") or {}
    name = f"Board \"{board.get('name') or board.get('id')}\"" + (f" in {home['name']}" if home.get("name") else "")
    if board.get("online"):
        since = _parse(cur.get("connectedSince"))
        status = f"online for {span_text((datetime.now(timezone.utc) - since).total_seconds())}" if since else "online"
    else:
        status = f"offline, last heard from {when_text(board.get('lastSeenAt'), tz)}"
    parts = [f"{name} is {status}."]
    if cur.get("ip"):
        parts.append(f"It reaches the server from {where_text(cur.get('ip'), cur.get('place'), cur.get('isp'))}, "
                     f"the same address since {when_text(cur.get('ipSince'), tz)}. The place is the internet provider's city, not the street.")
    stats = info.get("stats") or {}
    parts.append(f"Last 7 days: {stats.get('connects7d', 0)} connections ({stats.get('connects24h', 0)} in the last 24 hours), "
                 f"{drops_text(stats.get('ends7d') or {})}; {stats.get('addresses7d', 0)} different internet addresses.")
    rows = info.get("history") or []
    if rows:
        lines = []
        for i, r in enumerate(rows[:limit]):
            start = when_text(r.get("connectedAt"), tz)
            frm = where_text(r.get("ip"), r.get("place"), r.get("isp"))
            if not r.get("endedAt"):
                end = "still connected" if i == 0 and board.get("online") else "end not recorded"
            else:
                end = f"lasted {span_text(r.get('seconds', 0))}, ended: {r.get('endNote') or ENDS.get(r.get('endReason') or '', 'ended')}"
            lines.append(f"connected {start} from {frm}{' (new address)' if r.get('newAddress') else ''}, {end}")
        parts.append("Recent connections, newest first: " + "; ".join(lines) + ".")
    elif info.get("tracking") is False:
        parts.append("Connection history is not switched on on this server.")
    else:
        parts.append("No connections recorded yet.")
    return " ".join(parts)


def _pick(boards: List[dict], wanted: str) -> List[dict]:
    """Boards matching a name, id or home name (exact first, then partial)."""
    w = _norm(wanted)
    if not w:
        return boards
    def names(b):
        return [_norm(b.get("name") or ""), _norm(b["id"]), _norm((b.get("home") or {}).get("name") or "")]
    exact = [b for b in boards if w in names(b)]
    return exact or [b for b in boards if any(w in n for n in names(b) if n)]


class FleetStatusTool(Tool):
    """Console: every board the person looks after (their role decides which), with connection health."""
    name = "fleet_status"
    description = (
        "List the boards this staff member looks after, with online/offline, since when, where each connects from "
        "(public IP, city, internet provider) and how often it dropped in the last 7 days and why. Optional filters: "
        "a home or board name, a city or provider, or only boards that are offline or keep dropping."
    )

    def __init__(self, api: HomeApi, tz: Optional[tzinfo] = None) -> None:
        self._api = api
        self._tz = tz or home_zone(None)

    @property
    def parameters(self) -> dict:
        return {"type": "object", "properties": {
            "match": {"type": "string", "description": "home, board, city or provider name to narrow the list (optional)"},
            "only": {"type": "string", "enum": ["all", "offline", "dropping"], "description": "offline now, or lost contact 3+ times this week"},
        }}

    def run(self, args: dict) -> str:
        try:
            fleet = self._api.connectivity()
        except HomeApiError as exc:
            return f"Error: {exc}"
        boards = fleet.get("boards", [])
        match = _norm(str(args.get("match") or ""))
        if match:
            boards = [b for b in boards if any(match in _norm(str(x or "")) for x in [
                b.get("name"), b.get("id"), (b.get("home") or {}).get("name"), (b.get("home") or {}).get("city"),
                b.get("publicPlace"), b.get("publicIsp"), (b.get("home") or {}).get("installer")])]
        only = args.get("only") or "all"
        if only == "offline":
            boards = [b for b in boards if not b.get("online")]
        elif only == "dropping":
            boards = [b for b in boards if (b.get("ends7d") or {}).get("timeout", 0) >= 3]
        if not boards:
            return "No boards match." if (match or only != "all") else "This person looks after no boards yet."
        lines = [board_line(b, self._tz) for b in boards[:30]]
        more = f" And {len(boards) - 30} more." if len(boards) > 30 else ""
        return f"{len(boards)} boards. " + " ".join(lines) + more


class BoardConnectionsTool(Tool):
    """One board's connection story: in the console (any board in scope) or in a home (its boards)."""
    name = "board_connections"
    description = (
        "One board's internet connection: online or not and since when, its public IP with city and provider, "
        "every recent connection and why each ended (lost contact = power or Wi-Fi/internet down, cut, restarted on "
        "purpose, short drop). Use it for 'why did it go offline', 'where is it connecting from', 'is it stable'."
    )

    def __init__(self, api: HomeApi, tz: Optional[tzinfo] = None, console: bool = False) -> None:
        self._api = api
        self._tz = tz or home_zone(None)
        self._console = console

    @property
    def parameters(self) -> dict:
        return {"type": "object", "properties": {
            "board": {"type": "string", "description": "board name or id, or the home's name (console); optional if there is one board"},
        }}

    def _boards(self) -> List[dict]:
        if self._console:
            return self._api.connectivity().get("boards", [])
        return [b for b in self._api.nodes() if b.get("status") in (None, "ADOPTED", "ASSIGNED")]

    def run(self, args: dict) -> str:
        try:
            boards = self._boards()
        except HomeApiError as exc:
            if not self._console:
                return ("Error: this person can't see the home's boards (only the home's owner and admins can). "
                        "Tell them to ask the owner or the installer.")
            return f"Error: {exc}"
        picked = _pick(boards, str(args.get("board") or ""))
        if not picked:
            names = ", ".join(f"{b.get('name') or b['id']}" + (f" in {(b.get('home') or {}).get('name')}" if self._console else "") for b in boards[:15])
            return f"Error: no board matches that. Boards: {names or 'none'}."
        if len(picked) > 1:
            names = "; ".join(f"{b.get('name') or b['id']} ({b['id']})" + (f" in {(b.get('home') or {}).get('name')}" if self._console else "") for b in picked[:10])
            return f"Error: several boards match. Ask which one: {names}."
        board = picked[0]
        try:
            info = (self._api.board_connections(board["id"]) if self._console else self._api.node_connections(board["id"]))
        except HomeApiError as exc:
            return f"Error: {exc}"
        return history_text(info, self._tz)


def role_text(staff_role: str, company: str) -> str:
    return ROLE_TEXT.get(staff_role, "staff of {company}").format(company=company or "the company")

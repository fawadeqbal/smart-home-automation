"""Client for the platform API, used by the device tools.

Every call carries the short-lived token of the person speaking, so the API applies THEIR rights:
the assistant can never switch something the person could not switch in the web app.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

import httpx


class HomeApiError(Exception):
    """The API refused or failed. The message is safe to read out to the person."""


class HomeApi:
    def __init__(self, base_url: str, token: str, client: Optional[httpx.Client] = None) -> None:
        self._base = f"{base_url.rstrip('/')}/api"
        self._client = client or httpx.Client(timeout=10)
        self._headers = {"Authorization": f"Bearer {token}"}

    def _call(self, method: str, path: str, json: Any = None) -> Any:
        try:
            response = self._client.request(method, f"{self._base}{path}", json=json, headers=self._headers)
        except httpx.HTTPError as exc:
            raise HomeApiError("I cannot reach the home server right now.") from exc
        if response.status_code >= 400:
            try:
                message = response.json().get("message")
            except ValueError:
                message = None
            if isinstance(message, list):
                message = "; ".join(map(str, message))
            raise HomeApiError(message or f"The home server answered with error {response.status_code}.")
        return response.json() if response.content else None

    def devices(self) -> List[Dict[str, Any]]:
        return self._call("GET", "/devices")

    def command(self, device_id: str, command: Dict[str, Any]) -> Dict[str, Any]:
        return self._call("POST", f"/devices/{device_id}/commands", command)

    # timers, daily schedules and scenes (run later with this person's rights)
    def schedules(self) -> List[Dict[str, Any]]:
        return self._call("GET", "/schedules")

    def create_schedule(self, body: Dict[str, Any]) -> Dict[str, Any]:
        return self._call("POST", "/schedules", body)

    def delete_schedule(self, schedule_id: str) -> None:
        self._call("DELETE", f"/schedules/{schedule_id}")

    def scenes(self) -> List[Dict[str, Any]]:
        return self._call("GET", "/scenes")

    def run_scene(self, scene_id: str) -> Dict[str, Any]:
        return self._call("POST", f"/scenes/{scene_id}/run", {})

    # the Help Center (published articles this person may read) and the home's boards (owners, admins)
    def help_key(self, customer_view: bool = False) -> str:
        return self._call("GET", "/help/feed" + ("?view=customer" if customer_view else ""))["key"]

    def help_articles(self, customer_view: bool = False) -> List[Dict[str, Any]]:
        return self._call("GET", "/help/feed?articles=1" + ("&view=customer" if customer_view else ""))["articles"]

    def nodes(self) -> List[Dict[str, Any]]:
        return self._call("GET", "/nodes")

    def node_connections(self, node_id: str) -> Dict[str, Any]:
        """One board of the current home: its public IP, place, provider and recent connections (owners, admins)."""
        return self._call("GET", f"/nodes/{node_id}/connections")

    # managing the home (the API allows each only to the roles that may do it in the app)
    def rooms(self) -> List[Dict[str, Any]]:
        return self._call("GET", "/rooms")

    def create_room(self, name: str) -> Dict[str, Any]:
        return self._call("POST", "/rooms", {"name": name})

    def update_room(self, room_id: str, name: str) -> Dict[str, Any]:
        return self._call("PATCH", f"/rooms/{room_id}", {"name": name})

    def delete_room(self, room_id: str) -> None:
        self._call("DELETE", f"/rooms/{room_id}")

    def update_device(self, device_id: str, body: Dict[str, Any]) -> Dict[str, Any]:
        return self._call("PATCH", f"/devices/{device_id}", body)

    def users(self) -> List[Dict[str, Any]]:
        return self._call("GET", "/users")

    def invites(self) -> List[Dict[str, Any]]:
        return self._call("GET", "/invites")

    def invite(self, body: Dict[str, Any]) -> Dict[str, Any]:
        return self._call("POST", "/invites", body)

    def update_user(self, user_id: str, body: Dict[str, Any]) -> Dict[str, Any]:
        return self._call("PATCH", f"/users/{user_id}", body)

    def set_user_rooms(self, user_id: str, rooms: List[Dict[str, str]]) -> Any:
        return self._call("PUT", f"/users/{user_id}/rooms", {"rooms": rooms})

    def remove_user(self, user_id: str) -> None:
        self._call("DELETE", f"/users/{user_id}")

    def create_scene(self, body: Dict[str, Any]) -> Dict[str, Any]:
        return self._call("POST", "/scenes", body)

    def delete_scene(self, scene_id: str) -> None:
        self._call("DELETE", f"/scenes/{scene_id}")

    # rules ("when this happens, do that"), away mode, where the home is
    def rules(self) -> List[Dict[str, Any]]:
        return self._call("GET", "/rules")

    def create_rule(self, body: Dict[str, Any]) -> Dict[str, Any]:
        return self._call("POST", "/rules", body)

    def update_rule(self, rule_id: str, body: Dict[str, Any]) -> Dict[str, Any]:
        return self._call("PATCH", f"/rules/{rule_id}", body)

    def delete_rule(self, rule_id: str) -> None:
        self._call("DELETE", f"/rules/{rule_id}")

    def away(self) -> Dict[str, Any]:
        return self._call("GET", "/home/away")

    def set_away(self, body: Dict[str, Any]) -> Dict[str, Any]:
        return self._call("PUT", "/home/away", body)

    def location(self) -> Dict[str, Any]:
        return self._call("GET", "/home/location")

    def billing(self) -> Dict[str, Any]:
        return self._call("GET", "/billing")

    def tickets(self) -> List[Dict[str, Any]]:
        return self._call("GET", "/support/tickets")

    def open_ticket(self, body: Dict[str, Any]) -> Dict[str, Any]:
        return self._call("POST", "/support/tickets", body)

    def memories(self) -> List[Dict[str, Any]]:
        """What this person asked the assistant to remember in this home (theirs alone)."""
        return self._call("GET", "/assistant/memory")

    def remember(self, text: str) -> Dict[str, Any]:
        return self._call("POST", "/assistant/memory", {"text": text})

    def forget(self, memory_id: str) -> None:
        self._call("DELETE", f"/assistant/memory/{memory_id}")

    def summary(self, period: str = "week") -> Dict[str, Any]:
        return self._call("GET", f"/home/summary?period={period}")

    def energy(self, days: int = 7) -> Dict[str, Any]:
        """Electricity estimates for the switches this person can see."""
        return self._call("GET", f"/energy?days={days}")

    def power(self) -> Dict[str, Any]:
        """On UPS or not, and the next expected load-shedding cut (everyone in the home)."""
        return self._call("GET", "/power")

    def shedding(self) -> Dict[str, Any]:
        """The load-shedding windows (typed by the owner, or learned from power cuts) and the next one."""
        return self._call("GET", "/power/shedding")

    def bill(self) -> Dict[str, Any]:
        """This billing month from the meter readings: units, projection, cost, protected limit (owners, admins)."""
        return self._call("GET", "/power/bill")

    def outages(self, days: int = 7) -> Dict[str, Any]:
        """Power cuts, Wi-Fi/internet outages and board restarts in this home (everyone in the home may see them)."""
        return self._call("GET", f"/outages?days={days}")

    def platform_outages(self, days: int = 7) -> Dict[str, Any]:
        return self._call("GET", f"/platform/outages?days={days}")

    # the console (staff): the homes they look after, and one home's rooms, boards and people
    def platform_homes(self) -> List[Dict[str, Any]]:
        return self._call("GET", "/platform/homes")

    def platform_home(self, home_id: str) -> Dict[str, Any]:
        return self._call("GET", f"/platform/homes/{home_id}")

    # the console (staff): every board in the homes this person looks after; their role decides which
    def connectivity(self) -> Dict[str, Any]:
        return self._call("GET", "/platform/connectivity")

    def board_connections(self, node_id: str) -> Dict[str, Any]:
        return self._call("GET", f"/platform/boards/{node_id}/connections")

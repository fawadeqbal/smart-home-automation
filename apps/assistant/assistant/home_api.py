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

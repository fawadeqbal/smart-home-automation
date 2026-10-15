"""Fakes so the tests run without a model, a microphone, a voice or the platform API."""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Callable, List, Optional, Sequence

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from assistant.domain.models import ChatMessage, LLMReply, ToolCall, ToolSpec  # noqa: E402


class FakeLLM:
    name = "fake"

    def __init__(self, respond: Optional[Callable[[Sequence[ChatMessage], Sequence[ToolSpec]], LLMReply]] = None):
        self.calls: List[dict] = []
        self._respond = respond or (lambda msgs, tools: LLMReply(text=f"echo: {msgs[-1].content}"))

    def chat(self, system, messages, tools):
        self.calls.append({"system": system, "messages": list(messages), "tools": list(tools)})
        return self._respond(messages, tools)


def bulb_llm(state: str = "on") -> FakeLLM:
    """Asks set_device(bulb) when the person mentions the bulb, then repeats the tool result."""
    def respond(msgs, tools):
        last = msgs[-1]
        if last.role.value == "tool":
            return LLMReply(text=f"Done: {last.content}")
        if "bulb" in last.content:
            return LLMReply(text="", tool_calls=[ToolCall("c1", "set_device", {"device": "bulb", "state": state})])
        return LLMReply(text=f"echo: {last.content}")
    return FakeLLM(respond)


class FakeSTT:
    def __init__(self, text: str = "turn on the bulb"):
        self.text = text

    def transcribe(self, audio, hint=""):
        self.hint = hint
        return self.text if audio else ""


class FakeTTS:
    def synthesize(self, text):
        return b"RIFFfake" if text else None


class FakeApi:
    """Stands in for HomeApi; remembers the token it was made with and the commands sent."""

    def __init__(self, token: str, devices: List[dict]):
        self.token = token
        self._devices = devices
        self.commands: List[tuple] = []

    def devices(self):
        return self._devices

    def command(self, device_id, command):
        self.commands.append((device_id, command))
        device = next(d for d in self._devices if d["id"] == device_id)
        device["state"] = {"on": command["on"]}
        return device

    # schedules: kept in memory like the server would
    def schedules(self):
        return getattr(self, "_schedules", [])

    def create_schedule(self, body):
        self._schedules = self.schedules() + [{
            "id": f"s{len(self.schedules()) + 1}", "name": "Bulb off", "enabled": True, "kind": body["kind"],
            "time": body.get("time"), "days": body.get("days", []), "runAt": body.get("runAt"),
            "nextRunAt": body.get("runAt") or "2030-01-01T12:00:00Z",
            "actions": [{**a, "deviceName": "Bulb"} for a in body["actions"]], "body": body,
        }]
        return self._schedules[-1]

    def delete_schedule(self, schedule_id):
        self._schedules = [s for s in self.schedules() if s["id"] != schedule_id]

    def scenes(self):
        return []

    # the Help Center and the boards: set by tests that need them
    help: List[dict] = []
    help_version = "org1:everyone:0:0"
    boards: Optional[List[dict]] = None
    help_calls = 0

    def help_key(self, customer_view=False):
        return self.help_version + (":customer" if customer_view else "")

    def help_articles(self, customer_view=False):
        type(self).help_calls += 1
        return [a for a in self.help if not customer_view or a.get("audience", "EVERYONE") == "EVERYONE"]

    def nodes(self):
        from assistant.home_api import HomeApiError
        if self.boards is None:
            raise HomeApiError("You do not have permission for this.")
        return self.boards


def device(id: str, name: str, room: str = "Living room", access: str = "CONTROL", controllable: bool = True,
           aliases=(), online: bool = True, state=None, fields=None) -> dict:
    return {"id": id, "key": name.lower().replace(" ", "_"), "name": name, "aliases": list(aliases),
            "roomName": room, "access": access, "controllable": controllable, "online": online,
            "state": state if state is not None else ({"on": False} if controllable else {}),
            "stateFields": fields or ([{"key": "on", "label": "On"}] if controllable else [])}


@pytest.fixture
def devices():
    return [
        device("d1", "Bulb", aliases=["batti"]),
        device("d2", "Fan", room="Bedroom", access="VIEW"),
        device("d3", "Room climate", controllable=False, state={"temperature": 27.5, "humidity": 52},
               fields=[{"key": "temperature", "label": "Temperature", "unit": "°C"},
                       {"key": "humidity", "label": "Humidity", "unit": "%"}]),
    ]

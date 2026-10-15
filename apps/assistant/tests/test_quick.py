"""Everyday commands are answered without the AI model (fast), through the same tools and rights."""
from datetime import datetime, timezone

import pytest

from assistant.conversation import ConversationService, PromptBuilder
from assistant.domain.models import LLMReply, ToolCall
from assistant.quick import QuickCommands, parse_state, parse_when
from assistant.tools import build_tools

from conftest import FakeApi, FakeLLM, device

NOW = datetime(2026, 10, 15, 14, 0, tzinfo=timezone.utc)


@pytest.fixture
def home():
    return [
        device("d1", "Bulb", room="Hall", aliases=["batti"]),
        device("d2", "Fan", room="Bedroom", aliases=["pankha"]),
        device("d3", "Light", room="Kitchen"),
        device("d4", "Light", room="Bedroom"),
        device("d5", "Geyser", room="Bath", access="VIEW"),
        device("d6", "Climate", room="Hall", controllable=False, state={"temperature": 27.5, "humidity": 52},
               fields=[{"key": "temperature", "label": "Temperature", "unit": "°C"}, {"key": "humidity", "label": "Humidity", "unit": "%"}]),
    ]


def quick(devices):
    api = FakeApi("tok", devices)
    return QuickCommands(api, devices, build_tools(api, devices), clock=lambda: NOW), api


def test_the_sentence_from_the_screenshot_sets_a_one_minute_timer(home):
    q, api = quick(home)
    reply = q.handle("please set timer 1 minute after the bulb will turn on")
    assert reply == "OK, the Bulb in the Hall turns on in 1 minute, at 2:01 pm."
    assert api.schedules()[0]["body"] == {"actions": [{"deviceId": "d1", "on": True}], "kind": "ONCE", "inMinutes": 1}
    assert api.commands == []                                    # not switched now


@pytest.mark.parametrize("text, device, on", [
    ("turn on the bulb", "d1", True),
    ("Bulb off please", "d1", False),
    ("batti band karo", "d1", False),
    ("pankha chala do", "d2", True),
    ("switch off the kitchen light", "d3", False),
    ("bedroom light on", "d4", True),
])
def test_switch_now(home, text, device, on):
    q, api = quick(home)
    assert q.handle(text).startswith("Done")
    assert api.commands == [(device, {"on": on})]


@pytest.mark.parametrize("text, body", [
    ("turn off the fan in 30 minutes", {"kind": "ONCE", "inMinutes": 30}),
    ("fan 5 minute baad band kar do", {"kind": "ONCE", "inMinutes": 5}),
    ("turn the bulb on after an hour", {"kind": "ONCE", "inMinutes": 60}),
    ("turn off the bulb in half an hour", {"kind": "ONCE", "inMinutes": 30}),
    ("every day at 11 pm turn off the bulb", {"kind": "DAILY", "time": "23:00", "days": []}),
    ("turn on the bulb at 7:30 pm on weekdays", {"kind": "DAILY", "time": "19:30", "days": [1, 2, 3, 4, 5]}),
])
def test_timers_and_schedules(home, text, body):
    q, api = quick(home)
    reply = q.handle(text)
    assert reply and reply.startswith("OK"), reply
    sent = api.schedules()[0]["body"]
    assert {k: sent[k] for k in body} == body


def test_at_a_clock_time(home):
    q, api = quick(home)
    assert q.handle("turn on the bulb at 9 pm") == "OK, the Bulb in the Hall turns on at 9 pm today."
    assert api.schedules()[0]["body"]["kind"] == "ONCE" and api.schedules()[0]["body"]["runAt"]


def test_on_for_some_minutes_switches_now_and_back_later(home):
    q, api = quick(home)
    reply = q.handle("turn on the fan for 10 minutes")
    assert api.commands == [("d2", {"on": True})]
    assert api.schedules()[0]["body"] == {"actions": [{"deviceId": "d2", "on": False}], "kind": "ONCE", "inMinutes": 10}
    assert reply.endswith("It turns off again in 10 minutes.")


def test_two_commands_in_one_sentence(home):
    q, api = quick(home)
    q.handle("turn off the bulb and turn on the fan")
    assert api.commands == [("d1", {"on": False}), ("d2", {"on": True})]


def test_same_name_in_two_rooms_asks_which(home):
    q, api = quick(home)
    assert q.handle("turn on the light") == "Which one do you mean: the Light in the Kitchen or the Light in the Bedroom?"
    assert api.commands == []
    q.handle("turn on all lights")
    assert sorted(c[0] for c in api.commands) == ["d1", "d3", "d4"]


def test_rights_are_the_same_as_in_the_app(home):
    q, api = quick(home)
    assert q.handle("turn on the geyser") is None               # view-only: not a switch for them -> the AI explains
    assert api.commands == []


@pytest.mark.parametrize("text", [
    "turn on the bulb if it gets dark",
    "don't turn off the fan",
    "why is the bulb on",
    "tell me a joke",
    "what's the weather in Lahore tomorrow",
    "turn on the bulb and also write a poem about lamps",
])
def test_anything_unusual_goes_to_the_ai(home, text):
    q, api = quick(home)
    assert q.handle(text) is None
    assert api.commands == []


def test_questions(home):
    q, api = quick(home)
    assert q.handle("what's the temperature?") == "It's 27.5 degrees in the Hall with 52 percent humidity."
    home[0]["state"] = {"on": True}
    assert q.handle("what's on") == "On right now: the Bulb in the Hall."
    assert q.handle("is the fan on?") == "The Fan in the Bedroom is off."


def test_list_and_cancel_timers(home):
    q, api = quick(home)
    q.handle("turn off the fan in 30 minutes")
    q.handle("turn off the bulb in 10 minutes")
    assert q.handle("which timers are set?").startswith("1.")
    assert q.handle("cancel the fan timer").startswith("Cancelled")
    assert len(api.schedules()) == 1
    assert q.handle("cancel all timers") == "Cancelled the timer."
    assert api.schedules() == []


def test_parsers():
    assert parse_state("band kar do") == "off" and parse_state("jala do") == "on" and parse_state("on off") is None
    assert parse_when("in 2 hours").minutes == 120
    assert parse_when("at 7 baje shaam").hour == 19
    assert parse_when("every day").__class__ is type(None)       # daily needs a time


def test_the_conversation_skips_the_ai_for_quick_commands(home):
    llm = FakeLLM()
    service = ConversationService(llm, PromptBuilder(__import__("pathlib").Path("nope.md")))
    q, api = quick(home)
    assert service.ask("u1", "Ali", "turn off the bulb", q._tools, q).startswith("Done")
    assert llm.calls == []
    # the AI still sees the exchange, so "turn it on again" makes sense to it
    service.ask("u1", "Ali", "tell me a joke", q._tools, q)
    assert [m.content for m in llm.calls[0]["messages"]][:2] == ["turn off the bulb", "Done, the Bulb in the Hall is off."]


def test_a_plain_action_by_the_ai_needs_one_round_only(home):
    def respond(msgs, tools):
        return LLMReply(text="", tool_calls=[ToolCall("c1", "schedule_device", {"device": "bulb", "state": "on", "in_minutes": 1})])
    llm = FakeLLM(respond)
    service = ConversationService(llm, PromptBuilder(__import__("pathlib").Path("nope.md")))
    q, api = quick(home)
    reply = service.ask("u1", "Ali", "could you be a dear and light up the bulb a minute from now", q._tools)
    assert len(llm.calls) == 1
    assert reply.startswith("OK. Set: Bulb in the Hall on at")


def test_bulb_means_the_lights_when_no_device_is_called_bulb():
    devs = [device("a", "Light 1", room="Hall"), device("b", "Light 2", room="Hall"), device("c", "Main light", room="Kitchen")]
    q, api = quick(devs)
    assert q.handle("please set timer 1 minute after the bulb will turn on") == \
        "Which one do you mean: the Light 1 in the Hall, the Light 2 in the Hall or the Main light in the Kitchen?"
    assert q.handle("turn on the kitchen bulb").startswith("Done, the Main light in the Kitchen is on")
    assert api.commands == [("c", {"on": True})]

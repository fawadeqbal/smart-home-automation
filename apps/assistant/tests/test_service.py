import base64
import json

import pytest
from fastapi.testclient import TestClient

from assistant.config import Settings
from assistant.domain.models import ToolCall
from assistant.tools import build_tools, find_device
from assistant.web import create_app

from conftest import FakeApi, FakeSTT, FakeTTS, bulb_llm

SECRET = "s3cret"


def make(devices, llm=None, stt=None):
    apis = []

    def factory(token):
        api = FakeApi(token, devices)
        apis.append(api)
        return api

    from assistant.knowledge import KnowledgeBase
    app = create_app(Settings(shared_secret=SECRET), llm=llm or bulb_llm(), stt=stt or FakeSTT(), tts=FakeTTS(),
                     api_factory=factory, knowledge=KnowledgeBase(None))
    return TestClient(app), apis


WHO = {"user_id": "u1", "user_name": "Ali", "home_id": "h1", "home_name": "Ali's house", "token": "tok-ali"}
HEADERS = {"X-Assistant-Secret": SECRET}


def test_requests_without_the_secret_are_refused(devices):
    client, _ = make(devices)
    assert client.post("/v1/chat", json={"text": "hi", **WHO}).status_code == 401
    assert client.post("/v1/chat", json={"text": "hi", **WHO}, headers={"X-Assistant-Secret": "no"}).status_code == 401


def test_chat_switches_through_the_api_with_the_persons_token(devices):
    client, apis = make(devices)
    res = client.post("/v1/chat", json={"text": "turn on the bulb", **WHO}, headers=HEADERS)
    assert res.status_code == 200
    body = res.json()
    assert body["reply"] == "Done, the Bulb in the Living room is on."   # answered instantly, no AI round
    assert base64.b64decode(body["audio"]) == b"RIFFfake"
    assert apis[0].token == "tok-ali"
    assert apis[0].commands == [("d1", {"on": True})]


def test_voice_transcribes_then_answers(devices):
    client, apis = make(devices)
    res = client.post("/v1/voice", files={"audio": ("speech", b"webm-bytes", "audio/webm")}, data=WHO, headers=HEADERS)
    assert res.json()["heard"] == "turn on the bulb"
    assert apis[0].commands == [("d1", {"on": True})]


def test_silence_gets_a_friendly_retry(devices):
    client, apis = make(devices, stt=FakeSTT(""))
    res = client.post("/v1/voice", files={"audio": ("speech", b"x", "audio/webm")}, data=WHO, headers=HEADERS)
    assert res.json()["reply"].startswith("Sorry, I did not catch that")
    assert all(api.commands == [] for api in apis)


def test_each_person_has_their_own_history_and_can_reset_it(devices):
    client, _ = make(devices)
    client.post("/v1/chat", json={"text": "hello", **WHO}, headers=HEADERS)
    client.post("/v1/chat", json={"text": "hi", "user_id": "u2", "user_name": "Sara", "home_id": "h1", "token": "t2"},
                headers=HEADERS)
    conv = client.app.state.conversation
    assert [m.content for m in conv.history("u1", "h1")] == ["hello", "echo: hello"]
    assert [m.content for m in conv.history("u2", "h1")] == ["hi", "echo: hi"]
    assert client.post("/v1/reset", json=WHO, headers=HEADERS).status_code == 204
    assert conv.history("u1", "h1") == []
    assert len(conv.history("u2", "h1")) == 2                           # Sara's conversation is untouched


def test_the_same_person_has_a_separate_conversation_in_each_home(devices):
    """Staff looking into several customers' homes (or an owner with two homes) never mix them up."""
    llm = bulb_llm()
    client, _ = make(devices, llm=llm)
    client.post("/v1/chat", json={"text": "hello", **WHO}, headers=HEADERS)
    other = {**WHO, "home_id": "h2", "home_name": "Sara's flat"}
    client.post("/v1/chat", json={"text": "tell me a joke", **other}, headers=HEADERS)
    conv = client.app.state.conversation
    assert [m.content for m in conv.history("u1", "h1")] == ["hello", "echo: hello"]
    assert [m.content for m in conv.history("u1", "h2")] == ["tell me a joke", "echo: tell me a joke"]
    assert [m.content for m in llm.calls[1]["messages"]] == ["tell me a joke"]   # nothing from the other home
    assert 'in the home "Sara\'s flat"' in llm.calls[1]["system"]


def test_a_fresh_chat_screen_starts_a_fresh_conversation(devices):
    llm = bulb_llm()
    client, _ = make(devices, llm=llm)
    client.post("/v1/chat", json={"text": "hello", **WHO}, headers=HEADERS)
    client.post("/v1/chat", json={"text": "again", "fresh": True, **WHO}, headers=HEADERS)
    assert [m.content for m in llm.calls[1]["messages"]] == ["again"]
    client.post("/v1/voice", files={"audio": ("speech", b"webm", "audio/webm")}, data={**WHO, "fresh": "true"},
                headers=HEADERS)
    conv = client.app.state.conversation
    assert [m.content for m in conv.history("u1", "h1")][0] == "turn on the bulb"


def test_a_quiet_conversation_is_forgotten():
    from pathlib import Path
    from assistant.conversation import ConversationService, PromptBuilder
    from assistant.tools import ToolRegistry
    from conftest import FakeLLM

    now = [0.0]
    llm = FakeLLM()
    service = ConversationService(llm, PromptBuilder(Path("nope.md")), idle_minutes=30, clock=lambda: now[0])
    tools = ToolRegistry([])
    service.ask("u1", "Ali", "hello", tools, home_id="h1")
    now[0] += 29 * 60
    service.ask("u1", "Ali", "still there", tools, home_id="h1")
    assert len(llm.calls[1]["messages"]) == 3
    now[0] += 31 * 60
    service.ask("u1", "Ali", "back later", tools, home_id="h1")
    assert [m.content for m in llm.calls[2]["messages"]] == ["back later"]


def test_the_ai_is_only_told_about_devices_the_person_may_switch(devices):
    llm = bulb_llm()
    client, _ = make(devices, llm=llm)
    client.post("/v1/chat", json={"text": "hello", **WHO}, headers=HEADERS)
    set_device = next(t for t in llm.calls[0]["tools"] if t.name == "set_device")
    assert "Bulb" in set_device.description and "Fan" not in set_device.description
    assert "You are talking to Ali." in llm.calls[0]["system"]


def test_tools_match_names_aliases_and_rooms(devices):
    assert [d["id"] for d in find_device(devices, "batti")] == ["d1"]
    assert [d["id"] for d in find_device(devices, "living room bulb")] == ["d1"]
    assert [d["id"] for d in find_device(devices, "the bulb")] == ["d1"]
    assert find_device(devices, "kettle") == []


def test_tool_results_cover_errors_sensors_and_states(devices):
    api = FakeApi("t", devices)
    tools = build_tools(api, devices)
    assert "no device called fan that you may switch" in tools.execute(ToolCall("1", "set_device", {"device": "fan", "state": "on"}))
    sensors = json.loads(tools.execute(ToolCall("2", "read_sensors", {})))
    assert sensors == {"Room climate in the Living room": "temperature 27.5°C, humidity 52%"}
    devices[1]["online"] = False
    states = json.loads(tools.execute(ToolCall("3", "get_devices", {})))
    assert states["Fan in the Bedroom"] == "offline" and states["Bulb in the Living room"] == "off"


def test_api_errors_are_reported_in_plain_words(devices):
    from assistant.home_api import HomeApiError

    class Offline(FakeApi):
        def command(self, device_id, command):
            raise HomeApiError("Bulb is offline: its board is not connected.")

    tools = build_tools(Offline("t", devices), devices)
    assert tools.execute(ToolCall("1", "set_device", {"device": "bulb", "state": "on"})) == \
        "Error: Bulb is offline: its board is not connected."


@pytest.mark.parametrize("missing", ["user_id", "token"])
def test_identity_is_required(devices, missing):
    client, _ = make(devices)
    body = {"text": "hi", **WHO}
    del body[missing]
    assert client.post("/v1/chat", json=body, headers=HEADERS).status_code == 422


def test_timer_and_cancel_go_through_the_schedule_tools(devices):
    api = FakeApi("tok", devices)
    tools = build_tools(api, devices)
    names = [t.name for t in tools.specs()]
    assert {"schedule_device", "list_schedules", "cancel_schedule"} <= set(names)
    assert "run_scene" not in names  # no scenes: the AI is not told about them

    out = tools.execute(ToolCall("1", "schedule_device", {"device": "bulb", "state": "off", "in_minutes": 30}))
    assert out.startswith("Scheduled")
    assert api.schedules()[0]["body"]["inMinutes"] == 30
    assert api.schedules()[0]["body"]["actions"][0]["on"] is False

    daily = tools.execute(ToolCall("2", "schedule_device", {"device": "bulb", "state": "on", "at_time": "19:30",
                                                             "repeat_daily": True, "days": ["monday", "friday"]}))
    assert "Scheduled" in daily and api.schedules()[1]["body"]["days"] == [1, 5]

    assert "1." in tools.execute(ToolCall("3", "list_schedules", {}))
    assert tools.execute(ToolCall("4", "cancel_schedule", {"which": "1"})).startswith("Cancelled")
    assert len(api.schedules()) == 1


def test_schedule_needs_a_time(devices):
    tools = build_tools(FakeApi("tok", devices), devices)
    assert tools.execute(ToolCall("1", "schedule_device", {"device": "bulb", "state": "off"})).startswith("Error")


def test_the_wake_word_is_not_part_of_the_request(devices):
    client, apis = make(devices, stt=FakeSTT("Hey Switchboard, turn on the bulb"))
    res = client.post("/v1/voice", files={"audio": ("speech", b"x", "audio/wav")}, data=WHO, headers=HEADERS).json()
    assert res["heard"] == "turn on the bulb" and apis[0].commands == [("d1", {"on": True})]
    from assistant.web import strip_wake_word
    assert strip_wake_word("Board, turn off the fan.", after_wake=True) == "turn off the fan."
    assert strip_wake_word("Davis, turn off the fan.", after_wake=True) == "turn off the fan."
    assert strip_wake_word("board light on please") == "board light on please"      # push-to-talk: words are words
    assert strip_wake_word("turn off the fan", after_wake=True) == "turn off the fan"
    client, apis = make(devices, stt=FakeSTT("Hey Switchboard."))
    res = client.post("/v1/voice", files={"audio": ("speech", b"x", "audio/wav")}, data=WHO, headers=HEADERS).json()
    assert res["reply"] == "Yes?" and apis[0].commands == []

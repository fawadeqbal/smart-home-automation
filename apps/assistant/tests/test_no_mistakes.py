"""Phrasings that used to do the wrong thing, plus the home clock, the AI's view of the home, speech
and the provider. Each case says what a person would expect."""
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

from assistant.config import Settings
from assistant.conversation import ConversationService, PromptBuilder
from assistant.domain.models import ChatMessage, LLMReply, Role, ToolCall
from assistant.llm.claude import to_claude_messages
from assistant.quick import QuickCommands
from assistant.speech.recognizer import is_phantom
from assistant.speech.tts import ChainTTS, is_urdu_script
from assistant.tools import build_tools, describe_home, home_zone

from conftest import FakeApi, FakeLLM, device

KHI = ZoneInfo("Asia/Karachi")
NOW = datetime(2026, 10, 15, 14, 0, tzinfo=timezone.utc)          # 7 pm in Karachi


@pytest.fixture
def home():
    return [
        device("d1", "Bulb", room="Hall", aliases=["batti"]),
        device("d2", "Fan", room="Bedroom", aliases=["pankha"]),
        device("d3", "Light", room="Kitchen"),
        device("d4", "Light", room="Bedroom"),
        device("d5", "Geyser", room="Bath", access="VIEW"),
        device("d7", "TV", room="Hall"),
        device("d8", "AC", room="Bedroom"),
        device("d6", "Climate", room="Hall", controllable=False, state={"temperature": 27.5, "humidity": 52},
               fields=[{"key": "temperature", "label": "Temperature", "unit": "°C"},
                       {"key": "humidity", "label": "Humidity", "unit": "%"}]),
    ]


def quick(devices):
    api = FakeApi("tok", devices)
    clock = lambda: NOW.astimezone(KHI)  # noqa: E731
    return QuickCommands(api, devices, build_tools(api, devices, KHI, clock), clock=clock), api


# ------------------------------------------------------------------ instant commands
def test_two_devices_with_one_verb_switch_both(home):
    q, api = quick(home)
    assert q.handle("turn on the fan and the bulb") == \
        "Done, the Fan in the Bedroom is on. Done, the Bulb in the Hall is on."
    assert api.commands == [("d2", {"on": True}), ("d1", {"on": True})]


def test_a_timer_for_some_minutes_is_a_delay_not_a_duration(home):
    q, api = quick(home)
    assert q.handle("set a timer for 5 minutes to turn off the ac") == \
        "OK, the AC in the Bedroom turns off in 5 minutes, at 7:05 pm."
    assert api.commands == []                                    # nothing switched now
    assert api.schedules()[0]["body"]["actions"] == [{"deviceId": "d8", "on": False}]


def test_hours_and_minutes_add_up(home):
    q, api = quick(home)
    q.handle("turn off the bulb in 2 hours 30 minutes")
    q.handle("turn off the bulb in 1 hour and 15 minutes")
    assert [s["body"]["inMinutes"] for s in api.schedules()] == [150, 75]


def test_questions_never_switch_anything(home):
    q, api = quick(home)
    assert q.handle("what's on tv") is None                     # about programmes: the AI answers
    assert q.handle("is the fan on") == "The Fan in the Bedroom is off."
    assert q.handle("are the lights on") == "The Light in the Kitchen is off. The Light in the Bedroom is off."
    assert api.commands == []


def test_a_command_with_a_reason_is_still_a_command(home):
    q, api = quick(home)
    assert q.handle("turn on the fan, it's hot") == "Done, the Fan in the Bedroom is on."
    assert api.commands == [("d2", {"on": True})]


def test_half_understood_sentences_go_to_the_ai_whole(home):
    q, api = quick(home)
    assert q.handle("turn on the tv and tell me a joke") is None
    assert q.handle("switch on the light and fan in the bedroom") is None
    assert api.commands == []


def test_a_room_without_that_device_is_not_guessed(home):
    q, api = quick(home)
    assert q.handle("turn on the fan in the guest room") is None
    assert q.handle("turn on the fan in the bathroom") is None
    assert q.handle("turn on the hall light") == "Done, the Bulb in the Hall is on."    # the hall's light is "Bulb"
    assert api.commands == [("d1", {"on": True})]


def test_a_bare_hour_is_the_next_one(home):
    q, api = quick(home)                                         # it is 7 pm
    assert q.handle("turn off the fan at 11") == "OK, the Fan in the Bedroom turns off at 11 pm today."
    assert api.schedules()[0]["body"]["runAt"] == "2026-10-15T18:00:00Z"        # 11 pm Karachi
    assert q.handle("turn off ac at 6 am") == "OK, the AC in the Bedroom turns off at 6 am tomorrow."
    assert api.schedules()[1]["body"]["runAt"] == "2026-10-16T01:00:00Z"


# ------------------------------------------------------------------ the home's clock (server runs on UTC)
def test_clock_times_are_the_homes_not_the_servers(home):
    api = FakeApi("tok", home)
    tools = build_tools(api, home, KHI, lambda: NOW)
    out = tools.execute(ToolCall("1", "schedule_device", {"device": "fan", "state": "off", "at_time": "23:00"}))
    assert api.schedules()[0]["body"]["runAt"] == "2026-10-15T18:00:00Z"
    assert "11 pm" in out
    assert home_zone("Not/AZone").utcoffset(NOW).total_seconds() == 5 * 3600


def test_the_ai_is_told_the_home_time_and_what_is_in_the_home(home):
    prompt = PromptBuilder(Path("nope.md"), clock=lambda: NOW)
    text = prompt.build("Ali", "Ali's house", KHI, describe_home(home))
    assert "Current date and time in the home: Thursday 15 October 2026, 19:00 (7:00 PM)." in text
    assert "Fan (also called pankha): off; you may switch it" in text
    assert "Geyser: off; view only, they may NOT switch it" in text
    assert "Climate: temperature 27.5°C, humidity 52%; sensor" in text


# ------------------------------------------------------------------ the conversation never breaks
def test_an_empty_ai_answer_is_not_kept(home):
    replies = iter([LLMReply(text=""), LLMReply(text="Hello again")])
    llm = FakeLLM(lambda msgs, tools: next(replies))
    service = ConversationService(llm, PromptBuilder(Path("nope.md")))
    tools = build_tools(FakeApi("t", home), home)
    assert service.ask("u1", "Ali", "hmm", tools) == "Sorry, I could not finish that request."
    assert service.ask("u1", "Ali", "hello", tools) == "Hello again"
    assert all(m.content for m in service.history("u1") if m.role == Role.ASSISTANT and not m.tool_calls)


def test_a_crash_inside_is_a_polite_reply_and_forgotten(home):
    def boom(msgs, tools):
        raise RuntimeError("bug")
    service = ConversationService(FakeLLM(boom), PromptBuilder(Path("nope.md")))
    assert service.ask("u1", "Ali", "hello", build_tools(FakeApi("t", home), home)).startswith("Sorry, something went wrong")
    assert service.history("u1") == []


def test_memory_keeps_recent_questions_even_after_many_actions(home):
    calls = []

    def respond(msgs, tools):
        calls.append(msgs)
        last = msgs[-1]
        if last.role == Role.USER and "fan" in last.content:
            return LLMReply(text="", tool_calls=[ToolCall(f"c{len(calls)}", "get_devices", {})])
        return LLMReply(text="ok")
    service = ConversationService(FakeLLM(respond), PromptBuilder(Path("nope.md")), max_turns=3)
    tools = build_tools(FakeApi("t", home), home)
    for i in range(5):
        service.ask("u1", "Ali", f"fan question {i}", tools)
    users = [m.content for m in service.history("u1") if m.role == Role.USER]
    assert users == ["fan question 2", "fan question 3", "fan question 4"]


def test_claude_messages_alternate_and_have_no_empty_text():
    msgs = [ChatMessage(Role.USER, "a"), ChatMessage(Role.USER, "b"),
            ChatMessage(Role.ASSISTANT, "", tool_calls=[ToolCall("t1", "get_devices", {})]),
            ChatMessage(Role.TOOL, "{}", tool_call_id="t1", tool_name="get_devices"),
            ChatMessage(Role.USER, "c"), ChatMessage(Role.ASSISTANT, "")]
    out = to_claude_messages(msgs)
    assert [m["role"] for m in out] == ["user", "assistant", "user"]
    assert all(b.get("text", "x") for m in out for b in m["content"])
    assert [b["type"] for b in out[2]["content"]] == ["tool_result", "text"]


# ------------------------------------------------------------------ speech
@pytest.mark.parametrize("heard", ["Thank you.", "Thanks for watching!", "you", "Subtitles by the Amara.org community"])
def test_what_whisper_invents_from_noise_is_ignored(heard):
    assert is_phantom(heard)


def test_real_commands_are_not_phantoms():
    assert not is_phantom("Thank you, now turn off the fan")
    assert not is_phantom("turn off the fan")


def test_urdu_script_goes_to_the_urdu_voice():
    class Voice:
        def __init__(self, name):
            self.name, self.said = name, []

        def synthesize(self, text):
            self.said.append(text)
            return self.name.encode()
    english, urdu = Voice("en"), Voice("ur")
    tts = ChainTTS([english], urdu_voices=[urdu])
    assert is_urdu_script("پنکھا بند کر دیا گیا ہے")
    assert tts.synthesize("پنکھا بند کر دیا گیا ہے") == b"ur"
    assert tts.synthesize("Done, the fan is off.") == b"en"
    assert tts.synthesize("It's **27°C**") == b"en" and english.said[-1] == "It's 27 degrees"


def test_empty_compose_settings_mean_the_defaults(monkeypatch):
    for key in ("LANGUAGES", "CLAUDE_MODEL", "WHISPER_MODEL", "MAX_TURNS"):
        monkeypatch.setenv(key, "")
    s = Settings.from_env()
    assert s.languages == ("en", "ur")                           # not English only
    assert s.claude_model == "claude-sonnet-5-5" and s.whisper_model == "small" and s.max_turns == 8


def test_browser_recordings_decode_with_the_installed_pyav():
    """Chrome sends webm/opus: decoding it must work with whatever PyAV pip installs (it broke once)."""
    import io
    import math
    import av
    import numpy as np
    from assistant.speech.recognizer import decode_audio

    buf = io.BytesIO()
    out = av.open(buf, "w", format="webm")
    stream = out.add_stream("libopus", rate=48000)
    tone = (np.sin(2 * math.pi * 440 * np.arange(48000) / 48000) * 0.5 * 32767).astype(np.int16)
    frame = av.AudioFrame.from_ndarray(tone.reshape(1, -1), format="s16", layout="mono")
    frame.sample_rate = 48000
    for packet in stream.encode(frame):
        out.mux(packet)
    for packet in stream.encode(None):
        out.mux(packet)
    out.close()
    samples = decode_audio(buf.getvalue())
    assert 0.9 < len(samples) / 16000 < 1.1 and 0.3 < float(abs(samples).max()) < 0.7

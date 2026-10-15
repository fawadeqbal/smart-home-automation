import json
from types import SimpleNamespace as NS

import httpx
import pytest

from assistant.config import Settings
from assistant.domain.models import ChatMessage, Role, ToolCall, ToolSpec
from assistant.domain.ports import LLMError
from assistant.llm import available, create_provider
from assistant.llm.claude import ClaudeProvider, to_claude_messages
from assistant.llm.ollama import OllamaProvider, parse_ollama_reply, to_ollama_messages

HISTORY = [
    ChatMessage(Role.USER, "turn on the light"),
    ChatMessage(Role.ASSISTANT, "", tool_calls=[ToolCall("c1", "set_device", {"device": "light", "state": "on"})]),
    ChatMessage(Role.TOOL, "light is now on", tool_call_id="c1", tool_name="set_device"),
]
TOOLS = [ToolSpec("set_device", "Switch a device", {"type": "object", "properties": {}})]


def settings(**kw):
    return Settings(base_dir=".", **kw)


def test_both_providers_are_registered_and_unknown_names_fail_clearly():
    assert {"ollama", "claude"} <= set(available())
    with pytest.raises(ValueError, match="Unknown LLM_PROVIDER"):
        create_provider(settings(llm_provider="nope"))


# ------------------------------------------------------------------ Ollama
def test_ollama_translation():
    out = to_ollama_messages("SYS", HISTORY)
    assert out[0] == {"role": "system", "content": "SYS"}
    assert out[2]["tool_calls"][0]["function"] == {"name": "set_device", "arguments": {"device": "light", "state": "on"}}
    assert out[3] == {"role": "tool", "tool_name": "set_device", "content": "light is now on"}


def test_ollama_reply_parsing_accepts_arguments_as_json_text():
    reply = parse_ollama_reply({"message": {"content": "", "tool_calls": [
        {"function": {"name": "set_device", "arguments": json.dumps({"device": "fan", "state": "off"})}}]}})
    assert reply.tool_calls[0].name == "set_device"
    assert reply.tool_calls[0].arguments == {"device": "fan", "state": "off"}


def ollama_with(handler):
    return OllamaProvider(settings(), client=httpx.Client(transport=httpx.MockTransport(handler)))


def test_ollama_chat_sends_model_tools_and_returns_text():
    seen = {}

    def handler(request):
        seen.update(json.loads(request.content))
        return httpx.Response(200, json={"message": {"role": "assistant", "content": " Hi! "}})

    reply = ollama_with(handler).chat("SYS", HISTORY[:1], TOOLS)
    assert reply.text == "Hi!" and reply.tool_calls == []
    assert seen["model"] == "qwen2.5:3b" and seen["tools"][0]["function"]["name"] == "set_device"


def test_ollama_missing_model_and_not_running_give_helpful_errors():
    with pytest.raises(LLMError, match="ollama pull qwen2.5:3b"):
        ollama_with(lambda r: httpx.Response(404, json={"error": "not found"})).chat("S", HISTORY[:1], [])

    def refuse(request):
        raise httpx.ConnectError("refused")
    with pytest.raises(LLMError, match="not running"):
        ollama_with(refuse).chat("S", HISTORY[:1], [])


# ------------------------------------------------------------------ Claude
def test_claude_translation_groups_tool_results_into_one_user_message():
    history = HISTORY[:2] + [
        ChatMessage(Role.TOOL, "light is now on", tool_call_id="c1", tool_name="set_device"),
        ChatMessage(Role.TOOL, "fan is now off", tool_call_id="c2", tool_name="set_device"),
    ]
    out = to_claude_messages(history)
    assert out[1]["content"][0] == {"type": "tool_use", "id": "c1", "name": "set_device",
                                    "input": {"device": "light", "state": "on"}}
    assert out[2]["role"] == "user" and [b["tool_use_id"] for b in out[2]["content"]] == ["c1", "c2"]


def test_claude_provider_maps_response_blocks():
    blocks = [NS(type="text", text="Okay."), NS(type="tool_use", id="t9", name="set_device", input={"device": "fan"})]
    client = NS(messages=NS(create=lambda **kw: NS(content=blocks)))
    reply = ClaudeProvider(settings(llm_provider="claude"), client=client).chat("S", HISTORY[:1], TOOLS)
    assert reply.text == "Okay." and reply.tool_calls == [ToolCall("t9", "set_device", {"device": "fan"})]


def test_claude_without_key_is_a_configuration_error():
    with pytest.raises(ValueError, match="ANTHROPIC_API_KEY"):
        create_provider(settings(llm_provider="claude"))

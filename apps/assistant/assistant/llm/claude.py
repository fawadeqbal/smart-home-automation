"""Claude API (needs ANTHROPIC_API_KEY with credit)."""
from __future__ import annotations

import logging
from typing import List, Sequence

from ..config import Settings
from ..domain.models import ChatMessage, LLMReply, Role, ToolCall, ToolSpec
from ..domain.ports import LLMError
from .registry import register

log = logging.getLogger(__name__)


# ------------------------------------------------------------------ translation (pure functions)
def to_claude_messages(messages: Sequence[ChatMessage]) -> List[dict]:
    """Claude wants tool calls as content blocks, and tool results grouped in one user message."""
    out: List[dict] = []
    for m in messages:
        if m.role == Role.TOOL:
            block = {"type": "tool_result", "tool_use_id": m.tool_call_id, "content": m.content}
            if out and out[-1]["role"] == "user" and isinstance(out[-1]["content"], list):
                out[-1]["content"].append(block)
            else:
                out.append({"role": "user", "content": [block]})
        elif m.role == Role.ASSISTANT and m.tool_calls:
            blocks = [{"type": "text", "text": m.content}] if m.content else []
            blocks += [{"type": "tool_use", "id": c.id, "name": c.name, "input": c.arguments} for c in m.tool_calls]
            out.append({"role": "assistant", "content": blocks})
        else:
            out.append({"role": m.role.value, "content": m.content})
    return out


def to_claude_tools(tools: Sequence[ToolSpec]) -> List[dict]:
    return [{"name": t.name, "description": t.description, "input_schema": t.parameters} for t in tools]


# ------------------------------------------------------------------ provider
@register("claude")
class ClaudeProvider:
    name = "claude"

    def __init__(self, settings: Settings, client=None) -> None:
        if not settings.anthropic_api_key and client is None:
            raise ValueError("LLM_PROVIDER=claude needs ANTHROPIC_API_KEY in .env")
        self.model = settings.claude_model
        self.max_tokens = settings.max_tokens
        if client is None:
            import anthropic                       # only needed when Claude is used
            client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
        self._client = client

    def chat(self, system: str, messages: Sequence[ChatMessage], tools: Sequence[ToolSpec]) -> LLMReply:
        kwargs = {"tools": to_claude_tools(tools)} if tools else {}
        try:
            response = self._client.messages.create(model=self.model, max_tokens=self.max_tokens, system=system,
                                                    messages=to_claude_messages(messages), **kwargs)
        except Exception as exc:  # noqa: BLE001 - anthropic.APIError and network errors
            log.error("Claude API error: %s", exc)
            raise LLMError("Sorry, I could not reach Claude right now.") from exc
        text = "".join(b.text for b in response.content if b.type == "text").strip()
        calls = [ToolCall(id=b.id, name=b.name, arguments=dict(b.input))
                 for b in response.content if b.type == "tool_use"]
        return LLMReply(text=text, tool_calls=calls)

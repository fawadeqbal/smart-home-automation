"""Free local models through Ollama (https://ollama.com), using its /api/chat endpoint."""
from __future__ import annotations

import json
import logging
import uuid
from typing import List, Optional, Sequence

import httpx

from ..config import Settings
from ..domain.models import ChatMessage, LLMReply, Role, ToolCall, ToolSpec
from ..domain.ports import LLMError
from .registry import register

log = logging.getLogger(__name__)


# ------------------------------------------------------------------ translation (pure functions)
def to_ollama_messages(system: str, messages: Sequence[ChatMessage]) -> List[dict]:
    out = [{"role": "system", "content": system}]
    for m in messages:
        if m.role == Role.TOOL:
            out.append({"role": "tool", "tool_name": m.tool_name or "", "content": m.content})
        elif m.role == Role.ASSISTANT and m.tool_calls:
            out.append({"role": "assistant", "content": m.content,
                        "tool_calls": [{"function": {"name": c.name, "arguments": c.arguments}} for c in m.tool_calls]})
        else:
            out.append({"role": m.role.value, "content": m.content})
    return out


def to_ollama_tools(tools: Sequence[ToolSpec]) -> List[dict]:
    return [{"type": "function", "function": {"name": t.name, "description": t.description,
                                              "parameters": t.parameters}} for t in tools]


def parse_ollama_reply(data: dict) -> LLMReply:
    msg = data.get("message") or {}
    calls = []
    for raw in msg.get("tool_calls") or []:
        fn = raw.get("function") or {}
        args = fn.get("arguments") or {}
        if isinstance(args, str):                       # some models send the JSON as text
            try:
                args = json.loads(args)
            except ValueError:
                args = {}
        calls.append(ToolCall(id=raw.get("id") or uuid.uuid4().hex, name=fn.get("name", ""), arguments=args))
    return LLMReply(text=(msg.get("content") or "").strip(), tool_calls=calls)


# ------------------------------------------------------------------ provider
@register("ollama")
class OllamaProvider:
    name = "ollama"

    def __init__(self, settings: Settings, client: Optional[httpx.Client] = None) -> None:
        self.model = settings.ollama_model
        self.url = settings.ollama_url
        self.max_tokens = settings.max_tokens
        self._client = client or httpx.Client(timeout=180)

    def warm_up(self) -> None:
        """Loads the model into memory at start-up so the first question isn't slow."""
        try:
            self._client.post(f"{self.url}/api/generate", json={"model": self.model, "keep_alive": -1}, timeout=300)
            log.info("Ollama model %s is loaded", self.model)
        except httpx.HTTPError as exc:
            log.warning("Could not pre-load %s: %s", self.model, exc)

    def chat(self, system: str, messages: Sequence[ChatMessage], tools: Sequence[ToolSpec]) -> LLMReply:
        body = {
            "model": self.model,
            "messages": to_ollama_messages(system, messages),
            "stream": False,
            "keep_alive": -1,                           # keep the model loaded: reloading it costs seconds
            # a smaller context and a low temperature: faster, and more reliable at picking the right tool
            "options": {"num_predict": self.max_tokens, "temperature": 0.2, "num_ctx": 4096},
        }
        if tools:
            body["tools"] = to_ollama_tools(tools)
        try:
            response = self._client.post(f"{self.url}/api/chat", json=body)
        except httpx.ConnectError as exc:
            log.error("Ollama is not running at %s", self.url)
            raise LLMError("Sorry, my local brain is not running. Start Ollama and try again.") from exc
        except httpx.HTTPError as exc:
            log.error("Ollama request failed: %s", exc)
            raise LLMError("Sorry, my local brain had a problem. Please try again.") from exc
        if response.status_code == 404:
            raise LLMError(f"The model {self.model} is not installed. Run: ollama pull {self.model}")
        if response.status_code >= 400:
            log.error("Ollama error %s: %s", response.status_code, response.text[:200])
            raise LLMError("Sorry, my local brain had a problem. Please try again.")
        return parse_ollama_reply(response.json())

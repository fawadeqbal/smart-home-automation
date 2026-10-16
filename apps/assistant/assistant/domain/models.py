"""Plain data types shared by every layer. Messages use one neutral format; each AI provider
translates it to its own API format, so the conversation never depends on a specific provider."""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional


class Role(str, Enum):
    USER = "user"
    ASSISTANT = "assistant"
    TOOL = "tool"


@dataclass(frozen=True)
class ToolCall:
    id: str
    name: str
    arguments: Dict[str, Any]


@dataclass(frozen=True)
class ToolSpec:
    """A tool as described to the AI model (JSON Schema parameters)."""
    name: str
    description: str
    parameters: Dict[str, Any]


@dataclass
class ChatMessage:
    """One message in the conversation the AI sees."""
    role: Role
    content: str = ""
    tool_calls: List[ToolCall] = field(default_factory=list)
    tool_call_id: Optional[str] = None      # set on Role.TOOL messages
    tool_name: Optional[str] = None         # set on Role.TOOL messages

    @property
    def is_plain_user(self) -> bool:
        return self.role == Role.USER


@dataclass(frozen=True)
class LLMReply:
    text: str
    tool_calls: List[ToolCall] = field(default_factory=list)
    # the model stopped because it reached the length limit (the text ends mid-sentence)
    truncated: bool = False

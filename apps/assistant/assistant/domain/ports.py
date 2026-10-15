"""Interfaces ("ports") the core depends on. Adapters in llm/ and speech/ implement them."""
from __future__ import annotations

from typing import Optional, Protocol, Sequence, runtime_checkable

from .models import ChatMessage, LLMReply, ToolSpec


class LLMError(Exception):
    """The AI model could not answer. The message is safe to show and speak to the user."""


@runtime_checkable
class LLMProvider(Protocol):
    name: str

    def chat(self, system: str, messages: Sequence[ChatMessage], tools: Sequence[ToolSpec]) -> LLMReply:
        """Send the conversation, return text and/or tool calls. Raise LLMError on failure."""


@runtime_checkable
class SpeechToText(Protocol):
    def transcribe(self, audio: bytes) -> str:
        """Audio file bytes (webm / ogg / mp4 / wav from the browser) -> text."""


@runtime_checkable
class TextToSpeech(Protocol):
    def synthesize(self, text: str) -> Optional[bytes]:
        """Text -> WAV bytes, or None when no voice is available."""

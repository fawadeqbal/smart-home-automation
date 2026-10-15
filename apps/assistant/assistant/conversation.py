"""One conversation per person per home: ask the AI, run the tools it asks for, repeat, return the answer.

Each customer has their own short history in each home, so "turn it off" refers to what THEY said last
in THAT home. Nobody shares a conversation: not two family members, not a customer and the staff member
looking into their home, and not one person's two homes. A conversation left alone for a while
(idle_minutes) starts afresh, and the app can start a fresh one itself (its chat screen is empty).
Speed: everyday commands are answered by QuickCommands without the AI at all, and when the AI's only
job was to switch or schedule something, the reply is made from the tool result instead of asking
the AI a second time.
"""
from __future__ import annotations

import logging
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Callable, Dict, List, Optional, Tuple

from .domain.models import ChatMessage, Role
from .domain.ports import LLMError, LLMProvider
from .quick import QuickCommands, summarize_actions
from .tools import ToolRegistry

log = logging.getLogger(__name__)

NO_ANSWER = "Sorry, I could not finish that request."


class PromptBuilder:
    """System prompt from instructions.md (re-read every time, so edits apply at once) + time + who is asking
    + which home they are in."""

    def __init__(self, instructions_file: Path, clock: Callable[[], datetime] = datetime.now) -> None:
        self._file = instructions_file
        self._clock = clock

    def build(self, user_name: str, home_name: str = "") -> str:
        instructions = self._file.read_text(encoding="utf-8") if self._file.exists() else ""
        now = self._clock().strftime("%A %d %B %Y, %H:%M")
        home = f"\nThey are in the home \"{home_name}\"; only its devices exist for this conversation." if home_name else ""
        return f"{instructions}\n\nYou are talking to {user_name}.{home}\nCurrent local date and time: {now}."


Key = Tuple[str, str]  # (user id, home id)


class ConversationService:
    def __init__(self, llm: LLMProvider, prompt: PromptBuilder, max_turns: int = 6, max_tool_rounds: int = 5,
                 fast_replies: bool = True, idle_minutes: float = 30,
                 clock: Callable[[], float] = time.monotonic) -> None:
        self._llm = llm
        self._fast_replies = fast_replies
        self._prompt = prompt
        self._max_messages = max_turns * 2
        self._max_tool_rounds = max_tool_rounds
        self._idle_seconds = idle_minutes * 60
        self._clock = clock
        self._histories: Dict[Key, List[ChatMessage]] = {}
        self._last_used: Dict[Key, float] = {}
        self._locks: Dict[Key, threading.Lock] = {}
        self._guard = threading.Lock()

    def _lock_for(self, key: Key) -> threading.Lock:
        with self._guard:
            return self._locks.setdefault(key, threading.Lock())

    def _history_for(self, key: Key, fresh: bool) -> List[ChatMessage]:
        """This person's conversation in this home; forgotten when asked to, or after a quiet spell."""
        now = self._clock()
        with self._guard:
            self._forget_idle(now)
            if fresh:
                self._histories.pop(key, None)
            self._last_used[key] = now
            return self._histories.setdefault(key, [])

    def _forget_idle(self, now: float) -> None:
        if self._idle_seconds <= 0:
            return
        for key in [k for k, at in self._last_used.items() if now - at > self._idle_seconds]:
            self._histories.pop(key, None)
            self._last_used.pop(key, None)

    def ask(self, user_id: str, user_name: str, text: str, tools: ToolRegistry,
            quick: Optional[QuickCommands] = None, *, home_id: str = "", home_name: str = "",
            fresh: bool = False) -> str:
        key = (user_id, home_id)
        with self._lock_for(key):                       # one question at a time per person per home
            history = self._history_for(key, fresh)
            checkpoint = len(history)
            history.append(ChatMessage(Role.USER, text))
            instant = self._quick(quick, text)
            if instant:
                log.info("%s: instant answer for %r -> %s", user_name, text, instant)
                history.append(ChatMessage(Role.ASSISTANT, instant))
                self._trim(history)
                return instant
            try:
                reply = self._run(history, user_name, home_name, tools)
            except LLMError as exc:
                del history[checkpoint:]                # forget the failed exchange
                return str(exc)
            self._trim(history)
            return reply

    @staticmethod
    def _quick(quick: Optional[QuickCommands], text: str) -> Optional[str]:
        if quick is None:
            return None
        try:
            return quick.handle(text)
        except Exception:  # noqa: BLE001 - never let the shortcut break the conversation; the AI takes over
            log.exception("Quick command failed for %r", text)
            return None

    def reset(self, user_id: str, home_id: str = "") -> None:
        with self._guard:
            self._histories.pop((user_id, home_id), None)
            self._last_used.pop((user_id, home_id), None)

    def history(self, user_id: str, home_id: str = "") -> List[ChatMessage]:
        return list(self._histories.get((user_id, home_id), []))

    def _run(self, history: List[ChatMessage], user_name: str, home_name: str, tools: ToolRegistry) -> str:
        system = self._prompt.build(user_name, home_name)
        for _ in range(self._max_tool_rounds):
            reply = self._llm.chat(system, history, tools.specs())
            history.append(ChatMessage(Role.ASSISTANT, reply.text, tool_calls=list(reply.tool_calls)))
            if not reply.tool_calls:
                return reply.text or NO_ANSWER
            results = []
            for call in reply.tool_calls:
                result = tools.execute(call)
                log.info("%s: tool %s(%s) -> %s", user_name, call.name, call.arguments, result)
                history.append(ChatMessage(Role.TOOL, result, tool_call_id=call.id, tool_name=call.name))
                results.append((call.name, result))
            # it only switched or scheduled something and it worked: say so without a second AI round
            summary = summarize_actions(results) if self._fast_replies else None
            if summary:
                history.append(ChatMessage(Role.ASSISTANT, summary))
                return summary
        return NO_ANSWER

    def _trim(self, history: List[ChatMessage]) -> None:
        """Keep recent turns only; history must start with a user question (not a tool result)."""
        while len(history) > self._max_messages:
            history.pop(0)
        while history and not history[0].is_plain_user:
            history.pop(0)

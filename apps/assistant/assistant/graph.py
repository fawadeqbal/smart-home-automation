"""How one question is answered, as a LangGraph state graph:

    quick ──(an everyday command, done without the AI)──────────────────────────────▶ END
      │
    retrieve   the Help Center excerpts that match the question (LangChain retriever, on this server)
      │
    guard ──(greeting / off-topic / a price or promise no article covers: fixed reply)──▶ END
      │
    agent ◀──────┐   the AI, with this person's tools, the home's state and the excerpts
      │          │
      ├─(tool calls)─▶ tools ──(only switched or scheduled things: reply from the results)──▶ END
      │                  └─(read something: back to the AI)─┘
      ▼
     END       an answer that reached the length limit is ended at its last full sentence

Bounds: at most `max_tool_rounds` AI rounds, and no new AI round once `budget_s` seconds have gone, so
a person always gets an answer in seconds rather than a spinner. Tools of one round run in parallel.
Every answer logs how long each step took.
"""
from __future__ import annotations

import logging
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any, Callable, List, Optional, TypedDict, Union

from langchain_core.documents import Document
from langchain_core.retrievers import BaseRetriever
from langchain_core.runnables import RunnableConfig
from langgraph.graph import END, START, StateGraph

from .domain.models import ChatMessage, Role, ToolCall
from .domain.ports import LLMProvider
from .guard import (AGENT, DECLINE, GREET, NO_INFO, ScopeGuard, decline_text, greet_text, language,
                    last_user_question, no_info_text, truncate_cleanly, words)
from .quick import QuickCommands, summarize_actions
from .retrieval import format_excerpts
from .tools import ToolRegistry

log = logging.getLogger(__name__)

NO_ANSWER = "Sorry, I could not finish that request."
TOO_SLOW = "Sorry, that is taking too long. Please try again in a moment."
_POOL = ThreadPoolExecutor(max_workers=8, thread_name_prefix="tool")


class Turn(TypedDict, total=False):
    """What flows through the graph for one question."""
    text: str
    user_name: str
    console: bool
    followup: bool          # there is an earlier exchange in this conversation
    lang: str
    docs: List[Document]
    calls: List[ToolCall]   # tool calls the AI just asked for
    rounds: int
    reply: str
    route: str
    timings: List[str]


@dataclass
class TurnContext:
    """The objects one question works with (not part of the graph's state)."""
    history: List[ChatMessage]
    tools: ToolRegistry
    quick: Optional[QuickCommands] = None
    retriever: Optional[BaseRetriever] = None
    guard: Optional[ScopeGuard] = None
    started: float = field(default_factory=time.monotonic)
    # made only when needed (an instant command needs neither): the AI's instructions with the home's
    # state, and the names in the home for the guard
    system: Callable[[], str] = lambda: ""
    vocab: Callable[[], List[str]] = lambda: []


def _ctx(config: RunnableConfig) -> TurnContext:
    return config["configurable"]["ctx"]


class AnswerGraph:
    def __init__(self, llm: LLMProvider, *, max_tool_rounds: int = 4, fast_replies: bool = True,
                 budget_s: float = 40.0, clock: Callable[[], float] = time.monotonic) -> None:
        self._llm = llm
        self._max_rounds = max_tool_rounds
        self._fast = fast_replies
        self._budget = budget_s
        self._clock = clock
        g = StateGraph(Turn)
        g.add_node("quick", self._timed("quick", self.quick))
        g.add_node("retrieve", self._timed("retrieve", self.retrieve))
        g.add_node("guard", self._timed("guard", self.guard))
        g.add_node("agent", self._timed("agent", self.agent))
        g.add_node("tools", self._timed("tools", self.run_tools))
        g.add_edge(START, "quick")
        g.add_conditional_edges("quick", lambda s: END if s.get("reply") else "retrieve", ["retrieve", END])
        g.add_edge("retrieve", "guard")
        g.add_conditional_edges("guard", lambda s: END if s.get("reply") else "agent", ["agent", END])
        g.add_conditional_edges("agent", lambda s: "tools" if s.get("calls") else END, ["tools", END])
        g.add_conditional_edges("tools", lambda s: END if s.get("reply") else "agent", ["agent", END])
        self.graph = g.compile()

    # ------------------------------------------------------------------ running it
    def answer(self, ctx: TurnContext, *, text: str, user_name: str, system: Union[str, Callable[[], str]],
               console: bool = False, followup: bool = False,
               vocab: Union[None, List[str], Callable[[], List[str]]] = None) -> str:
        ctx.started = self._clock()
        ctx.system = _once(system)
        ctx.vocab = _once(vocab or [])
        out = self.graph.invoke(
            {"text": text, "user_name": user_name, "console": console, "followup": followup,
             "lang": language(text), "docs": [], "calls": [], "rounds": 0, "timings": []},
            config={"configurable": {"ctx": ctx}, "recursion_limit": 4 + 2 * self._max_rounds + 2},
        )
        log.info("%s: %r -> %s [%s] (%s)", user_name, text, out.get("route", "?"),
                 ", ".join(out.get("timings", [])), f"{(self._clock() - ctx.started) * 1000:.0f}ms total")
        return out.get("reply") or NO_ANSWER

    def _timed(self, name: str, fn):
        def node(state: Turn, config: RunnableConfig) -> dict:
            t = time.monotonic()
            update = fn(state, _ctx(config)) or {}
            took = f"{name} {(time.monotonic() - t) * 1000:.0f}ms"
            return {**update, "timings": [*state.get("timings", []), took]}
        return node

    # ------------------------------------------------------------------ the steps
    def quick(self, s: Turn, ctx: TurnContext) -> dict:
        if ctx.quick is None:
            return {}
        try:
            instant = ctx.quick.handle(s["text"])
        except Exception:  # noqa: BLE001 - never let the shortcut break the conversation; the AI takes over
            log.exception("Quick command failed for %r", s["text"])
            return {}
        if not instant:
            return {}
        ctx.history.append(ChatMessage(Role.ASSISTANT, instant))
        return {"reply": instant, "route": "quick"}

    def retrieve(self, s: Turn, ctx: TurnContext) -> dict:
        if ctx.retriever is None:
            return {}
        query = s["text"]
        if s.get("followup") and len(words(query)) <= 6:
            # "where?" / "and the warranty?": search it together with the question before it
            query = f"{last_user_question(ctx.history, before=-1)} {query}".strip()
        try:
            return {"docs": ctx.retriever.invoke(query)}
        except Exception:  # noqa: BLE001 - no excerpts; the AI can still search, or say it doesn't know
            log.exception("Help Center retrieval failed for %r", query)
            return {}

    def guard(self, s: Turn, ctx: TurnContext) -> dict:
        if ctx.guard is None:
            return {"route": AGENT}
        d = ctx.guard.decide(s["text"], followup=s.get("followup", False), vocab=ctx.vocab(), docs=s.get("docs", []))
        lang, console = s.get("lang", "en"), s.get("console", False)
        fixed = {
            GREET: lambda: greet_text(s["text"], lang, s.get("user_name", ""), console),
            DECLINE: lambda: decline_text(lang, console),
            NO_INFO: lambda: no_info_text(lang, console),
        }.get(d.route)
        if fixed is None:
            return {"route": AGENT}
        reply = fixed()
        log.info("guard: %s (%s)", d.route, d.reason)
        ctx.history.append(ChatMessage(Role.ASSISTANT, reply))
        return {"reply": reply, "route": d.route}

    def agent(self, s: Turn, ctx: TurnContext) -> dict:
        rounds = s.get("rounds", 0)
        if rounds and self._clock() - ctx.started > self._budget:
            log.warning("Answer budget (%ss) spent after %d rounds", self._budget, rounds)
            ctx.history.append(ChatMessage(Role.ASSISTANT, TOO_SLOW))
            return {"reply": TOO_SLOW, "calls": [], "route": "too_slow"}
        reply = self._llm.chat(self._system(s, ctx.system()), ctx.history, ctx.tools.specs())
        if reply.tool_calls:
            ctx.history.append(ChatMessage(Role.ASSISTANT, reply.text, tool_calls=list(reply.tool_calls)))
            return {"calls": list(reply.tool_calls), "rounds": rounds + 1}
        # never keep an empty answer: the AI API refuses empty messages and the chat would break
        text = reply.text or NO_ANSWER
        if reply.truncated and reply.text:
            text = truncate_cleanly(text, s.get("lang", "en"))
        ctx.history.append(ChatMessage(Role.ASSISTANT, text))
        return {"reply": text, "calls": [], "route": "ai" if not s.get("docs") else "ai+help"}

    def run_tools(self, s: Turn, ctx: TurnContext) -> dict:
        calls = s.get("calls", [])
        results = list(_POOL.map(ctx.tools.execute, calls)) if len(calls) > 1 else [ctx.tools.execute(c) for c in calls]
        for call, result in zip(calls, results):
            log.info("%s: tool %s(%s) -> %s", s.get("user_name", ""), call.name, call.arguments, result)
            ctx.history.append(ChatMessage(Role.TOOL, result, tool_call_id=call.id, tool_name=call.name))
        # it only switched or scheduled something and it worked: say so without a second AI round
        summary = summarize_actions([(c.name, r) for c, r in zip(calls, results)]) if self._fast else None
        if summary:
            ctx.history.append(ChatMessage(Role.ASSISTANT, summary))
            return {"reply": summary, "calls": [], "route": "tools"}
        if s.get("rounds", 0) >= self._max_rounds:
            ctx.history.append(ChatMessage(Role.ASSISTANT, NO_ANSWER))   # keep the turns in order for the next question
            return {"reply": NO_ANSWER, "calls": [], "route": "too_many_rounds"}
        return {"calls": []}

    @staticmethod
    def _system(s: Turn, system: str) -> str:
        docs = s.get("docs") or []
        if not docs:
            return system
        return (f"{system}\n\n# Help Center excerpts for this question\n\n"
                "The company's own articles that match what was asked, best first. For anything about using "
                "Switchboard, fixing problems, visits, installation, warranty, charges, refunds or privacy, answer "
                "only from these (or call search_help for another search). Ignore excerpts that are not about the "
                "question. If none of them answers it, say you don't have that information.\n\n"
                f"{format_excerpts(docs)}")


def _once(value: Any) -> Callable[[], Any]:
    """A value, or a function made into one that runs at most once."""
    if not callable(value):
        return lambda: value
    cache: list = []

    def get() -> Any:
        if not cache:
            cache.append(value())
        return cache[0]
    return get


def merge_names(*texts: Any) -> List[str]:
    """Words of the home's state (device, room, scene, board and home names) for the guard."""
    from .guard import vocabulary
    return sorted(vocabulary(*[t for t in texts if isinstance(t, str)]))

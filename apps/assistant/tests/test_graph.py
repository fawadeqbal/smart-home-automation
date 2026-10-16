"""The answer graph (LangGraph): it stays on the home and the product, answers from the Help Center
(retrieved before the AI is asked), never ends mid-sentence, and never keeps a person waiting long."""
from pathlib import Path
from types import SimpleNamespace as NS

import pytest
from fastapi.testclient import TestClient

from assistant.config import Settings
from assistant.domain.models import ChatMessage, LLMReply, Role, ToolCall
from assistant.graph import TOO_SLOW, AnswerGraph, TurnContext
from assistant.guard import AGENT, DECLINE, GREET, NO_INFO, ScopeGuard, language, truncate_cleanly
from assistant.knowledge import KnowledgeBase
from assistant.llm.claude import ClaudeProvider
from assistant.retrieval import HelpRetriever, retriever_for
from assistant.tools import SearchHelpTool, build_tools
from assistant.web import create_app

from conftest import FakeApi, FakeLLM, FakeSTT, FakeTTS, device

SECRET = "s3cret"
HEADERS = {"X-Assistant-Secret": SECRET}
WHO = {"user_id": "u1", "user_name": "Ali Khan", "home_id": "h1", "home_name": "Ali's house", "token": "tok"}
ARTICLES = [
    {"id": "a1", "title": "A board is offline", "category": "TROUBLESHOOTING", "audience": "EVERYONE",
     "tags": ["wifi nahi", "board band"], "body": "If a board shows offline, check its power first.\n\nThen check the Wi-Fi router is on."},
    {"id": "a3", "title": "Warranty on boards", "category": "POLICY", "audience": "EVERYONE", "tags": ["guarantee", "warranty"],
     "body": "Boards are covered for twelve months from installation."},
]


@pytest.fixture
def home():
    return [device("d1", "Bulb", room="Hall", aliases=["batti"]), device("d2", "Geyser", room="Bath"),
            device("d3", "Fan", room="Bedroom")]


@pytest.fixture
def articles():
    FakeApi.help = ARTICLES
    yield ARTICLES
    FakeApi.help = []


def make(home, llm):
    app = create_app(Settings(shared_secret=SECRET, quick_commands=False), llm=llm, stt=FakeSTT(), tts=FakeTTS(),
                     api_factory=lambda token: FakeApi(token, home), knowledge=KnowledgeBase(None))
    return TestClient(app)


def ask(client, text, **who):
    r = client.post("/v1/chat", json={**WHO, **who, "text": text, "speak": False}, headers=HEADERS)
    assert r.status_code == 200, r.text
    return r.json()["reply"]


# ------------------------------------------------------------------ staying on the job
@pytest.mark.parametrize("question", [
    "who won the cricket match yesterday?", "write me a poem about the sea", "what is the capital of France",
    "tell me a joke", "solve 12 times 14 for me",
])
def test_off_topic_questions_are_declined_without_the_ai(home, question):
    llm = FakeLLM()
    reply = ask(make(home, llm), question)
    assert reply.startswith("I can only help with your Switchboard home")
    assert llm.calls == []


def test_the_decline_is_in_roman_urdu_when_they_wrote_roman_urdu(home):
    llm = FakeLLM()
    assert ask(make(home, llm), "kal match kaun jeeta tha?").startswith("Main sirf aap ke Switchboard ghar")
    assert llm.calls == []


def test_greetings_and_thanks_are_instant(home):
    llm = FakeLLM()
    client = make(home, llm)
    assert ask(client, "hi") == ("Hi Ali! I can switch things, set timers, tell you how your home is doing, and answer "
                                 "questions about Switchboard. What do you need?")
    assert ask(client, "thanks!") == "You're welcome!"
    assert ask(client, "salam").startswith("Wa alaikum assalam Ali!")
    assert llm.calls == []


@pytest.mark.parametrize("question", [
    "is the geyser hot?",                 # a device in this home
    "how do scenes work?",                # product words
    "my wifi nahi chal raha",             # Roman Urdu product words
    "گیزر بند کر دو",                       # Urdu script: the AI decides
])
def test_questions_about_the_home_or_product_go_to_the_ai(home, question):
    llm = FakeLLM()
    ask(make(home, llm), question)
    assert len(llm.calls) == 1


def test_a_short_follow_up_goes_to_the_ai_with_the_conversation(home):
    llm = FakeLLM()
    client = make(home, llm)
    ask(client, "is the fan on?")
    ask(client, "where?")
    assert [m.content for m in llm.calls[1]["messages"]] == ["is the fan on?", "echo: is the fan on?", "where?"]


def test_the_ai_is_told_to_stay_on_the_job(home):
    llm = FakeLLM()
    ask(make(home, llm), "how do scenes work?")
    system = llm.calls[0]["system"]
    assert "You are only for this home and Switchboard" in system
    assert "Nothing from memory or general knowledge" in system


# ------------------------------------------------------------------ answers from the Help Center (RAG)
def test_help_excerpts_are_retrieved_before_the_ai_answers(home, articles):
    llm = FakeLLM(lambda msgs, tools: LLMReply(text="Check its power first. See 'A board is offline' in Help."))
    reply = ask(make(home, llm), "my board shows offline, what do I do?")
    assert reply.startswith("Check its power first")
    assert len(llm.calls) == 1                                   # one AI round: no search first
    system = llm.calls[0]["system"]
    assert "# Help Center excerpts for this question" in system
    assert "[1] A board is offline (troubleshooting)" in system
    assert "check its power first" in system


def test_a_follow_up_is_searched_together_with_the_question_before_it(home, articles):
    llm = FakeLLM()
    client = make(home, llm)
    ask(client, "is the bulb on?")                               # nothing in the Help Center for this
    assert "# Help Center excerpts for this question" not in llm.calls[0]["system"]
    ask(client, "and if the board is offline?")
    assert "[1] A board is offline" in llm.calls[1]["system"]


def test_money_and_promises_are_never_guessed(home):
    llm = FakeLLM()
    client = make(home, llm)
    for q in ["how much does a service visit cost?", "is there a warranty on the boards?", "refund kaise milega?"]:
        reply = ask(client, q)
        assert "Help Center" in reply and "won't guess" in reply or "andaza nahi" in reply
    assert llm.calls == []


def test_a_published_policy_is_answered_from_its_article(home, articles):
    llm = FakeLLM(lambda msgs, tools: LLMReply(text="Boards are covered for twelve months."))
    assert ask(make(home, llm), "is there a warranty on the boards?") == "Boards are covered for twelve months."
    assert "[1] Warranty on boards (policy)" in llm.calls[0]["system"]


def test_the_retriever_is_a_langchain_retriever_with_the_article_details(articles):
    tool = SearchHelpTool(FakeApi("t", []), KnowledgeBase(None))
    retriever = retriever_for(tool)
    assert isinstance(retriever, HelpRetriever)
    docs = retriever.invoke("board offline wifi")
    assert docs[0].metadata["title"] == "A board is offline"
    assert docs[0].metadata["article_id"] == "a1" and docs[0].metadata["keyword_rank"] == 0
    assert retriever_for(None) is None


def test_console_off_topic_is_declined_too(articles):
    llm = FakeLLM()
    console = {"console": True, "staff_role": "SUPERADMIN", "company": "Fawad Smart Homes", "home_id": ""}

    class Staff(FakeApi):
        def connectivity(self):
            return {"tracking": True, "boards": []}
    app = create_app(Settings(shared_secret=SECRET), llm=llm, stt=FakeSTT(), tts=FakeTTS(),
                     api_factory=lambda token: Staff(token, []), knowledge=KnowledgeBase(None))
    client = TestClient(app)
    assert ask(client, "write me a poem", **console).startswith("I can only help with your company's Switchboard boards")
    ask(client, "which boards are offline?", **console)
    assert len(llm.calls) == 1


# ------------------------------------------------------------------ never cut off, never stuck
def test_an_answer_cut_by_the_length_limit_ends_at_a_full_sentence(home):
    cut = LLMReply(text="Check the power first. Then open the board page and press Wi-Fi. It has", truncated=True)
    reply = ask(make(home, FakeLLM(lambda m, t: cut)), "how do I fix my board?")
    assert reply == "Check the power first. Then open the board page and press Wi-Fi.\n\nAsk me if you want more."


def test_truncate_cleanly_keeps_list_items_whole():
    text = "Here is what happened:\n- Lost contact ten times.\n- Eight short drops.\n- The internet provider changed. It has"
    assert truncate_cleanly(text) == ("Here is what happened:\n- Lost contact ten times.\n- Eight short drops.\n"
                                      "- The internet provider changed.\n\nAsk me if you want more.")


def test_claude_reports_when_it_hit_the_length_limit():
    client = NS(messages=NS(create=lambda **kw: NS(content=[NS(type="text", text="Cut")], stop_reason="max_tokens")))
    settings = Settings(llm_provider="claude", anthropic_api_key="k")
    assert ClaudeProvider(settings, client=client).chat("S", [ChatMessage(Role.USER, "hi")], []).truncated is True
    assert settings.max_tokens >= 1024 and settings.llm_retries <= 1 and settings.llm_timeout <= 30


def test_no_new_ai_round_once_the_time_budget_is_spent(home):
    now = [0.0]

    def respond(msgs, tools):
        now[0] += 30                                             # each AI round takes 30 seconds
        return LLMReply(text="", tool_calls=[ToolCall(f"c{now[0]}", "get_devices", {})])
    llm = FakeLLM(respond)
    graph = AnswerGraph(llm, budget_s=40, clock=lambda: now[0])
    history = [ChatMessage(Role.USER, "what's on?")]
    reply = graph.answer(TurnContext(history=history, tools=build_tools(FakeApi("t", home), home)),
                         text="what's on?", user_name="Ali", system="S")
    assert reply == TOO_SLOW
    assert len(llm.calls) == 2                                   # stopped instead of a third round
    assert history[-1].content == TOO_SLOW


def test_tools_of_one_round_all_run(home):
    calls = [ToolCall("c1", "set_device", {"device": "bulb", "state": "on"}),
             ToolCall("c2", "set_device", {"device": "fan", "state": "on"})]
    api = FakeApi("t", home)
    llm = FakeLLM(lambda m, t: LLMReply(text="", tool_calls=calls))
    graph = AnswerGraph(llm)
    reply = graph.answer(TurnContext(history=[ChatMessage(Role.USER, "bulb and fan on")], tools=build_tools(api, home)),
                         text="bulb and fan on", user_name="Ali", system="S")
    assert sorted(c[0] for c in api.commands) == ["d1", "d3"]
    assert "Bulb" in reply and "Fan" in reply
    assert len(llm.calls) == 1


# ------------------------------------------------------------------ the guard on its own
@pytest.mark.parametrize("text,lang", [("batti band karo", "roman"), ("what is on", "en"), ("بتی بند کرو", "ur"),
                                       ("is the fan on please", "en"), ("pankha chal raha hai?", "roman")])
def test_language_of_the_fixed_replies(text, lang):
    assert language(text) == lang


def test_guard_routes():
    g = ScopeGuard()
    assert g.decide("hello", followup=False).route == GREET
    assert g.decide("who is the prime minister", followup=False).route == DECLINE
    assert g.decide("why?", followup=True).route == AGENT
    assert g.decide("is the Khan residence board stable", followup=False, vocab=["khan", "residence"]).route == AGENT
    assert g.decide("what are your charges for a visit", followup=False).route == NO_INFO


def test_guard_edge_cases_from_real_questions():
    g = ScopeGuard()
    assert g.decide("what can you do?", followup=False).route == GREET          # explains itself
    assert g.decide("help", followup=False).route == GREET
    assert g.decide("how do I add my wife", followup=False).route == AGENT     # people in the home
    assert g.decide("biwi ko kaise add karun", followup=False).route == AGENT
    assert g.decide("why is it so slow", followup=False).route == AGENT
    assert g.decide("how do I cook biryani", followup=False).route == DECLINE
    assert g.decide("best phone under 50000", followup=False).route == DECLINE

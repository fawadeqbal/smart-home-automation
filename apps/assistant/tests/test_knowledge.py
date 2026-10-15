"""The Help Center search (keywords + meaning), and the tools the AI uses for product questions and problems."""
import json
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from assistant.config import Settings
from assistant.domain.models import ToolCall
from assistant.knowledge import Index, KnowledgeBase, split_article, tokens
from assistant.tools import build_tools
from assistant.web import create_app

from conftest import FakeApi, FakeSTT, FakeTTS, bulb_llm, device

ARTICLES = [
    {"id": "a1", "title": "A board is offline", "category": "TROUBLESHOOTING", "audience": "EVERYONE",
     "tags": ["wifi nahi", "board band"], "body": "If a board shows offline, check its power first.\n\nThen check the Wi-Fi router is on."},
    {"id": "a2", "title": "Add a family member and choose their rooms", "category": "USAGE", "audience": "EVERYONE",
     "tags": ["invite", "wife"], "body": "Open People, tap Invite, choose the rooms and share the link on WhatsApp."},
    {"id": "a3", "title": "Warranty", "category": "POLICY", "audience": "EVERYONE", "tags": ["guarantee", "warranty"],
     "body": "Boards are covered for twelve months from installation."},
    {"id": "a4", "title": "Adopt a board on installation day", "category": "PROCESS", "audience": "STAFF",
     "tags": ["installer"], "body": "Assign the board from stock to the home, power it, then adopt it in Boards."},
]


def test_words_in_both_scripts_and_no_stop_words():
    assert tokens("How do I invite my Wife?") == ["invite", "wife"]
    assert tokens("وارنٹی کتنی ہے") == ["وارنٹی", "کتنی", "ہے"]
    assert tokens("boards Lights") == ["board", "light"]


def test_long_articles_are_split_and_each_piece_keeps_its_title():
    body = "\n\n".join(f"## Step {i}\n" + " ".join(["word"] * 120) for i in range(5))
    chunks = split_article({"id": "x", "title": "Long one", "category": "USAGE", "body": body, "tags": ["t1"]})
    assert len(chunks) >= 3
    assert all(c.text.startswith("Long one\nKeywords: t1\n") for c in chunks)


def test_keywords_find_the_right_article_and_roman_urdu_tags_count():
    index = Index(ARTICLES, embed=None)
    assert index.search("board offline")[0].chunk.title == "A board is offline"
    assert index.search("guarantee kitni hai")[0].chunk.title == "Warranty"
    assert index.search("wifi nahi chal raha")[0].chunk.title == "A board is offline"
    assert index.search("") == []


def test_meaning_search_finds_what_keywords_miss():
    # a toy "embedding": questions about people land near the family article
    def embed(texts):
        return [[1.0, 0.0] if any(w in t.lower() for w in ("family", "spouse", "husband")) else [0.0, 1.0] for t in texts]
    index = Index(ARTICLES, embed=embed)
    hit = index.search("my husband needs access")[0]
    assert hit.chunk.title.startswith("Add a family member") and hit.meaning_rank == 0 and hit.keyword_rank is None


def test_the_index_is_rebuilt_only_when_the_help_center_changes():
    kb = KnowledgeBase(None)
    loads = []
    load = lambda: loads.append(1) or ARTICLES  # noqa: E731
    kb.index("org1:everyone:4:100", load)
    kb.index("org1:everyone:4:100", load)
    kb.index("org1:everyone:5:200", load)
    assert len(loads) == 2


def test_search_help_tool_answers_from_excerpts_and_says_when_nothing_matches():
    FakeApi.help = ARTICLES
    api = FakeApi("tok", [])
    tools = build_tools(api, [], knowledge=KnowledgeBase(None))
    out = tools.execute(ToolCall("1", "search_help", {"query": "warranty for boards"}))
    assert out.startswith("Answer only from these Help Center excerpts") and "[1] Warranty (policy)" in out
    assert "twelve months" in out
    none = tools.execute(ToolCall("2", "search_help", {"query": "zzzz qqqq"}))
    assert none.startswith("No Help Center article matches")


def test_diagnose_for_an_owner_sees_boards_for_a_member_only_devices():
    devs = [device("d1", "Bulb", online=False), device("d2", "Fan"),
            device("d3", "Climate", controllable=False, state={}, fields=[{"key": "temperature", "label": "Temperature"}])]
    member = FakeApi("tok", devs)
    out = build_tools(member, devs).execute(ToolCall("1", "diagnose_home", {}))
    assert "Devices not responding (their board is offline): Bulb in the Living room." in out
    assert "Sensors online but without a reading yet: Climate in the Living room." in out
    assert "Board" not in out.replace("their board", "")

    owner = FakeApi("tok", devs)
    two_hours = (datetime.now(timezone.utc) - timedelta(hours=3)).isoformat()
    owner.boards = [
        {"name": "Hall board", "status": "ADOPTED", "online": False, "lastSeenAt": two_hours, "rssi": -60},
        {"name": "Kitchen board", "status": "ADOPTED", "online": True, "rssi": -86, "health": {"rssi": -86},
         "configRev": 3, "appliedRev": 2, "firmware": "2.2.0"},
        {"name": "Bedroom board", "status": "ADOPTED", "online": True, "health": {"rssi": -55}, "configRev": 1, "appliedRev": 1, "firmware": "2.2.0"},
    ]
    out = build_tools(owner, devs).execute(ToolCall("1", "diagnose_home", {}))
    assert "Board Hall board: offline, last seen 3 hours ago." in out
    assert "Board Kitchen board: weak Wi-Fi (-86 dBm; under -80 drops out); new settings not applied yet." in out
    assert "Board Bedroom board: online, Wi-Fi -55 dBm, firmware 2.2.0." in out
    owner.boards = []


def test_the_console_can_see_what_a_question_finds_as_customer_or_staff():
    FakeApi.help = ARTICLES
    app = create_app(Settings(shared_secret="s"), llm=bulb_llm(), stt=FakeSTT(), tts=FakeTTS(),
                     api_factory=lambda t: FakeApi(t, []), knowledge=KnowledgeBase(None))
    c = TestClient(app)
    body = {"question": "adopt the board installer", "token": "t"}
    assert c.post("/v1/help/search", json=body).status_code == 401
    customer = c.post("/v1/help/search", json=body, headers={"X-Assistant-Secret": "s"}).json()["hits"]
    staff = c.post("/v1/help/search", json={**body, "staff": True}, headers={"X-Assistant-Secret": "s"}).json()["hits"]
    assert all(h["audience"] == "EVERYONE" for h in customer)          # staff articles never reach customers
    assert staff[0]["title"] == "Adopt a board on installation day"
    assert json.dumps(staff)                                          # plain JSON for the console

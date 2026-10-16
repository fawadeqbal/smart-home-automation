"""Board connections in the assistant: the console (staff, scoped by role on the API) and inside a home."""
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from assistant.config import Settings
from assistant.connections import BoardConnectionsTool, FleetStatusTool, fleet_summary, role_text
from assistant.domain.models import LLMReply, ToolCall
from assistant.home_api import HomeApiError
from assistant.knowledge import KnowledgeBase
from assistant.tools import build_console_tools, build_tools
from assistant.web import create_app

from conftest import FakeApi, FakeLLM, FakeSTT, FakeTTS

SECRET = "s3cret"
HEADERS = {"X-Assistant-Secret": SECRET}


def ago(**kw):
    return (datetime.now(timezone.utc) - timedelta(**kw)).isoformat().replace("+00:00", "Z")


KHAN = {"id": "h1", "name": "Khan residence", "city": "Lahore", "installer": "Ravi"}
IYER = {"id": "h2", "name": "Iyer apartment", "city": "Karachi", "installer": None}
FLEET = {"tracking": True, "boards": [
    {"id": "esp-7b8278", "name": "Living room board", "online": True, "connectedSince": ago(hours=3), "lastSeenAt": ago(minutes=1),
     "home": KHAN, "publicIp": "103.204.32.210", "publicPlace": "Swabi, Khyber Pakhtunkhwa, PK", "publicIsp": "Pace Telecom",
     "connects24h": 2, "connects7d": 7, "ends7d": {"timeout": 3, "closed": 1, "clean": 1, "replaced": 1, "error": 0},
     "lastEnd": {"at": ago(hours=3, minutes=1), "reason": "timeout", "note": None}},
    {"id": "esp-aa0001", "name": "Kitchen board", "online": False, "connectedSince": None, "lastSeenAt": ago(hours=5),
     "home": IYER, "publicIp": "39.45.1.2", "publicPlace": "Karachi, Sindh, PK", "publicIsp": "PTCL",
     "connects24h": 0, "connects7d": 1, "ends7d": {"timeout": 1, "closed": 0, "clean": 0, "replaced": 0, "error": 0},
     "lastEnd": {"at": ago(hours=5), "reason": "timeout", "note": None}},
]}
HISTORY = {
    "tracking": True,
    "board": {"id": "esp-7b8278", "name": "Living room board", "online": True, "lastSeenAt": ago(minutes=1), "home": KHAN},
    "current": {"ip": "103.204.32.210", "place": "Swabi, Khyber Pakhtunkhwa, PK", "isp": "Pace Telecom",
                "ipSince": ago(days=1), "connectedSince": ago(hours=3)},
    "stats": {"connects24h": 2, "connects7d": 7, "ends7d": {"timeout": 3, "closed": 1, "clean": 1, "replaced": 1, "error": 0}, "addresses7d": 2},
    "history": [
        {"ip": "103.204.32.210", "place": "Swabi, Khyber Pakhtunkhwa, PK", "isp": "Pace Telecom", "connectedAt": ago(hours=3),
         "endedAt": None, "endReason": None, "endNote": None, "seconds": 10800, "newAddress": False},
        {"ip": "223.123.94.82", "place": "Rawalpindi, Punjab, PK", "isp": "CMPak", "connectedAt": ago(hours=9),
         "endedAt": ago(hours=3, minutes=1), "endReason": "timeout", "endNote": None, "seconds": 21540, "newAddress": True},
    ],
}


class StaffApi(FakeApi):
    """What the API returns for one staff member (already limited to their homes by the server)."""

    def __init__(self, token, fleet=FLEET):
        super().__init__(token, [])
        self.fleet = fleet
        self.asked = []

    def connectivity(self):
        return self.fleet

    def board_connections(self, node_id):
        self.asked.append(node_id)
        if node_id not in {b["id"] for b in self.fleet["boards"]}:
            raise HomeApiError("No such board.")
        return {**HISTORY, "board": {**HISTORY["board"], "id": node_id}}

    def help_key(self, customer_view=False):
        return "k"

    def help_articles(self, customer_view=False):
        return []

    def scenes(self):
        return []


class MemberApi(FakeApi):
    """A family member in a home: the API refuses board details, as in the app."""

    def nodes(self):
        raise HomeApiError("You do not have permission for this.")

    def node_connections(self, node_id):
        raise HomeApiError("You do not have permission for this.")

    def scenes(self):
        return []


def test_fleet_status_lists_boards_in_words():
    out = FleetStatusTool(StaffApi("t")).run({})
    assert out.startswith("2 boards.")
    assert "Living room board" in out and "Khan residence" in out and "installer Ravi" in out
    assert "103.204.32.210 (Swabi, Khyber Pakhtunkhwa, PK, Pace Telecom)" in out
    assert "lost contact 3 times" in out
    assert "OFFLINE, last heard from 5 hours ago" in out


def test_fleet_status_filters():
    tool = FleetStatusTool(StaffApi("t"))
    offline = tool.run({"only": "offline"})
    assert "Kitchen board" in offline and "Living room board" not in offline
    dropping = tool.run({"only": "dropping"})
    assert "Living room board" in dropping and "Kitchen board" not in dropping
    assert "Kitchen board" in tool.run({"match": "ptcl"})
    assert "Living room board" in tool.run({"match": "lahore"})
    assert tool.run({"match": "nowhere"}) == "No boards match."


def test_board_connections_in_the_console_finds_by_board_or_home():
    api = StaffApi("t")
    tool = BoardConnectionsTool(api, console=True)
    out = tool.run({"board": "khan residence"})
    assert api.asked == ["esp-7b8278"]
    assert "is online for 3 hours" in out
    assert "103.204.32.210 (Swabi, Khyber Pakhtunkhwa, PK, Pace Telecom)" in out
    assert "not the street" in out
    assert "lost contact (it stopped answering: power cut, or Wi-Fi or internet down)" in out
    assert "(new address)" in out
    assert tool.run({"board": "board"}).startswith("Error: several boards match")
    assert tool.run({"board": "Ali's flat"}).startswith("Error: no board matches")


def test_a_family_member_is_told_to_ask_the_owner():
    out = BoardConnectionsTool(MemberApi("t", []), console=False).run({})
    assert "only the home's owner and admins" in out and "ask the owner" in out


def test_console_tools_are_read_only():
    names = {s.name for s in build_console_tools(StaffApi("t"), knowledge=KnowledgeBase(None)).specs()}
    assert names == {"fleet_status", "board_connections", "home_details", "outages_overview", "search_help"}
    home = {s.name for s in build_tools(StaffApi("t"), []).specs()}
    assert "board_connections" in home and "diagnose_home" in home and "fleet_status" not in home


def test_summary_and_roles():
    s = fleet_summary(FLEET)
    assert s.startswith("2 boards in 2 homes: 1 online, 1 offline.")
    assert "Offline: Kitchen board in Iyer apartment." in s
    assert "Lost contact 3 or more times this week: Living room board in Khan residence." in s
    assert fleet_summary({"boards": []}).startswith("No boards")
    assert "only see the homes assigned to them" in role_text("INSTALLER", "Fawad Smart Homes")
    assert "every home" in role_text("SUPERADMIN", "X") and "read-only" in role_text("SUPPORT", "X")


def make(llm, api_cls=StaffApi):
    apis = []

    def factory(token):
        api = api_cls(token)
        apis.append(api)
        return api

    app = create_app(Settings(shared_secret=SECRET), llm=llm, stt=FakeSTT(), tts=FakeTTS(),
                     api_factory=factory, knowledge=KnowledgeBase(None))
    return TestClient(app), apis


CONSOLE = {"user_id": "u9", "user_name": "Ravi", "token": "tok-ravi", "console": True, "staff_role": "INSTALLER",
           "company": "Fawad Smart Homes"}


def test_a_console_chat_gets_the_role_the_summary_and_only_read_only_tools():
    def respond(msgs, tools):
        last = msgs[-1]
        if last.role.value == "tool":
            return LLMReply(text=f"From the tool: {last.content[:40]}")
        return LLMReply(text="", tool_calls=[ToolCall("c1", "fleet_status", {"only": "offline"})])
    llm = FakeLLM(respond)
    client, apis = make(llm)
    r = client.post("/v1/chat", json={**CONSOLE, "text": "which boards are offline?", "speak": False}, headers=HEADERS)
    assert r.status_code == 200, r.text
    assert r.json()["reply"].startswith("From the tool: 1 boards.")
    first = llm.calls[0]
    assert "an installer of Fawad Smart Homes" in first["system"]
    assert "do not exist for them" in first["system"]
    assert "2 boards in 2 homes" in first["system"]
    assert "the company's console" in first["system"]           # the console instructions, not the home ones
    assert {t.name for t in first["tools"]} == {"fleet_status", "board_connections", "home_details", "outages_overview", "search_help"}
    assert apis[0].token == "tok-ravi"                           # always the person's own rights


def test_console_and_home_conversations_are_separate():
    llm = FakeLLM()
    client, _ = make(llm)
    client.post("/v1/chat", json={**CONSOLE, "text": "which boards are offline?", "speak": False}, headers=HEADERS)
    client.post("/v1/chat", json={"user_id": "u9", "user_name": "Ravi", "token": "tok-ravi", "home_id": "h1",
                                  "home_name": "Khan residence", "text": "is the bulb on?", "speak": False}, headers=HEADERS)
    home_call = llm.calls[-1]
    assert [m.content for m in home_call["messages"]] == ["is the bulb on?"]
    assert "the company's console" not in home_call["system"]
    client.post("/v1/reset", json={k: v for k, v in CONSOLE.items()}, headers=HEADERS)
    client.post("/v1/chat", json={**CONSOLE, "text": "any board dropped today?", "speak": False}, headers=HEADERS)
    assert [m.content for m in llm.calls[-1]["messages"]] == ["any board dropped today?"]

"""Knowing the whole home and managing it from the assistant, always with the person's own rights."""
import pytest
from fastapi.testclient import TestClient

from assistant.config import Settings
from assistant.domain.models import LLMReply
from assistant.guard import AGENT, ScopeGuard
from assistant.home_api import HomeApiError
from assistant.knowledge import KnowledgeBase
from assistant.manage import (CONFIRM, CreateSceneTool, DeleteRoomTool, HomeDetailsTool, InvitePersonTool,
                              RemovePersonTool, UpdateDeviceTool, UpdatePersonTool, home_facts)
from assistant.web import create_app

from conftest import FakeApi, FakeLLM, FakeSTT, FakeTTS, device

ROOMS = [{"id": "r1", "name": "Hall"}, {"id": "r2", "name": "Bedroom"}, {"id": "r3", "name": "Store"}]


def home():
    devs = [device("d1", "Bulb", room="Hall", aliases=["batti"], state={"on": True}), device("d2", "Fan", room="Bedroom"),
            device("d3", "Climate", room="Hall", controllable=False, state={"temperature": 27})]
    for d, r, n in zip(devs, ["r1", "r2", "r1"], ["n1", "n1", "n2"]):
        d["roomId"], d["nodeId"] = r, n
    return devs


class OwnerApi(FakeApi):
    """What the API gives the home's owner (and records what the tools changed)."""

    def __init__(self, token="tok", devices=None):
        super().__init__(token, devices if devices is not None else home())
        self.changes = []
        self.calls = []

    def rooms(self):
        self.calls.append("rooms")
        return ROOMS

    def nodes(self):
        return [{"id": "n1", "name": "Living room board", "online": True},
                {"id": "n2", "name": "Hall sensor board", "online": False, "lastSeenAt": "2020-01-01T00:00:00Z"}]

    def users(self):
        return [{"id": "u1", "name": "Fawad Iqbal", "email": "f@x.pk", "role": "OWNER", "rooms": []},
                {"id": "u2", "name": "Sara", "email": "sara@x.pk", "role": "MEMBER", "rooms": [{"roomId": "r1", "access": "CONTROL"}]}]

    def invites(self):
        return [{"email": "ali@x.pk", "name": "Ali", "role": "GUEST"}]

    def create_room(self, name):
        self.changes.append(("create_room", name))
        return {"id": "r9", "name": name}

    def delete_room(self, room_id):
        self.changes.append(("delete_room", room_id))

    def update_device(self, device_id, body):
        self.changes.append(("update_device", device_id, body))
        return {}

    def invite(self, body):
        self.changes.append(("invite", body))
        return {"path": "/invite/abc", "expiresInDays": 7, "existingAccount": False}

    def update_user(self, user_id, body):
        self.changes.append(("update_user", user_id, body))

    def set_user_rooms(self, user_id, rooms):
        self.changes.append(("set_user_rooms", user_id, rooms))

    def remove_user(self, user_id):
        self.changes.append(("remove_user", user_id))

    def create_scene(self, body):
        self.changes.append(("create_scene", body))
        return {}

    def platform_homes(self):
        return [{"id": "h1", "name": "Fawad Home", "owner": "Fawad Iqbal", "city": "Swabi"}]

    def platform_home(self, home_id):
        return {"home": {"name": "Fawad Home", "city": "Swabi", "statusLabel": "Live", "owner": {"name": "Fawad Iqbal"},
                         "installer": {"name": "Ravi"}},
                "stats": {"people": 2, "devices": 3, "boardsOnline": 1, "boardsTotal": 1},
                "rooms": [{"name": "Living Room", "devices": 3, "on": 1}, {"name": "Kitchen", "devices": 0}],
                "boards": [{"name": "Living Room", "condText": "Online", "devices": 3, "lastSeen": "just now", "firmware": "2.3.0"}],
                "unroomed": 0}


class MemberApi(OwnerApi):
    def users(self):
        raise HomeApiError("You do not have permission for this.")

    nodes = invites = users


# ------------------------------------------------------------------ knowing the home
def test_the_whole_home_in_words():
    text = home_facts(OwnerApi(), home(), me="u1")
    assert "Their role in this home: OWNER. They may manage rooms, devices, people and scenes." in text
    assert "Rooms (3):" in text
    assert "- Hall: 2 devices, 1 on" in text and "- Bedroom: 1 device" in text and "- Store: no devices yet" in text
    assert "Devices they can see: 3 in total (2 switchable, 1 sensors)." in text
    assert "- Living room board: online; 2 devices" in text
    assert "- Hall sensor board: OFFLINE, last heard from" in text
    assert "- Fawad Iqbal: owner (this is them)" in text and "- Sara: member" in text
    assert "Invited, not joined yet: Ali (guest)" in text


def test_a_member_is_told_they_cannot_manage():
    text = home_facts(MemberApi(), home(), me="u2")
    assert "member or guest" in text and "only the owner and admins can" in text
    assert "People (" not in text and "Boards (" not in text
    assert "Rooms (3):" in text


SECRET = "s3cret"


def make(api, llm, **settings):
    app = create_app(Settings(shared_secret=SECRET, public_url="https://home.example", **settings), llm=llm, stt=FakeSTT(),
                     tts=FakeTTS(), api_factory=lambda token: api, knowledge=KnowledgeBase(None))
    return TestClient(app)


def ask(client, text):
    r = client.post("/v1/chat", json={"user_id": "u1", "user_name": "Fawad", "home_id": "h1", "token": "t", "text": text,
                                      "speak": False}, headers={"X-Assistant-Secret": SECRET})
    return r.json()["reply"]


def test_the_ai_knows_the_whole_home_and_has_the_management_tools():
    llm = FakeLLM()
    ask(make(OwnerApi(), llm, quick_commands=False), "how many rooms i have")
    call = llm.calls[0]
    assert "# The whole home" in call["system"] and "Rooms (3):" in call["system"]
    names = {t.name for t in call["tools"]}
    assert {"home_overview", "add_room", "rename_room", "delete_room", "update_device", "list_people", "invite_person",
            "update_person", "remove_person", "create_scene", "delete_scene"} <= names


def test_an_instant_command_does_not_load_the_whole_home():
    api = OwnerApi()
    reply = ask(make(api, FakeLLM()), "turn off the bulb")
    assert "Bulb" in reply and api.calls == []


# ------------------------------------------------------------------ managing it
def test_deleting_a_room_asks_first():
    api = OwnerApi()
    tool = DeleteRoomTool(api, home())
    first = tool.run({"room": "hall"})
    assert first.startswith(CONFIRM) and "Bulb, Climate" in first and api.changes == []
    assert tool.run({"room": "hall", "confirmed": True}) == "Deleted the room Hall. Bulb, Climate are now not in a room."
    assert api.changes == [("delete_room", "r1")]


def test_removing_a_person_asks_first():
    api = OwnerApi()
    tool = RemovePersonTool(api)
    assert tool.run({"person": "sara"}).startswith(CONFIRM) and api.changes == []
    assert tool.run({"person": "sara", "confirmed": True}) == "Removed Sara from this home."
    assert api.changes == [("remove_user", "u2")]


def test_rename_move_and_alias_a_device():
    api = OwnerApi()
    out = UpdateDeviceTool(api, home()).run({"device": "fan", "new_name": "Ceiling fan", "room": "store", "add_alias": "pankha"})
    assert out == "Fan in the Bedroom: renamed it to Ceiling fan, moved it to Store, it can now also be called pankha."
    assert api.changes == [("update_device", "d2", {"name": "Ceiling fan", "roomId": "r3", "aliases": ["pankha"]})]
    assert UpdateDeviceTool(api, home()).run({"device": "fan", "room": "garage"}).startswith("Error: there is no room called 'garage'")


def test_invite_with_rooms_gives_a_link():
    api = OwnerApi()
    out = InvitePersonTool(api, "https://home.example").run(
        {"email": "maid@x.pk", "name": "Shazia", "role": "guest", "rooms": ["hall"], "access": "control"})
    assert out.startswith("Invite made for maid@x.pk as guest with 1 room(s). Send them this link (valid 7 days): "
                          "https://home.example/invite/abc")
    assert api.changes == [("invite", {"email": "maid@x.pk", "role": "GUEST", "name": "Shazia",
                                       "rooms": [{"roomId": "r1", "access": "CONTROL"}]})]
    assert InvitePersonTool(api).run({"email": "no email"}).startswith("Error: ask for their email")


def test_change_someones_rooms_and_role():
    api = OwnerApi()
    out = UpdatePersonTool(api).run({"person": "sara", "role": "guest", "rooms": ["all"], "access": "view"})
    assert out == "Sara: is now guest, may now use 3 room(s)."
    assert api.changes == [("update_user", "u2", {"role": "GUEST"}),
                           ("set_user_rooms", "u2", [{"roomId": r["id"], "access": "VIEW"} for r in ROOMS])]
    assert UpdatePersonTool(api).run({"person": "sara", "role": "owner"}).startswith("Error: the role can be")


def test_create_a_scene_from_spoken_names():
    api = OwnerApi()
    out = CreateSceneTool(api, home()).run({"name": "Good night", "actions": [{"device": "batti", "state": "off"},
                                                                            {"device": "fan", "state": "on"}]})
    assert out.startswith("Saved the scene Good night: Bulb in the Hall off, Fan in the Bedroom on.")
    assert api.changes == [("create_scene", {"name": "Good night", "actions": [{"deviceId": "d1", "on": False},
                                                                                 {"deviceId": "d2", "on": True}]})]


def test_the_server_decides_who_may_manage():
    class Refuses(OwnerApi):
        def create_room(self, name):
            raise HomeApiError("Only the owner or an admin can do this.")
    from assistant.domain.models import ToolCall
    from assistant.tools import build_tools
    tools = build_tools(Refuses(), home())
    assert tools.execute(ToolCall("c", "add_room", {"name": "Garage"})) == "Error: Only the owner or an admin can do this."


# ------------------------------------------------------------------ the console
def test_console_home_details():
    out = HomeDetailsTool(OwnerApi()).run({"home": "fawad"})
    assert out.startswith("Fawad Home (Swabi): Live. Owner: Fawad Iqbal. Installer: Ravi. People: 2. Devices: 3. Boards online: 1 of 1.")
    assert "Rooms (2):\n- Living Room: 3 devices, 1 on\n- Kitchen: 0 devices" in out
    assert "- Living Room: Online, 3 devices, last seen just now, firmware 2.3.0" in out


@pytest.mark.parametrize("q", ["hiw many rooms i have", "hiw much devices are attached", "rename the fan",
                               "remove sara", "who has access to my home"])
def test_management_questions_reach_the_ai(q):
    assert ScopeGuard().decide(q, followup=False).route == AGENT


def test_a_room_that_only_differs_in_capitals_is_not_added_twice():
    api = OwnerApi()
    from assistant.manage import AddRoomTool
    assert AddRoomTool(api).run({"name": "hall"}) == "There is already a room called Hall; nothing added."
    assert api.changes == []


OUTAGES = {"days": 7, "timezone": "Asia/Karachi", "summary": {
    "powerCuts": 2, "powerSeconds": 4200, "networkOuts": 1, "networkSeconds": 600, "restarts": 1, "crashes": 0,
    "lastPower": {"startedAt": "2026-10-16T10:10:00.000Z", "endedAt": "2026-10-16T11:05:00.000Z", "seconds": 3300}},
    "outages": [{"id": "o1", "kind": "POWER", "label": "Power cut", "board": "Living room board", "seconds": 3300,
                 "startedAt": "2026-10-16T10:10:00.000Z", "endedAt": "2026-10-16T11:05:00.000Z", "reset": "Power On"}]}


def test_power_cuts_in_words():
    from zoneinfo import ZoneInfo
    from assistant.manage import PowerHistoryTool

    class Api(OwnerApi):
        def outages(self, days=7):
            self.asked = days
            return {**OUTAGES, "days": days}
    api = Api()
    out = PowerHistoryTool(api, ZoneInfo("Asia/Karachi")).run({"days": 30})
    assert api.asked == 30
    assert out.startswith("Last 30 days: 2 power cuts (1 h 10 min without power), 1 times the Wi-Fi or internet was down (10 min)")
    assert "- Power cut: Fri 16 Oct 3:10 PM to Fri 16 Oct 4:05 PM (55 min), Living room board" in out
    facts = home_facts(api, home(), me="u1", tz=ZoneInfo("Asia/Karachi"))
    assert "Power this week: 2 power cuts, 1 h 10 min without power; the last one Fri 16 Oct 3:10 PM for 55 min." in facts


def test_power_questions_reach_the_ai():
    for q in ["when did the power go", "load shedding kab hui", "was there an outage last night"]:
        assert ScopeGuard().decide(q, followup=False).route == AGENT


# ------------------------------------------------------------------ rules, away mode, safety, sunset timers
class RulesApi(OwnerApi):
    def __init__(self):
        super().__init__(devices=home() + [device("d4", "Gate", room="Hall", controllable=False, state={"active": False})])
        self._rules = []
        self._away = {"on": False, "lights": [], "switches": [{"id": "d1", "name": "Bulb"}, {"id": "d2", "name": "Fan"}]}

    def scenes(self):
        return [{"id": "sc1", "name": "Good night"}]

    def rules(self):
        return self._rules

    def create_rule(self, body):
        self.changes.append(("create_rule", body))
        r = {"id": f"r{len(self._rules) + 1}", "name": "Gate rule", "enabled": True, "summary": "When Gate opens: Bulb on for 5 min, tell me"}
        self._rules.append(r)
        return r

    def update_rule(self, rule_id, body):
        self.changes.append(("update_rule", rule_id, body))
        return {}

    def delete_rule(self, rule_id):
        self.changes.append(("delete_rule", rule_id))

    def away(self):
        return self._away

    def set_away(self, body):
        self.changes.append(("set_away", body))
        self._away = {**self._away, **({"on": body["on"]} if "on" in body else {}), **({"lights": body["lights"]} if "lights" in body else {})}
        return self._away


def test_create_rule_from_words():
    from assistant.manage import CreateRuleTool
    api = RulesApi()
    out = CreateRuleTool(api, api.devices()).run({
        "when_device": "gate", "event": "opens", "from_time": "22:00", "to_time": "06:00",
        "switch": [{"device": "batti", "state": "on", "for_minutes": 5}], "tell": "me", "scene": "good night"})
    assert out.startswith("Saved the rule: When Gate opens")
    body = api.changes[-1][1]
    assert body["trigger"] == {"deviceId": "d4", "event": "opens"}
    assert body["conditions"] == {"from": "22:00", "to": "06:00"}
    assert body["actions"] == [{"type": "device", "deviceId": "d1", "on": True, "forMinutes": 5},
                               {"type": "scene", "sceneId": "sc1"}, {"type": "notify", "to": "me"}]
    # a reading needs a value; a rule must do something
    assert CreateRuleTool(api, api.devices()).run({"when_device": "climate", "event": "above"}).startswith("Error: say the value")
    assert "say what the rule should do" in CreateRuleTool(api, api.devices()).run({"when_device": "gate", "event": "opens"})
    temp = CreateRuleTool(api, api.devices()).run({"when_device": "climate", "event": "above", "value": 32, "switch": [{"device": "fan", "state": "on"}]})
    assert temp.startswith("Saved") and api.changes[-1][1]["trigger"] == {"deviceId": "d3", "event": "above", "value": 32.0}


def test_rules_list_pause_and_delete_needs_a_yes():
    from assistant.manage import ChangeRuleTool, CreateRuleTool, ListRulesTool
    api = RulesApi()
    CreateRuleTool(api, api.devices()).run({"when_device": "gate", "event": "opens", "tell": "me"})
    assert ListRulesTool(api).run({}).startswith("1. When Gate opens")
    assert ChangeRuleTool(api).run({"which": "1", "action": "pause"}) == "Paused the rule 'Gate rule'."
    assert api.changes[-1] == ("update_rule", "r1", {"enabled": False})
    assert ChangeRuleTool(api).run({"which": "gate", "action": "delete"}).startswith(CONFIRM)
    assert ChangeRuleTool(api).run({"which": "gate", "action": "delete", "confirmed": True}) == "Deleted the rule 'Gate rule'."
    assert "no matching rule" in ChangeRuleTool(api).run({"which": "kitchen", "action": "pause"})


def test_away_mode_and_device_safety():
    from assistant.manage import AwayModeTool, DeviceSafetyTool
    api = RulesApi()
    assert AwayModeTool(api, api.devices()).run({"turn": "status"}) == "Away mode is off."
    on = AwayModeTool(api, api.devices()).run({"turn": "on", "lights": ["bulb"]})
    assert on.startswith("Away mode is ON") and "Bulb will go on and off" in on
    assert api.changes[-1] == ("set_away", {"lights": ["d1"], "on": True})
    out = DeviceSafetyTool(api, api.devices()).run({"device": "fan", "child_lock": True, "auto_off_minutes": 60})
    assert out == "Fan in the Bedroom: child lock on, switches itself off 60 minutes after going on."
    assert api.changes[-1] == ("update_device", "d2", {"childLock": True, "autoOffMinutes": 60})
    DeviceSafetyTool(api, api.devices()).run({"device": "fan", "auto_off_minutes": 0})
    assert api.changes[-1] == ("update_device", "d2", {"autoOffMinutes": None})


def test_sunset_schedules():
    from assistant.tools import ScheduleDeviceTool
    api = FakeApi("tok", home())
    out = ScheduleDeviceTool(api, api.devices()).run({"device": "bulb", "state": "on", "at_sun": "sunset", "sun_offset_minutes": 15})
    body = api.schedules()[-1]["body"]
    assert body["kind"] == "SUN" and body["sunEvent"] == "SUNSET" and body["offsetMin"] == 15
    api._schedules[-1].update({"kind": "SUN", "sunEvent": "SUNSET", "offsetMin": 15})
    from assistant.tools import _when_text
    assert _when_text(api._schedules[-1]) == "every day 15 minutes after sunset"
    assert out.startswith("Scheduled")


def test_energy_usage_in_words():
    from assistant.manage import EnergyUsageTool

    class EnergyApi(OwnerApi):
        def energy(self, days=7):
            return {"days": days, "tariff": 60, "tariffSet": False, "total": {"kwh": 41.25, "cost": 2475},
                    "month": {"kwh": 177, "cost": 10610}, "unknown": 1,
                    "devices": [{"name": "Geyser", "hours": 14.5, "kwh": 29.0, "cost": 1740, "wattsSource": "guessed"},
                                {"name": "Fan", "hours": 60, "kwh": 4.5, "cost": 270, "wattsSource": "set"},
                                {"name": "Socket", "hours": 3, "kwh": 0, "cost": 0, "wattsSource": "unknown"}]}

    out = EnergyUsageTool(EnergyApi()).run({"days": 7})
    assert out.startswith("Estimate for the last 7 days: about 41.2 units (kWh), Rs 2,475 at Rs 60 a unit (a typical rate")
    assert "a month is about 177 units, Rs 10,610" in out
    assert "Geyser: 14.5 h on, 29.0 units, Rs 1,740 (power guessed from its name)" in out
    assert "1 switches have no power set" in out and out.endswith("not a meter reading.")


def test_remember_forget_and_summary():
    from assistant.manage import ForgetTool, RememberTool, SummaryTool

    class MemApi(OwnerApi):
        def __init__(self):
            super().__init__()
            self.mem = []

        def memories(self):
            return self.mem

        def remember(self, text):
            self.mem.append({"id": f"m{len(self.mem) + 1}", "text": text})
            return self.mem[-1]

        def forget(self, mid):
            self.mem = [m for m in self.mem if m["id"] != mid]

        def summary(self, period="week"):
            return {"home": "Iqbal home", "period": period, "range": "8 Oct – 14 Oct", "lines": ["Power: 3 cuts, 2 h without power", "Alerts: none"]}

    api = MemApi()
    assert RememberTool(api).run({"text": "The store light is the one by the stairs"}).startswith("Remembered:")
    assert RememberTool(api).run({"text": "My wifi password is abc123"}).startswith("Error: don't store passwords")
    RememberTool(api).run({"text": "Wakes up at 6 am"})
    assert "Things they asked you to remember" in home_facts(api, api.devices()) and "- Wakes up at 6 am" in home_facts(api, api.devices())
    assert ForgetTool(api).run({"which": "store light"}) == "Forgot: The store light is the one by the stairs."
    assert ForgetTool(api).run({"which": "everything"}).startswith(CONFIRM)
    assert ForgetTool(api).run({"which": "everything", "confirmed": True}) == "Forgot all 1 things."
    out = SummaryTool(api).run({})
    assert out.startswith("Iqbal home, this week (8 Oct – 14 Oct): Power: 3 cuts")


def test_help_requests_need_a_yes():
    from assistant.manage import HelpRequestsTool, OpenHelpRequestTool

    class TicketApi(OwnerApi):
        def __init__(self):
            super().__init__()
            self.opened = []

        def open_ticket(self, body):
            self.opened.append(body)
            return {"number": 7, "priority": "HIGH"}

        def tickets(self):
            return [{"number": 7, "title": "Fan not working", "statusText": "Waiting for you",
                     "messages": [{"body": "Bedroom fan is dead", "by": "Sara"}, {"body": "Status: Waiting", "event": True},
                                  {"body": "Is the wall switch on?", "by": "Ali", "staff": True}]}]

    api = TicketApi()
    assert OpenHelpRequestTool(api).run({"problem": "Bedroom fan is dead"}).startswith("Not sent yet")
    assert api.opened == []
    out = OpenHelpRequestTool(api).run({"problem": "Bedroom fan is dead", "confirmed": True})
    assert out.startswith("Sent as help request #7 (high priority)")
    assert api.opened == [{"body": "Bedroom fan is dead", "category": "fault"}]
    assert HelpRequestsTool(api).run({}) == "#7 Fan not working: Waiting for you; latest from Ali (support): Is the wall switch on?"


def test_plan_and_bills_in_words():
    from assistant.manage import BillsTool

    class BillApi(OwnerApi):
        def billing(self):
            return {"company": "Bright Homes", "due": 2500,
                    "contract": {"plan": "Care plan", "amount": 2500, "periodText": "a month", "visitsIncluded": 1, "status": "ACTIVE", "nextInvoiceOn": "2026-11-17"},
                    "invoices": [{"number": 4, "description": "Care plan, 17 Oct – 16 Nov 2026", "amount": 2500, "status": "DUE", "dueOn": "2026-10-27", "late": False},
                                 {"number": 3, "description": "Service visit", "amount": 1500, "status": "PAID", "paidOn": "2026-10-10"}]}

    out = BillsTool(BillApi()).run({})
    assert out.startswith("Plan with Bright Homes: Care plan, Rs 2,500 a month, 1 visit included each period, next bill on 2026-11-17.")
    assert "To pay: Rs 2,500 — invoice 4 Care plan, 17 Oct – 16 Nov 2026 Rs 2,500, due 2026-10-27." in out
    assert "Last paid: invoice 3 Rs 1,500 on 2026-10-10." in out

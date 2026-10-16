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

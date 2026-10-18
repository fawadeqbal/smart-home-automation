"""Fans with speeds and water tanks (firmware 2.6.0 devices) in the assistant's tools and home description."""
from assistant.tools import SetDeviceTool, describe_home

from conftest import FakeApi

FAN = {"id": "f1", "key": "ceiling_fan", "name": "Ceiling fan", "type": "fan", "controllable": True, "access": "CONTROL", "online": True,
       "roomName": "Bedroom", "speeds": 4, "state": {"on": True, "speed": 2}, "aliases": ["pankha"]}
TANK = {"id": "t1", "key": "roof_tank", "name": "Roof tank", "type": "tank", "controllable": False, "access": "VIEW", "online": True,
        "roomName": "Roof", "state": {"level": 18, "cm": 120, "alarm": "dry"},
        "stateFields": [{"key": "level", "label": "Level", "unit": "%"}]}


class SpeedApi(FakeApi):
    def command(self, device_id, command):
        self.commands.append((device_id, command))
        if "speed" in command:
            return {"state": {"on": True, "speed": command["speed"]}}
        return {"state": {"on": command.get("on", False), "speed": 2}}


def test_fan_speed_is_offered_and_sent():
    api = SpeedApi("t", [FAN])
    tool = SetDeviceTool(api, [FAN])
    assert "speed" in tool.parameters["properties"]
    assert "tez" in tool.description
    assert tool.run({"device": "pankha", "state": "on", "speed": 4}) == \
        "Ceiling fan in the Bedroom is now on at speed 4 (confirmed by the device)"
    assert api.commands[-1] == ("f1", {"speed": 4})
    assert tool.run({"device": "fan", "state": "on", "speed": 7}).startswith("Error: Ceiling fan has speeds 1 to 4")
    # off ignores a speed
    tool.run({"device": "fan", "state": "off", "speed": 3})
    assert api.commands[-1] == ("f1", {"on": False})


def test_no_speed_parameter_without_fans():
    bulb = {**FAN, "id": "b1", "key": "bulb", "name": "Bulb", "type": "switch", "speeds": None, "aliases": []}
    assert "speed" not in SetDeviceTool(FakeApi("t", [bulb]), [bulb]).parameters["properties"]


def test_home_description_knows_speed_and_tank_level():
    text = describe_home([FAN, TANK])
    assert "Ceiling fan (also called pankha): on at speed 2 of 4" in text
    assert "Roof tank: 18% full; the motor was stopped because the water wasn't rising" in text

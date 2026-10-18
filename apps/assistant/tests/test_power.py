"""The power tools: "when will the light go?" (load-shedding and UPS) and the bill from meter readings."""
from datetime import timezone

from assistant.home_api import HomeApiError
from assistant.manage import EnergyUsageTool, PowerOutlookTool, bill_text, home_facts, management_tools, power_text

from test_manage import OwnerApi

LEARNED = {
    "source": "learned", "windows": [{"from": "14:00", "to": "15:00", "seen": 9, "of": 14}],
    "learned": {"source": "learned", "observedDays": 14, "windows": [{"from": "14:00", "to": "15:00", "seen": 9, "of": 14}]},
    "next": {"text": "today around 2:00 pm"},
}


class PowerApi(OwnerApi):
    def __init__(self, power=None, shed=None, bill=None):
        super().__init__()
        self._power = power or {"grid": {"sensor": False, "off": False}, "next": {"text": "today around 2:00 pm"}, "source": "learned"}
        self._shed = shed if shed is not None else LEARNED
        self._bill = bill

    def power(self):
        self.calls.append("power")
        return self._power

    def shedding(self):
        return self._shed

    def bill(self):
        if self._bill is None:
            raise HomeApiError("Only the home's owner or an admin can do this.")
        return self._bill

    def energy(self, days=7):
        return {"days": days, "tariff": 60, "tariffSet": True, "total": {"kwh": 41.25, "cost": 2475}, "month": {"kwh": 177, "cost": 10610},
                "devices": [{"name": "Geyser", "hours": 14.5, "kwh": 29.0, "cost": 1740, "wattsSource": "set"}]}


def test_when_will_the_light_go_from_the_learned_pattern():
    out = PowerOutlookTool(PowerApi(), timezone.utc).run({})
    assert out.startswith("Next expected cut: today around 2:00 pm.")
    assert "Learned from the power cuts in the last 14 days: about 14:00–15:00, seen on 9 of 14 days" in out
    assert out.endswith("It's a pattern, not a promise.")


def test_a_typed_schedule_and_being_on_ups_now():
    api = PowerApi(
        power={"grid": {"sensor": True, "off": True, "sinceText": "2:03 pm", "switchedOff": ["AC"]}, "next": {"text": "tomorrow around 8:00 am"}},
        shed={"source": "typed", "windows": [{"from": "08:00", "to": "09:00", "days": [1, 3]}, {"from": "20:00", "to": "21:00"}], "learned": {}},
    )
    out = PowerOutlookTool(api).run({})
    assert out.startswith("The home is on UPS or solar now: the grid went at 2:03 pm. Switched off to save the battery: AC.")
    assert "Next expected cut: tomorrow around 8:00 am." in out
    assert "From the schedule the owner typed in (the area's SMS): 08:00–09:00 on Mon, Wed; 20:00–21:00 every day." in out


def test_no_pattern_yet_says_so_and_what_to_do():
    out = power_text({"grid": {}, "next": None}, {"source": "none", "windows": [], "learned": {}})
    assert "No regular load-shedding time is known" in out and "type the area's schedule" in out
    # the area's pattern, for a new home
    area = power_text({"grid": {}, "next": {"text": "today around 9:00 pm"}},
                      {"source": "area", "windows": [{"from": "21:00", "to": "22:00", "seen": 6, "of": 14}], "learned": {"place": "Swabi", "observedDays": 14}})
    assert "of other homes in Swabi" in area


def test_the_bill_in_words():
    b = {"source": "readings", "message": "You've used 162 units since the 1st. At this pace you'll reach 214 by the 1st — staying at 200 or below keeps the protected rate.",
         "cost": {"soFar": 9720, "projected": 12840}, "topDevices": [{"name": "AC", "kwh": 80.4}, {"name": "Geyser", "kwh": 30}], "lastMonth": 188}
    out = bill_text(b)
    assert out.startswith("You've used 162 units since the 1st.")
    assert "Bill so far about Rs 9,720, about Rs 12,840 by the billing day at this pace." in out
    assert "Most used (estimates): AC about 80 units, Geyser about 30 units." in out
    assert out.endswith("Last month: 188 units.")
    assert "estimate from the switches" in bill_text({**b, "source": "readings+estimate", "estimated": 20})
    assert bill_text({"source": "none"}).startswith("No meter readings yet")


def test_energy_usage_adds_the_bill_for_owners_only():
    owner = EnergyUsageTool(PowerApi(bill={"source": "readings", "message": "You've used 50 units since the 1st.", "cost": {"soFar": 3000, "projected": None}})).run({})
    assert "not a meter reading. Meter: You've used 50 units since the 1st. Bill so far about Rs 3,000." in owner
    member = EnergyUsageTool(PowerApi()).run({})
    assert "Meter:" not in member and member.endswith("not a meter reading.")


def test_the_tool_is_offered_and_the_home_summary_mentions_the_next_cut():
    api = PowerApi(power={"grid": {"off": True, "sinceText": "2:03 pm"}, "next": {"text": "today around 2:00 pm"}})
    assert "power_outlook" in {t.name for t in management_tools(api, api.devices())}
    facts = home_facts(api, api.devices())
    assert "ON UPS or solar now: the grid went at 2:03 pm." in facts
    assert "Next expected load-shedding: today around 2:00 pm" in facts

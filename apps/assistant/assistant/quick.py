"""Instant answers for everyday commands, without asking the AI model.

"turn off the bulb", "fan on for 10 minutes", "set a timer: bulb on in 1 minute", "bedroom light on at 7:30 pm",
"every day at 11 pm turn off the lights", "what's the temperature", "what's on", "cancel the timers",
"run good night" — in English and Roman Urdu ("batti band karo", "pankha 5 minute baad chala do").

These take milliseconds instead of seconds. Everything goes through the same tools (and so the same
rights checks) as the AI. Anything that isn't clearly one of these — a condition ("if", "when"), a
question about something else, words we don't understand — returns None and the AI handles it.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Callable, Dict, List, Optional, Sequence, Tuple

from .domain.models import ToolCall
from .home_api import HomeApi
from .tools import DAY_NAMES, ToolRegistry, _describe, _norm, _state_text

# ------------------------------------------------------------------ vocabulary
ON_WORDS = r"on|chala|chalao|chala do|chalado|chalaen|chalain|jala|jalao|jala do|jalado|roshan|start|kholo"
OFF_WORDS = r"off|band|bund|bujha|bujhao|bujha do|bujhado|stop|shut|shut down"
# words that change the meaning: leave those to the AI
HANDS_OFF = re.compile(r"\b(if|when|whenever|unless|until|agar|jab|jabke|don ?t|dont|do not|never|mat|nahi|nahin|not|except|but|why|how come|kyun|kyon)\b")
FILLER = set("""
please plz pls kindly can could would will you u kya kia app aap tum zara jaldi now right abhi foran turn switch put set make
the a an my our this that these those it its in of to for at and also bhi ka ki ke ko se mein me main par per
timer timers alarm reminder schedule light lights device devices karo kardo kar do de dein dena doen dijiye kijiye hojaye
ho jaye jaye jana hai hain ho raha rahi rahe please thanks thank shukriya ok okay hey hi hello assistant switchboard
minute minutes min mins hour hours hr hrs ghanta ghante ghantay second seconds sec secs after baad bad later in within
from today tonight tomorrow kal aaj subah shaam raat pm am baje bajay oclock o clock clock every daily roz rozana day night
morning evening is are was be been will should shall get go going turned
""".split())

# words for the same kind of device ("bulb" finds "Light 1"); plurals included
KINDS = [
    ("light", "lights", "bulb", "bulbs", "lamp", "lamps", "batti", "battiyan", "tube", "tubelight", "led"),
    ("fan", "fans", "pankha", "pankhe"),
    ("socket", "sockets", "plug", "plugs"),
    ("ac", "aircon", "air conditioner"),
    ("heater", "heaters"), ("geyser", "geysers"), ("tv", "television"), ("pump", "motor"),
]

NUM_WORDS = {"a": 1, "an": 1, "one": 1, "ek": 1, "two": 2, "three": 3, "teen": 3, "four": 4, "char": 4, "chaar": 4,
             "five": 5, "panch": 5, "paanch": 5, "ten": 10, "das": 10, "fifteen": 15, "pandrah": 15, "twenty": 20,
             "bees": 20, "thirty": 30, "tees": 30, "forty": 40, "fourty": 40, "fifty": 50, "sixty": 60,
             "half": 0.5, "half an": 0.5, "aadha": 0.5, "adha": 0.5, "aadhe": 0.5}
NUM = r"(\d+(?:\.\d+)?|half an|" + "|".join(sorted((re.escape(k) for k in NUM_WORDS if k != "half an"), key=len, reverse=True)) + r")"
UNIT = r"(seconds?|secs?|minutes?|mins?|minat|mint|hours?|hrs?|ghant[ae]y?|ghanta)"


def _num(word: str) -> float:
    return float(word) if re.match(r"^\d", word) else NUM_WORDS[word]


def _minutes(n: float, unit: str) -> float:
    if unit.startswith(("hour", "hr", "ghant")):
        return n * 60
    if unit.startswith("sec"):
        return n / 60
    return n


def _clock(h: int, m: int) -> str:
    suffix = "am" if h < 12 else "pm"
    h12 = h % 12 or 12
    return f"{h12}:{m:02d} {suffix}" if m else f"{h12} {suffix}"


def _and(items: Sequence[str]) -> str:
    items = list(items)
    return items[0] if len(items) == 1 else ", ".join(items[:-1]) + " and " + items[-1]


def _or(items: Sequence[str]) -> str:
    items = list(items)
    return items[0] if len(items) == 1 else ", ".join(items[:-1]) + " or " + items[-1]


def _clean_error(result: str) -> str:
    return result[len("Error: "):] if result.startswith("Error: ") else result


@dataclass
class When:
    kind: str                       # now | in | at | daily
    minutes: float = 0
    hour: int = 0
    minute: int = 0
    days: List[str] = field(default_factory=list)
    duration: float = 0             # "on for 10 minutes": then the opposite after this many minutes
    spans: List[Tuple[int, int]] = field(default_factory=list)


# ------------------------------------------------------------------ parsing
def parse_when(text: str) -> Optional[When]:
    """Finds the time part. Returns When(kind='now') when there is none; None when it can't be read."""
    spans: List[Tuple[int, int]] = []

    def take(m: re.Match) -> None:
        spans.append(m.span())

    # "for 10 minutes" -> on now, off later
    m = re.search(rf"\bfor\s+{NUM}\s*{UNIT}\b", text)
    if m:
        take(m)
        return When("now", duration=_minutes(_num(m.group(1)), m.group(2)), spans=spans)

    daily = re.search(r"\b(every ?day|every night|every morning|every evening|daily|roz(?:ana)?|har roz|har din)\b", text)
    days = [d for d in DAY_NAMES if re.search(rf"\b(every |on |har )?{d}s?\b", text)]
    weekdays = re.search(r"\b(weekdays|on weekdays)\b", text)
    weekend = re.search(r"\b(weekends?|on weekends?)\b", text)

    # clock time: 7:30 pm, 7 pm, 19:30, 7 baje, 7:30 baje raat
    clock = None
    for c in re.finditer(r"\b(?:at\s+)?(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.|baje|bajay|o ?clock)?(?:\s*(subah|morning|shaam|evening|raat|night|dopahar))?\b", text):
        h, mm, ampm, part = c.group(1), c.group(2), c.group(3), c.group(4)
        # a bare number is not a time ("in 5 minutes"): need ':MM', am/pm/baje, or "at"
        if not (mm or ampm or part or c.group(0).startswith("at")):
            continue
        after = text[c.end():c.end() + 12]
        if re.match(rf"\s*{UNIT}\b", after):
            continue
        hour, minute = int(h), int(mm or 0)
        if hour > 23 or minute > 59:
            return None
        tag = (ampm or "") + " " + (part or "")
        if re.search(r"pm|p\.m\.|shaam|evening|raat|night", tag) and hour < 12:
            hour += 12
        if re.search(r"dopahar", tag) and hour < 6:
            hour += 12
        if re.search(r"am|a\.m\.|subah|morning", tag) and hour == 12:
            hour = 0
        if re.search(r"raat|night", tag) and hour == 24:
            hour = 0
        clock = (hour, minute)
        take(c)
        break

    if daily or days or weekdays or weekend:
        if not clock:
            return None
        if daily:
            take(daily)
        chosen = days or ([] if not (weekdays or weekend) else
                          (DAY_NAMES[1:6] if weekdays else [DAY_NAMES[0], DAY_NAMES[6]]))
        return When("daily", hour=clock[0], minute=clock[1], days=chosen, spans=spans)

    # "in 5 minutes", "after 1 minute", "5 minute baad", "1 min later", "timer 2 minutes"
    m = (re.search(rf"\b(?:in|after|within|timer(?: of| for)?)\s+{NUM}\s*{UNIT}\b", text)
         or re.search(rf"\b{NUM}\s*{UNIT}\s+(?:baad|bad|later|ke baad|k baad|after|from now|mein|me)\b", text)
         or re.search(rf"\b{NUM}\s*{UNIT}\b", text))
    if m:
        take(m)
        return When("in", minutes=_minutes(_num(m.group(1)), m.group(2)), spans=spans)
    if clock:
        return When("at", hour=clock[0], minute=clock[1], spans=spans)
    return When("now", spans=spans)


def parse_state(text: str) -> Optional[str]:
    on = re.search(rf"\b({ON_WORDS})\b", text)
    off = re.search(rf"\b({OFF_WORDS})\b", text)
    if on and off:
        return None
    return "on" if on else "off" if off else None


# ------------------------------------------------------------------ the handler
class QuickCommands:
    def __init__(self, api: Optional[HomeApi], devices: List[dict], tools: ToolRegistry,
                 clock: Callable[[], datetime] = lambda: datetime.now().astimezone()) -> None:
        self._api = api
        self._devices = devices
        self._switches = [d for d in devices if d.get("controllable") and d.get("access") in ("CONTROL", "MANAGE")]
        self._tools = tools
        self._clock = clock
        self._scenes: Optional[List[dict]] = None

    # -------------------------------------------------------------- entry
    def handle(self, raw: str) -> Optional[str]:
        text = " " + re.sub(r"[^a-z0-9:.\s]", " ", raw.lower().replace("’", "'").replace("'", "")) + " "
        text = re.sub(r"(?<=\D)\.|\.(?=\D)", " ", text)            # keep 7.30, drop sentence dots
        text = re.sub(r"\s+", " ", text).strip()
        if not text or len(text) > 160 or HANDS_OFF.search(text):
            return None
        for intent in (self._cancel, self._list_timers, self._climate, self._status, self._scene):
            reply = intent(text)
            if reply is not None:
                return reply
        # "turn off the bulb and turn on the fan"
        parts = [p.strip() for p in re.split(r"\b(?:and then|and|aur|phir|then)\b|,", text) if p.strip()]
        if len(parts) > 1:
            # understand every part first; act only if all of them are plain commands
            plans = [self._plan(p, strict=True) for p in parts]
            if all(plans):
                questions = [p for p in plans if isinstance(p, str)]
                if questions:
                    return questions[0]
                return " ".join(self._run(p) for p in plans)  # type: ignore[arg-type]
        plan = self._plan(text)
        if plan is None or isinstance(plan, str):
            return plan
        return self._run(plan)

    # -------------------------------------------------------------- switching (now or later)
    def _match_devices(self, text: str) -> Tuple[List[dict], List[Tuple[int, int]]]:
        """Devices named in the text: the longest name wins; a room name narrows it down."""
        if re.search(r"\b(everything|all devices|sab ?kuch|sab kuchh|har cheez|sari cheezen)\b", text):
            m = re.search(r"\b(everything|all devices|sab ?kuchh?|har cheez|sari cheezen)\b", text)
            return list(self._switches), [m.span()]
        all_lights = re.search(r"\b(all|sab|sari|saari|tamam) (?:the )?(lights?|lamps?|bulbs?|battiy?an|batti)\b", text)
        if all_lights:
            lights = [d for d in self._switches if any(w in _norm(" ".join([d["name"], *d.get("aliases", [])]))
                                                       for w in ("light", "lamp", "bulb", "batti", "tube", "led"))]
            return lights, [all_lights.span()]
        scored: List[Tuple[int, dict, Tuple[int, int]]] = []
        for d in self._switches:
            best = None
            for name in {_norm(n) for n in [d["name"], d["key"], *d.get("aliases", [])] if n}:
                m = re.search(rf"\b{re.escape(name)}s?\b", text)
                if m and (best is None or len(name) > best[0]):
                    best = (len(name), m.span())
            if best:
                room = _norm(d.get("roomName") or "")
                bonus = 100 if room and re.search(rf"\b{re.escape(room)}\b", text) else 0
                scored.append((best[0] + bonus, d, best[1]))
        if not scored:
            # "the bulb" said, "Light 1" named: words for the same kind of thing count as one
            for group in KINDS:
                said = re.search(rf"\b({'|'.join(group)})\b", text)
                if not said:
                    continue
                found = [d for d in self._switches
                         if re.search(rf"\b({'|'.join(group)})\b", _norm(" ".join([d["name"], *d.get("aliases", [])])))]
                room_hits = [d for d in found if d.get("roomName") and re.search(rf"\b{re.escape(_norm(d['roomName']))}\b", text)]
                found = room_hits or found
                if found:
                    return found, [said.span()]
            return [], []
        top = max(s for s, _, _ in scored)
        best = [(d, span) for s, d, span in scored if s == top]
        spans = [span for _, span in best]
        for d, _ in best:
            room = _norm(d.get("roomName") or "")
            if room:
                m = re.search(rf"\b{re.escape(room)}\b", text)
                if m and top >= 100:
                    spans.append(m.span())
        return [d for d, _ in best], spans

    def _leftover(self, text: str, spans: List[Tuple[int, int]], extra: Sequence[str] = ()) -> List[str]:
        """Words we did not understand. Many of them -> this isn't a plain command; let the AI read it."""
        chars = list(text)
        for a, b in spans:
            for i in range(a, b):
                chars[i] = " "
        rest = "".join(chars)
        rest = re.sub(rf"\b({ON_WORDS}|{OFF_WORDS})\b", " ", rest)
        words = [w for w in rest.split() if w not in FILLER and w not in extra and not re.match(r"^\d+([:.]\d+)?$", w)]
        return words

    def _plan(self, text: str, strict: bool = False):
        """(state, when, devices) for a plain switching command; a question when it's ambiguous; else None."""
        state = parse_state(re.sub(rf"\bon (?:{'|'.join(DAY_NAMES)})s?\b|\bon (?:weekdays|weekends?)\b", " ", text))
        if state is None:
            return None
        when = parse_when(text)
        if when is None:
            return None
        targets, spans = self._match_devices(text)
        if not targets:
            return None
        rooms = {w for d in self._devices for w in _norm(d.get("roomName") or "").split()}
        leftover = self._leftover(text, spans + when.spans, extra=rooms)
        if len(leftover) > (0 if strict else 2):
            return None
        plural = re.search(r"\b(all|sab|everything|sari|saari|tamam|har|lights|lamps|bulbs|fans|battiyan|pankhe)\b", text)
        if len(targets) > 1 and not plural:
            return "Which one do you mean: " + _or([f"the {_describe(d)}" for d in targets]) + "?"
        return (state, when, targets)

    def _run(self, plan) -> str:
        state, when, targets = plan
        if when.kind == "now":
            done, errors = [], []
            for d in targets:
                result = self._tools.execute(ToolCall("q", "set_device", {"device": self._name_for(d), "state": state}))
                (errors if result.startswith("Error") else done).append((d, result))
            reply = self._switch_reply(done, errors, state)
            if when.duration and done:
                later = "off" if state == "on" else "on"
                for d, _ in done:
                    self._schedule(d, later, When("in", minutes=when.duration))
                reply += f" It turns {later} again in {self._duration(when.duration)}."
            return reply
        return " ".join(self._schedule(d, state, when) for d in targets)

    def _name_for(self, d: dict) -> str:
        """A name the tool resolves to exactly this device (adds the room when names repeat)."""
        same = [x for x in self._switches if _norm(x["name"]) == _norm(d["name"])]
        return f"{d.get('roomName')} {d['name']}" if len(same) > 1 and d.get("roomName") else d["name"]

    def _switch_reply(self, done, errors, state: str) -> str:
        parts = []
        if done:
            names = [_describe(d) for d, _ in done]
            parts.append(f"Done, {'the ' if len(names) == 1 else ''}{_and(names) if len(names) < 4 else f'{len(names)} devices'} {'is' if len(names) == 1 else 'are'} {state}.")
        for d, result in errors:
            parts.append(_clean_error(result))
        return " ".join(parts) or "Nothing to switch."

    @staticmethod
    def _duration(minutes: float) -> str:
        if minutes >= 60 and minutes % 60 == 0:
            h = int(minutes // 60)
            return f"{h} hour{'s' if h != 1 else ''}"
        if minutes >= 60:
            return f"{int(minutes // 60)} hour{'s' if minutes >= 120 else ''} {int(minutes % 60)} minutes"
        m = int(round(minutes))
        return f"{m} minute{'s' if m != 1 else ''}"

    def _schedule(self, d: dict, state: str, when: When) -> str:
        args: Dict[str, object] = {"device": self._name_for(d), "state": state}
        rounded = False
        if when.kind == "in":
            minutes = when.minutes
            if minutes < 1:
                minutes, rounded = 1, True
            args["in_minutes"] = round(minutes, 2)
        elif when.kind == "at":
            args["at_time"] = f"{when.hour:02d}:{when.minute:02d}"
        else:
            args.update({"repeat_daily": True, "at_time": f"{when.hour:02d}:{when.minute:02d}", "days": when.days})
        result = self._tools.execute(ToolCall("q", "schedule_device", args))
        if result.startswith("Error"):
            return _clean_error(result)
        now = self._clock()
        if when.kind == "in":
            at = now + timedelta(minutes=float(args["in_minutes"]))  # type: ignore[arg-type]
            short = " (timers start at one minute)" if rounded else ""
            return f"OK, the {_describe(d)} turns {state} in {self._duration(float(args['in_minutes']))}, at {_clock(at.hour, at.minute)}{short}."  # type: ignore[arg-type]
        if when.kind == "at":
            today = now.replace(hour=when.hour, minute=when.minute, second=0, microsecond=0)
            day = "today" if today > now else "tomorrow"
            return f"OK, the {_describe(d)} turns {state} at {_clock(when.hour, when.minute)} {day}."
        on_days = "every day" if not when.days or len(when.days) == 7 else "every " + _and([x.capitalize() for x in when.days])
        return f"OK, {on_days} at {_clock(when.hour, when.minute)} the {_describe(d)} turns {state}."

    # -------------------------------------------------------------- timers
    def _list_timers(self, text: str) -> Optional[str]:
        if not re.search(r"\b(timers?|schedules?|alarms?)\b", text) or parse_state(text):
            return None
        if not re.search(r"\b(what|which|list|show|any|kaun|kon|konse|kaunse|kya|tell|set|are there|hain)\b", text):
            return None
        return self._tools.execute(ToolCall("q", "list_schedules", {})).replace("; ", ". ").rstrip(".") + "."

    def _cancel(self, text: str) -> Optional[str]:
        if not re.search(r"\b(cancel|remove|delete|clear|hatao|hata do|khatam|stop)\b", text):
            return None
        if not re.search(r"\b(timers?|schedules?|alarms?)\b", text):
            return None
        if self._api is None:
            return None
        rows = [s for s in self._api.schedules() if s.get("enabled")]
        if not rows:
            return "There are no timers to cancel."
        if re.search(r"\b(all|every|sab|saare|sare|tamam)\b", text):
            for s in rows:
                self._api.delete_schedule(s["id"])
            return f"Cancelled all {len(rows)} timers and schedules." if len(rows) > 1 else "Cancelled the timer."
        targets, _ = self._match_devices(text)
        if targets:
            ids = {d["id"] for d in targets}
            picked = [s for s in rows if any(a.get("deviceId") in ids for a in s.get("actions", []))]
        else:
            picked = rows if len(rows) == 1 else []
        if not picked:
            return "Which timer? " + self._tools.execute(ToolCall("q", "list_schedules", {}))
        if len(picked) > 1:
            return "That matches several timers. " + self._tools.execute(ToolCall("q", "list_schedules", {})) + " Which number?"
        result = self._tools.execute(ToolCall("q", "cancel_schedule", {"which": str(rows.index(picked[0]) + 1)}))
        return _clean_error(result)

    # -------------------------------------------------------------- sensors and states
    def _climate(self, text: str) -> Optional[str]:
        if not re.search(r"\b(temperature|temp|hot|cold|warm|garmi|sardi|thand|thandi|humidity|humid|nami|darja|degrees?|weather inside)\b", text):
            return None
        sensors = [d for d in self._devices if not d.get("controllable") and any(
            f["key"] in ("temperature", "humidity") for f in d.get("stateFields", []))]
        if not sensors:
            return "There is no temperature sensor in your rooms yet."
        rooms = [d for d in sensors if d.get("roomName") and re.search(rf"\b{re.escape(_norm(d['roomName']))}\b", text)]
        parts = []
        for d in rooms or sensors:
            s = d.get("state") or {}
            where = f"in the {d['roomName']}" if d.get("roomName") else f"at the {d['name']}"
            if not d.get("online"):
                parts.append(f"The sensor {where} is offline")
            elif "temperature" in s:
                hum = f" with {s['humidity']:g} percent humidity" if isinstance(s.get("humidity"), (int, float)) else ""
                parts.append(f"It's {s['temperature']:g} degrees {where}{hum}")
            elif "humidity" in s:
                parts.append(f"Humidity is {s['humidity']:g} percent {where}")
        return ". ".join(parts) + "." if parts else "The sensors haven't sent a reading yet."

    def _status(self, text: str) -> Optional[str]:
        asks_all = re.search(r"\b(whats on|what is on|what s on|which (?:lights?|devices?|things?) (?:are|is) on|anything on|kya kya on|kaun ?sa on|kon ?sa on|konsi on|kaunsi on|kya on hai|status|what is running|whats running)\b", text)
        if asks_all:
            on = [d for d in self._devices if d.get("controllable") and d.get("online") and (d.get("state") or {}).get("on")]
            off_line = [d for d in self._devices if not d.get("online")]
            reply = ("On right now: " + _and([f"the {_describe(d)}" for d in on]) + ".") if on else "Everything is off."
            if off_line:
                reply += " Offline: " + _and([_describe(d) for d in off_line]) + "."
            return reply
        # "is the bulb on?" / "kya batti on hai?"
        if re.match(r"^(is|are|kya)\b", text) and re.search(r"\b(on|off|band|chal rah[ai]|jal rah[ai])\b", text):
            for d in sorted(self._devices, key=lambda x: -len(x["name"])):
                if any(re.search(rf"\b{re.escape(_norm(n))}s?\b", text) for n in [d["name"], *d.get("aliases", [])] if n):
                    return f"The {_describe(d)} is {_state_text(d)}."
        return None

    # -------------------------------------------------------------- scenes
    def _scene(self, text: str) -> Optional[str]:
        if self._api is None:
            return None
        if self._scenes is None:
            tool = self._tools.get("run_scene")             # build_tools already fetched them: no second request
            if tool is not None:
                self._scenes = list(getattr(tool, "_scenes", []))
            else:
                try:
                    self._scenes = [s for s in self._api.scenes() if s.get("canRun")]
                except Exception:  # noqa: BLE001 - no scenes is fine
                    self._scenes = []
        for s in sorted(self._scenes, key=lambda x: -len(x["name"])):
            name = _norm(s["name"])
            m = re.search(rf"\b{re.escape(name)}\b", text)
            if not m:
                continue
            rest = self._leftover(text, [m.span()], extra=("run", "start", "activate", "scene", "mode", "chalao", "lagao", "kar", "do"))
            if len(rest) <= 1:
                result = self._tools.execute(ToolCall("q", "run_scene", {"scene": s["name"]}))
                return _clean_error(result).replace("Scene ", "Done, scene ", 1)
        return None


def summarize_actions(results: Sequence[Tuple[str, str]]) -> Optional[str]:
    """A spoken reply straight from successful action results, so the AI needn't be asked again."""
    lines = []
    for name, result in results:
        if result.startswith("Error"):
            return None
        if name == "set_device":
            m = re.match(r"^(.*) is now (on|off)", result)
            lines.append(f"Done, the {m.group(1)} is {m.group(2)}." if m else result)
        elif name == "schedule_device":
            lines.append("OK. " + result.replace("Scheduled (saved on the home server): ", "Set: ", 1))
        elif name in ("cancel_schedule", "run_scene"):
            lines.append(result)
        else:
            return None
    return " ".join(lines) if lines else None


__all__ = ["QuickCommands", "parse_when", "parse_state", "summarize_actions"]

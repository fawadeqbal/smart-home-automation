"""English words inside an Urdu reply, written the way an Urdu voice can say them.

Replies in Urdu script often carry English device and room names ("Bedroom کا Fan آن ہے"). The Urdu
voice reads Latin letters badly, so before speaking each English word becomes Urdu script: from a
list of the words homes use, as letters for short abbreviations ("AC" -> "اے سی"), else by sound.
Only for speech: the written reply keeps the names as the person typed them.
"""
from __future__ import annotations

import re

WORDS = {
    # devices
    "bulb": "بلب", "bulbs": "بلب", "light": "لائٹ", "lights": "لائٹس", "lamp": "لیمپ", "tube": "ٹیوب", "tubelight": "ٹیوب لائٹ",
    "fan": "فین", "fans": "فین", "exhaust": "ایگزاسٹ", "geyser": "گیزر", "motor": "موٹر", "pump": "پمپ", "socket": "ساکٹ",
    "plug": "پلگ", "switch": "سوئچ", "switches": "سوئچز", "board": "بورڈ", "boards": "بورڈز", "heater": "ہیٹر", "iron": "استری",
    "cooler": "کولر", "fridge": "فریج", "freezer": "فریزر", "oven": "اوون", "microwave": "مائیکرو ویو", "kettle": "کیتلی",
    "sensor": "سینسر", "sensors": "سینسرز", "router": "راؤٹر", "inverter": "انورٹر", "ups": "یو پی ایس", "charger": "چارجر",
    "chandelier": "فانوس", "spotlight": "سپاٹ لائٹ", "spot": "سپاٹ", "led": "ایل ای ڈی", "strip": "سٹرپ", "camera": "کیمرہ",
    # rooms and places
    "room": "روم", "rooms": "رومز", "bedroom": "بیڈروم", "kitchen": "کچن", "lounge": "لاؤنج", "drawing": "ڈرائنگ",
    "dining": "ڈائننگ", "living": "لِونگ", "bathroom": "باتھ روم", "washroom": "واش روم", "garage": "گیراج", "gate": "گیٹ",
    "porch": "پورچ", "garden": "گارڈن", "lawn": "لان", "roof": "چھت", "store": "سٹور", "office": "آفس", "study": "سٹڈی",
    "hall": "ہال", "corridor": "کوریڈور", "stairs": "سیڑھیاں", "balcony": "بالکونی", "terrace": "ٹیرس", "basement": "بیسمنٹ",
    "master": "ماسٹر", "guest": "گیسٹ", "kids": "کڈز", "main": "مین", "front": "فرنٹ", "back": "بیک", "upstairs": "اوپر",
    "downstairs": "نیچے", "door": "ڈور", "window": "ونڈو", "tank": "ٹینک", "water": "واٹر",
    # app words
    "on": "آن", "off": "آف", "wifi": "وائی فائی", "internet": "انٹرنیٹ", "app": "ایپ", "scene": "سین", "scenes": "سینز",
    "timer": "ٹائمر", "timers": "ٹائمرز", "schedule": "شیڈول", "rule": "رول", "rules": "رولز", "away": "اوے", "mode": "موڈ",
    "good": "گڈ", "night": "نائٹ", "morning": "مارننگ", "minute": "منٹ", "minutes": "منٹ", "hour": "گھنٹہ", "hours": "گھنٹے",
    "temperature": "ٹمپریچر", "humidity": "ہیومیڈیٹی", "motion": "موشن", "leak": "لیک", "online": "آن لائن", "offline": "آف لائن",
    "switchboard": "سوئچ بورڈ", "ok": "اوکے", "okay": "اوکے", "installer": "انسٹالر", "units": "یونٹ", "unit": "یونٹ", "rs": "روپے",
    "help": "ہیلپ", "request": "ریکویسٹ", "ticket": "ٹکٹ", "battery": "بیٹری", "power": "پاور", "level": "لیول",
}

LETTERS = {
    "a": "اے", "b": "بی", "c": "سی", "d": "ڈی", "e": "ای", "f": "ایف", "g": "جی", "h": "ایچ", "i": "آئی", "j": "جے", "k": "کے",
    "l": "ایل", "m": "ایم", "n": "این", "o": "او", "p": "پی", "q": "کیو", "r": "آر", "s": "ایس", "t": "ٹی", "u": "یو", "v": "وی",
    "w": "ڈبلیو", "x": "ایکس", "y": "وائی", "z": "زیڈ",
}

# by sound: longest spellings first
SOUNDS = [
    ("tion", "شن"), ("ight", "ائٹ"), ("ough", "او"), ("sh", "ش"), ("ch", "چ"), ("th", "تھ"), ("ph", "ف"), ("kh", "خ"), ("gh", "غ"),
    ("ck", "ک"), ("ng", "نگ"), ("oo", "و"), ("ee", "ی"), ("ea", "ی"), ("ai", "ے"), ("ay", "ے"), ("ou", "او"), ("ow", "او"),
    ("oa", "و"), ("ie", "ی"), ("ey", "ے"), ("qu", "کو"),
    ("b", "ب"), ("c", "ک"), ("d", "ڈ"), ("f", "ف"), ("g", "گ"), ("h", "ہ"), ("j", "ج"), ("k", "ک"), ("l", "ل"), ("m", "م"),
    ("n", "ن"), ("p", "پ"), ("q", "ک"), ("r", "ر"), ("s", "س"), ("t", "ٹ"), ("v", "و"), ("w", "و"), ("x", "کس"), ("y", "ی"), ("z", "ز"),
    ("a", "ا"), ("e", "ے"), ("i", "ی"), ("o", "و"), ("u", "ا"),
]
FIRST_VOWEL = {"a": "ا", "e": "ای", "i": "ا", "o": "او", "u": "ا"}

URDU = re.compile(r"[؀-ۿ]")
LATIN_WORD = re.compile(r"[A-Za-z]+")


def by_sound(word: str) -> str:
    w = word.lower()
    out = []
    i = 0
    if w[0] in FIRST_VOWEL:
        out.append(FIRST_VOWEL[w[0]])
        i = 1
    while i < len(w):
        for spelling, urdu in SOUNDS:
            if w.startswith(spelling, i):
                # an "e" at the end is silent ("gate", "home")
                if spelling == "e" and i == len(w) - 1 and len(w) > 2:
                    urdu = ""
                out.append(urdu)
                i += len(spelling)
                break
        else:
            i += 1
    return "".join(out)


def urdu_word(word: str) -> str:
    low = word.lower()
    if low in WORDS:
        return WORDS[low]
    if word.isupper() and len(word) <= 4 or not re.search(r"[aeiouy]", low):
        return " ".join(LETTERS.get(c, c) for c in low)    # AC, TV, UPS, LG
    return by_sound(word)


def for_urdu_voice(text: str) -> str:
    """English words in an Urdu-script reply, in Urdu script (text without Urdu script is left alone)."""
    if not URDU.search(text):
        return text
    return LATIN_WORD.sub(lambda m: urdu_word(m.group(0)), text)

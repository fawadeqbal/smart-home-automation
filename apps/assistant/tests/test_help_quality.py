"""Search quality on the real starter articles (apps/api/help): questions as customers ask them, in
English and Roman Urdu. Keywords only here (CI doesn't download the embedding model); on the server the
meaning model adds Urdu script and unusual phrasings (measured: 39/41 in the top three)."""
import pathlib
import re

import pytest

from assistant.knowledge import Index

HELP = pathlib.Path(__file__).resolve().parents[2] / "api" / "help"


def _article(path: pathlib.Path) -> dict:
    text = path.read_text(encoding="utf-8")
    m = re.match(r"^---\n(.*?)\n---\n(.*)$", text, re.S)
    meta = dict(line.split(":", 1) for line in m.group(1).splitlines() if ":" in line)
    tags = [t.strip().strip("\"'") for t in meta.get("tags", "").strip().strip("[]").split(",") if t.strip()]
    return {"id": str(path.relative_to(HELP))[:-3], "title": meta["title"].strip().strip("\"'"),
            "category": meta["category"].strip().upper(), "audience": meta.get("audience", "everyone").strip().upper(),
            "tags": tags, "body": m.group(2)}


ARTICLES = [_article(p) for p in sorted(HELP.rglob("*.md")) if p.name != "REVIEW.md"] if HELP.exists() else []

QUESTIONS = [  # (question, expected slug)
 ("my board is offline", "troubleshooting/board-offline"),
 ("meri board offline hai kya karun", "troubleshooting/board-offline"),
 ("bijli gayi thi ab kuch nahi chal raha", "troubleshooting/power-cut-load-shedding"),
 ("load shedding ke baad lights on ho gayi", "troubleshooting/power-cut-load-shedding"),
 ("I changed my wifi password", "troubleshooting/wifi-changed-or-new-router"),
 ("naya router lagaya hai", "troubleshooting/wifi-changed-or-new-router"),
 ("how do I add my wife", "usage/invite-family-and-guests"),
 ("bachon ko access kaise doon", "usage/invite-family-and-guests"),
 ("remove my driver from the app", "usage/roles-access-and-removing-people"),
 ("how long is the warranty", "policy/warranty"),
 ("guarantee kitni hai", "policy/warranty"),
 ("وارنٹی کتنی ہے", "policy/warranty"),
 ("how much does a service visit cost", "policy/service-visits-and-charges"),
 ("refund milega?", "policy/cancellations-and-refunds"),
 ("do you record my voice", "policy/privacy-and-data"),
 ("forgot my password", "troubleshooting/cant-sign-in"),
 ("too many tries can't log in", "troubleshooting/cant-sign-in"),
 ("set the fan to turn off after 30 minutes", "usage/timers-and-schedules"),
 ("roz raat 11 baje batti band ho jaye", "usage/timers-and-schedules"),
 ("make a good night scene", "usage/scenes"),
 ("the assistant doesn't hear me", "troubleshooting/assistant-cant-hear-me"),
 ("mic kaam nahi kar raha", "troubleshooting/assistant-cant-hear-me"),
 ("hey switchboard background listening battery", "usage/hey-switchboard-hands-free"),
 ("the switch on the wall doesn't work", "troubleshooting/wall-switch-not-working"),
 ("temperature sensor shows nothing", "troubleshooting/sensor-no-reading"),
 ("can it change AC temperature", "faq/on-off-only"),
 ("pankha tez karo", "faq/on-off-only"),
 ("does it work without internet", "faq/internet-down"),
 ("internet band ho to kya hoga", "faq/internet-down"),
 ("is it safe, can hackers control my home", "faq/security"),
 ("how many devices on one board", "faq/devices-per-board"),
 ("who turned on the geyser", "usage/activity-and-history"),
 ("notifications not coming on my phone", "troubleshooting/notifications-not-arriving"),
 ("invite link expired", "troubleshooting/invite-link-not-working"),
 ("install the app on android", "usage/install-the-app"),
 ("support timings kya hain", "policy/support-hours-and-response-times"),
 ("how do I contact my installer", "process/get-help"),
 ("book a visit for installation", "process/book-a-free-visit"),
 # staff
 ("adopt a new board from stock", "process/board-stock-assign-install"),
 ("board kharab ho gaya replace karna hai", "process/faulty-board-replace"),
 ("firmware update failed on the board", "troubleshooting/firmware-update-failed"),
]


@pytest.mark.skipif(not ARTICLES, reason="no starter articles")
def test_every_starter_article_parses_and_says_who_it_is_for():
    assert len(ARTICLES) >= 40
    for a in ARTICLES:
        assert a["title"] and a["body"].strip(), a["id"]
        assert a["category"] in {"USAGE", "TROUBLESHOOTING", "PROCESS", "POLICY", "FAQ"}, a["id"]
        assert a["audience"] in {"EVERYONE", "STAFF"}, a["id"]


@pytest.mark.skipif(not ARTICLES, reason="no starter articles")
def test_customers_questions_find_the_right_article():
    index = Index(ARTICLES, embed=None)
    found = 0
    misses = []
    for question, want in QUESTIONS:
        got = []
        for h in index.search(question, limit=6):
            if h.chunk.article_id not in got:
                got.append(h.chunk.article_id)
        if want in got[:3]:
            found += 1
        else:
            misses.append((question, want, got[:3]))
    # 36/41 when measured; a drop means an edit made search worse
    assert found >= 34, misses

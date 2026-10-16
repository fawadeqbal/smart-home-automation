"""Keeps the assistant on its job: this person's Switchboard home (or, in the console, the company's
boards) and the company's Help Center. Decided before the AI is asked, without the AI:

  * greet     "hi", "thanks", "salam": a friendly fixed reply, instantly
  * decline   clearly not about the home, the product or the company ("who won the match", "write a
              poem"): a polite fixed reply that says what it can do
  * no_info   prices, warranty, refunds, charges... with no published article that covers them: "I don't
              have that information", never a guessed figure or promise
  * agent     everything else goes to the AI, with the matching Help Center excerpts and strict rules

The guard only declines when it is sure: a follow-up in a conversation ("where?", "why?"), anything that
names a device, room, scene, board or home of this person, product words, and anything the Help Center
matches by its words all go to the AI. Urdu script always goes to the AI (the search matches it by
meaning, which is too loose to decline on), and the AI's own instructions decline the rest.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Iterable, Optional, Sequence, Set

from langchain_core.documents import Document

from .knowledge import STOP
from .speech.tts import is_urdu_script

GREET, DECLINE, NO_INFO, AGENT = "greet", "decline", "no_info", "agent"

# words of the product and of a home (English, Roman Urdu); the person's own device, room, scene, board
# and home names come from the home's state on top of these
PRODUCT = set("""
switchboard switchboards board boards app apps device devices light lights bulb bulbs lamp lamps tube fan fans
ac aircon socket sockets plug plugs switch switches switched button buttons room rooms scene scenes timer timers
schedule schedules scheduled automation automations wifi router routers internet network signal offline online
connected connection connections disconnect disconnected sensor sensors temperature humidity hot cold door doors
window windows motion leak smoke installer installers installation install installed technician visit visits
service support expert warranty guarantee refund refunds price prices cost costs charge charges fee fees payment
bill account password login signin invite invites family member members guest guests owner admin
notification notifications alert alerts voice assistant mic microphone setup hotspot flash
firmware reset restart power electricity bijli loadshedding shedding ups inverter generator
batti battiyan pankha pankhay geyser tv television ghar kamra kamre chalao chalana
energy activity android iphone heater cooler pump motor garmi sardi readings offline
homes customer customers installer jobs fleet isp ptcl dropped drops stable
wife husband kids kid children child son daughter brother sister mother father mom dad parents maid driver
servant naukar biwi bachay bachon bacha beta beti ammi abbu bhai behan tenant tenants
remember forget yaad summary report week weekly whatsapp ticket tickets request requests repair technician mistri electrician
units unit kwh bill bills usage consumption watts wapda lesco iesco kesco pesco mepco fesco
rule rules away vacation lock locked childlock sunset sunrise maghrib gate porch geyser iron safety
slow slowly fast delay late respond responding response camera cameras cctv lost stolen hack hacked safe secure
security privacy private data
rename renamed delete deleted remove removed create move moved people person user users role roles access
permission permissions manage summary overview count rooms
cut cuts outage outages blackout shedding wapda kesc lesco iesco pesco mepco gepco fesco hesco
""".split())

# money and promises: never answered without a published article that covers them
POLICY = re.compile(
    r"\b(price|prices|pricing|cost|costs|charge[sd]?|fee|fees|pay|paid|payment|rupees?|rs|pkr|paise|paisay|paisa|"
    r"qeemat|kharcha|warrant(y|ies)|guarantee|refund(s|ed)?|money back|discount|contract|penalt(y|ies))\b", re.I)
POLICY_URDU = re.compile(r"(قیمت|پیسے|وارنٹی|گارنٹی|ریفنڈ|خرچ|فیس)")

GREETING = re.compile(
    r"^\W*(hi|hii+|hello|hey|hiya|salam|salaam|slam|aoa|a\.?o\.?a|assalam\w*(\s+o)?\s*alaikum|as-salamu alaykum|"
    r"good (morning|afternoon|evening))(\s+(there|switchboard|assistant|bhai|jee|ji)){0,2}\W*$", re.I)
THANKS = re.compile(r"^\W*(thanks|thank you|thank u|thx|ty|shukriya|shukria|jazak\w*|great|nice|perfect|ok thanks)"
                    r"(\s+(a lot|so much|bhai|jee|ji|you)){0,2}\W*$", re.I)
# "what can you do?", "help": what the assistant is for
ABOUT_ME = re.compile(r"^\W*(what can you do( for me)?|what do you do|who are you|what are you|help( me)?|i need help|"
                      r"how can you help( me)?|madad|madad karo|aap kya kar sakte ho|tum kya kar sakte ho|menu|options)\W*$", re.I)
URDU_GREETING = re.compile(r"^\W*(السلام علیکم|سلام|شکریہ)\W*$")

# a few words that only Roman Urdu uses: the fixed replies answer in the person's language
ROMAN_URDU = set("""
hai hain kya kia karo kardo kar raha rahi rahe nahi nahin mujhe aap kaise kese kyun kyon kab kahan batti pankha
chalao chala band yeh woh theek acha accha shukriya shukria salam salaam bhai gaya gayi hua hui kitna kitne
kaun kon kaisa kaisi mera meri mere hamara hamari karna karein batao bataen sakta sakti
""".split())

WORD = re.compile(r"[a-z0-9]+", re.I)


@dataclass(frozen=True)
class Decision:
    route: str
    reason: str


def words(text: str) -> list:
    return [w.lower() for w in WORD.findall(text)]


def language(text: str) -> str:
    """'ur' (Urdu script), 'roman' (Roman Urdu) or 'en'."""
    if is_urdu_script(text):
        return "ur"
    ws = set(words(text))
    urdu = len(ws & ROMAN_URDU)
    english = len(ws & {"the", "is", "are", "what", "how", "my", "please", "can", "why", "where"})
    return "roman" if urdu >= 2 or (urdu == 1 and english == 0) else "en"


# everyday words that also appear in names ("Good night", "Main gate", "Movie time"): a name alone
# doesn't make "a good time" a question about the home
GENERIC = set("""
good night day morning evening time times main new old big small front back side top up down left right one two
first second third called off all room home house light lights my our your their best great nice set
help phone question questions thing things need want know make give tell
""".split())


def vocabulary(*texts: str) -> Set[str]:
    """The distinctive words of this home's names (devices, rooms, scenes, boards, homes, cities)."""
    out: Set[str] = set()
    for t in texts:
        out.update(w for w in words(t) if len(w) >= 3 and w not in STOP and w not in GENERIC)
    return out


def _head(doc: Document) -> Set[str]:
    """An article's title and keywords: what it is about (its body mentions all sorts of words)."""
    return set(words("\n".join(doc.page_content.split("\n")[:2])))


def about_the_question(ws: Sequence[str], docs: Sequence[Document]) -> list:
    """Excerpts whose title or keywords contain a real word of the question."""
    content = {w for w in ws if len(w) >= 4 and w not in STOP and w not in GENERIC}
    content |= {w[:-1] for w in content if w.endswith("s")}
    return [d for d in docs if d.metadata.get("keyword_rank") is not None and content & _head(d)]


class ScopeGuard:
    def decide(self, text: str, *, followup: bool, vocab: Iterable[str] = (),
               docs: Sequence[Document] = ()) -> Decision:
        stripped = text.strip()
        if GREETING.match(stripped) or THANKS.match(stripped) or URDU_GREETING.match(stripped) or ABOUT_ME.match(stripped):
            return Decision(GREET, "greeting or thanks")
        ws = words(stripped)
        matched_docs = about_the_question(ws, docs)
        if POLICY.search(stripped) or POLICY_URDU.search(stripped):
            # a figure or promise: only from an article; meaning-only matches are too loose to trust here
            if not matched_docs and not (is_urdu_script(stripped) and docs):
                return Decision(NO_INFO, "money or policy question without a published article")
            return Decision(AGENT, "policy question with matching articles")
        if followup and len(ws) <= 8:
            return Decision(AGENT, "follow-up in the conversation")
        if is_urdu_script(stripped):
            return Decision(AGENT, "Urdu script: the AI decides")
        known = PRODUCT | set(vocab)
        if any(w in known or (w.endswith("s") and w[:-1] in known) for w in ws):
            return Decision(AGENT, "about the home or the product")
        if matched_docs:
            return Decision(AGENT, "the Help Center matches it")
        if followup:
            return Decision(AGENT, "in a conversation")
        return Decision(DECLINE, "not about the home, the product or the company")


# ------------------------------------------------------------------ the fixed replies
def decline_text(lang: str, console: bool) -> str:
    if console:
        return {
            "roman": "Main sirf aap ki company ke Switchboard boards, gharon aur Help Center ke baare mein madad kar sakta hoon. "
                     "Maslan: “kaun se boards offline hain?”",
            "ur": "میں صرف آپ کی کمپنی کے سوئچ بورڈ بورڈز، گھروں اور ہیلپ سینٹر کے بارے میں مدد کر سکتا ہوں۔",
        }.get(lang, "I can only help with your company's Switchboard boards and homes, and the Help Center. "
                    "For example: “which boards are offline?” or “why did the Khan residence board drop last night?”")
    return {
        "roman": "Main sirf aap ke Switchboard ghar ke baare mein madad kar sakta hoon: batti aur pankhay chalana, timer aur "
                 "scenes, kamron aur boards ka haal, aur app aur hamari service ke sawal. Maslan: “pankha chal raha hai?”",
        "ur": "میں صرف آپ کے سوئچ بورڈ گھر کے بارے میں مدد کر سکتا ہوں: بتیاں اور پنکھے چلانا، ٹائمر، کمروں اور بورڈز کا حال، "
              "اور ایپ اور ہماری سروس کے سوال۔",
    }.get(lang, "I can only help with your Switchboard home: switching lights and fans, timers and scenes, how your rooms "
                "and boards are doing, and questions about the app and our service. For example: “is the fan on?” or "
                "“why is my board offline?”")


def no_info_text(lang: str, console: bool) -> str:
    if console:
        return {
            "roman": "Yeh Help Center mein abhi nahi hai, is liye main andaza nahi lagaunga. Super admin isay **Help Center** mein likh sakte hain.",
            "ur": "یہ ابھی ہیلپ سینٹر میں نہیں ہے، اس لیے میں اندازہ نہیں لگاؤں گا۔",
        }.get(lang, "That isn't in the Help Center yet, so I won't guess. A super admin can add it under **Help Center**.")
    return {
        "roman": "Yeh maloomat hamare Help Center mein nahi hai, is liye main andaza nahi lagaunga. Aap ke installer bata "
                 "sakte hain: **Me** kholein, phir **Message your expert**.",
        "ur": "یہ معلومات ہمارے ہیلپ سینٹر میں نہیں ہیں، اس لیے میں اندازہ نہیں لگاؤں گا۔ آپ کے انسٹالر بتا سکتے ہیں: Me کھولیں، پھر Message your expert۔",
    }.get(lang, "I don't have that information in our Help Center, so I won't guess. Your installer can answer it: "
                "open **Me**, then **Message your expert**.")


def greet_text(text: str, lang: str, name: str, console: bool) -> str:
    first = (name or "").split(" ")[0]
    hello = f" {first}" if first and first != "there" else ""
    if THANKS.match(text.strip()) or "شکریہ" in text:
        return {"roman": "Koi baat nahi!", "ur": "کوئی بات نہیں!"}.get(lang, "You're welcome!")
    if console:
        return f"Hi{hello}! Ask me about your boards: which are offline, why one dropped, or where it connects from."
    return {
        "roman": f"Wa alaikum assalam{hello}! Batayein, kya karna hai? Batti, pankha, timer, ya koi sawal.",
        "ur": "وعلیکم السلام! بتائیں، کیا کرنا ہے؟",
    }.get(lang, f"Hi{hello}! I can switch things, set timers, tell you how your home is doing, and answer questions "
                f"about Switchboard. What do you need?")


def truncate_cleanly(text: str, lang: str = "en") -> str:
    """An answer that reached the length limit, ended at its last full sentence or list item."""
    cut = max(text.rfind(m) for m in (". ", ".\n", "! ", "? ", "۔", "\n- ", "\n\n"))
    body = text[:cut + 1].rstrip() if cut > len(text) * 0.4 else text.rstrip()
    more = {"roman": "Mazeed chahiye to poochiye.", "ur": "مزید چاہیے تو پوچھیں۔"}.get(lang, "Ask me if you want more.")
    return f"{body}\n\n{more}"


def last_user_question(history: Sequence, before: Optional[int] = None) -> str:
    """The previous question in this conversation (a follow-up like "where?" is searched with it)."""
    from .domain.models import Role
    items = list(history)[:before] if before is not None else list(history)
    for m in reversed(items):
        if m.role == Role.USER and m.content.strip():
            return m.content
    return ""

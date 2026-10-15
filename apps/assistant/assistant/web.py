"""HTTP endpoints the platform API calls. Not exposed to the internet: every request must carry the
shared secret (X-Assistant-Secret) and the speaking person's short-lived token."""
from __future__ import annotations

import base64
import hmac
import logging
import re
import threading
from datetime import datetime
from typing import Callable, List, Optional

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from pydantic import BaseModel, Field

from .config import Settings
from .conversation import ConversationService, PromptBuilder
from .domain.ports import LLMProvider, SpeechToText, TextToSpeech
from .home_api import HomeApi, HomeApiError
from .quick import QuickCommands
from .tools import build_tools, describe_home, home_zone

log = logging.getLogger(__name__)

MAX_AUDIO_BYTES = 10 * 1024 * 1024
DID_NOT_HEAR = "Sorry, I did not catch that. Please try again."
YES = "Yes?"
# "Hey Switchboard, ..." can slip into the recording after the wake word: never treat it as the request
WAKE_PHRASE = re.compile(
    r"^\W*(?:(?:hey|hi|hay|ok|okay|a)\W+)?(?:switch\W?board|switch\W?bored|switch\W?bord|jarvis)\b\W*", re.I)
# ...or only its tail, when the recording starts a moment late: "board, turn off the fan"
WAKE_TAIL = re.compile(r"^\W*(?:board|bored|bord|jarvis|davis|harvis|service)\W+(?=\w+\s+\w+)", re.I)


def strip_wake_word(text: str, after_wake: bool = False) -> str:
    """`after_wake`: recorded straight after the wake word (hands-free), where its tail can slip in."""
    rest = WAKE_PHRASE.sub("", text, count=1).strip()
    if after_wake and rest == text.strip():
        rest = WAKE_TAIL.sub("", rest, count=1).strip()
    return rest


class Identity(BaseModel):
    """Who is speaking and in which home: each (person, home) pair has its own conversation."""
    user_id: str
    user_name: str = "there"
    home_id: str = ""
    home_name: str = ""
    timezone: str = ""          # the home's, e.g. Asia/Karachi
    token: str


class ChatIn(Identity):
    text: str = Field(min_length=1, max_length=1000)
    speak: bool = True
    # the app's chat screen is empty: start a new conversation so the AI remembers only what the person sees
    fresh: bool = False


class ReplyOut(BaseModel):
    heard: Optional[str] = None
    reply: str
    audio: Optional[str] = None  # base64 WAV


def create_app(settings: Settings, *, llm: Optional[LLMProvider] = None, stt: Optional[SpeechToText] = None,
               tts: Optional[TextToSpeech] = None,
               api_factory: Optional[Callable[[str], HomeApi]] = None) -> FastAPI:
    """Composition root: real adapters by default, fakes in tests."""
    if llm is None:
        from .llm import create_provider
        llm = create_provider(settings)
    if stt is None:
        from .speech import WhisperSTT
        stt = WhisperSTT(settings.whisper_model, settings.language, settings.languages)
    if tts is None:
        from .speech import create_tts
        tts = create_tts(settings.piper_model)
    make_api = api_factory or (lambda token: HomeApi(settings.api_url, token))
    conversation = ConversationService(llm, PromptBuilder(settings.instructions_file), max_turns=settings.max_turns,
                                       fast_replies=settings.fast_replies, idle_minutes=settings.idle_minutes)
    for part in (llm, stt):                             # load the models now, not on the first question
        warm = getattr(part, "warm_up", None)
        if callable(warm):
            threading.Thread(target=warm, daemon=True).start()

    app = FastAPI(title="Home assistant voice service", docs_url=None, redoc_url=None)

    def check_secret(x_assistant_secret: str = Header(default="")) -> None:
        if not settings.shared_secret:
            raise HTTPException(500, "ASSISTANT_SHARED_SECRET is not set on the assistant.")
        if not hmac.compare_digest(x_assistant_secret, settings.shared_secret):
            raise HTTPException(401, "Wrong assistant secret.")

    def load_devices(api: HomeApi, who: Identity) -> List[dict]:
        try:
            return api.devices()
        except HomeApiError as exc:
            log.warning("Could not load devices for %s: %s", who.user_name, exc)
            return []

    def answer(text: str, who: Identity, speak: bool, fresh: bool = False, api: Optional[HomeApi] = None,
               devices: Optional[List[dict]] = None) -> ReplyOut:
        api = api or make_api(who.token)
        devices = load_devices(api, who) if devices is None else devices
        tz = home_zone(who.timezone or settings.timezone)
        clock = lambda: datetime.now(tz)                # noqa: E731 - the home's clock, shared by both
        tools = build_tools(api, devices, tz, clock)
        quick = QuickCommands(api, devices, tools, clock=clock) if settings.quick_commands else None
        scenes = getattr(tools.get("run_scene"), "_scenes", [])
        reply = conversation.ask(who.user_id, who.user_name, text, tools, quick,
                                 home_id=who.home_id, home_name=who.home_name, fresh=fresh,
                                 tz=tz, home_state=describe_home(devices, scenes))
        audio = None
        if speak:
            try:
                audio = tts.synthesize(reply)
            except Exception:  # noqa: BLE001 - the written reply still goes out
                log.exception("Could not speak the reply")
        return ReplyOut(heard=text, reply=reply, audio=base64.b64encode(audio).decode() if audio else None)

    def hint_for(devices: List[dict]) -> str:
        """Device and room names, so Whisper spells them the way this home does."""
        words: List[str] = []
        for d in devices:
            for w in [d.get("name"), d.get("roomName"), *d.get("aliases", [])]:
                if w and w not in words:
                    words.append(w)
        return ", ".join(words[:40])

    @app.get("/health")
    def health():
        describe = getattr(tts, "describe", None)
        return {"ok": True, "llm": settings.llm_provider,
                "model": settings.claude_model if settings.llm_provider == "claude" else settings.ollama_model,
                "voice": describe() if callable(describe) else "unknown"}

    @app.post("/v1/chat", response_model=ReplyOut, dependencies=[Depends(check_secret)])
    def chat(body: ChatIn):
        who = Identity(**body.model_dump(include=set(Identity.model_fields)))
        return answer(body.text.strip(), who, body.speak, body.fresh)

    @app.post("/v1/voice", response_model=ReplyOut, dependencies=[Depends(check_secret)])
    def voice(audio: UploadFile = File(...), user_id: str = Form(...), user_name: str = Form("there"),
              token: str = Form(...), home_id: str = Form(""), home_name: str = Form(""), timezone: str = Form(""),
              fresh: bool = Form(False), after_wake: bool = Form(False)):
        data = audio.file.read(MAX_AUDIO_BYTES + 1)
        if len(data) > MAX_AUDIO_BYTES:
            raise HTTPException(413, "Recording too long.")
        caller = Identity(user_id=user_id, user_name=user_name, home_id=home_id, home_name=home_name,
                          timezone=timezone, token=token)
        api = make_api(token)
        devices = load_devices(api, caller)
        try:
            heard = stt.transcribe(data, hint=hint_for(devices))
        except Exception as exc:  # noqa: BLE001 - undecodable or empty audio
            log.warning("Could not transcribe audio: %s", exc)
            heard = ""
        who = caller
        if heard and not strip_wake_word(heard, after_wake):
            # only the wake word: ask what they want (the app then listens without the wake word)
            spoken = tts.synthesize(YES)
            return ReplyOut(heard=heard, reply=YES, audio=base64.b64encode(spoken).decode() if spoken else None)
        heard = strip_wake_word(heard, after_wake)
        if not heard:
            spoken = tts.synthesize(DID_NOT_HEAR)
            return ReplyOut(heard="", reply=DID_NOT_HEAR, audio=base64.b64encode(spoken).decode() if spoken else None)
        return answer(heard, who, speak=True, fresh=fresh, api=api, devices=devices)

    @app.post("/v1/reset", status_code=204, dependencies=[Depends(check_secret)])
    def reset(who: Identity):
        conversation.reset(who.user_id, who.home_id)

    app.state.conversation = conversation
    return app

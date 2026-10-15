"""HTTP endpoints the platform API calls. Not exposed to the internet: every request must carry the
shared secret (X-Assistant-Secret) and the speaking person's short-lived token."""
from __future__ import annotations

import base64
import hmac
import logging
from typing import Callable, Optional

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from pydantic import BaseModel, Field

from .config import Settings
from .conversation import ConversationService, PromptBuilder
from .domain.ports import LLMProvider, SpeechToText, TextToSpeech
from .home_api import HomeApi, HomeApiError
from .quick import QuickCommands
from .tools import build_tools

log = logging.getLogger(__name__)

MAX_AUDIO_BYTES = 10 * 1024 * 1024
DID_NOT_HEAR = "Sorry, I did not catch that. Please try again."


class ChatIn(BaseModel):
    text: str = Field(min_length=1, max_length=1000)
    speak: bool = True
    user_id: str
    user_name: str = "there"
    token: str


class Identity(BaseModel):
    user_id: str
    user_name: str = "there"
    token: str


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
                                       fast_replies=settings.fast_replies)
    warm = getattr(llm, "warm_up", None)
    if callable(warm):                                  # load the model now, not on the first question
        import threading
        threading.Thread(target=warm, daemon=True).start()

    app = FastAPI(title="Home assistant voice service", docs_url=None, redoc_url=None)

    def check_secret(x_assistant_secret: str = Header(default="")) -> None:
        if not settings.shared_secret:
            raise HTTPException(500, "ASSISTANT_SHARED_SECRET is not set on the assistant.")
        if not hmac.compare_digest(x_assistant_secret, settings.shared_secret):
            raise HTTPException(401, "Wrong assistant secret.")

    def answer(text: str, who: Identity, speak: bool) -> ReplyOut:
        api = make_api(who.token)
        try:
            devices = api.devices()
        except HomeApiError as exc:
            log.warning("Could not load devices for %s: %s", who.user_name, exc)
            devices = []
        tools = build_tools(api, devices)
        quick = QuickCommands(api, devices, tools) if settings.quick_commands else None
        reply = conversation.ask(who.user_id, who.user_name, text, tools, quick)
        audio = tts.synthesize(reply) if speak else None
        return ReplyOut(heard=text, reply=reply, audio=base64.b64encode(audio).decode() if audio else None)

    @app.get("/health")
    def health():
        return {"ok": True, "llm": settings.llm_provider}

    @app.post("/v1/chat", response_model=ReplyOut, dependencies=[Depends(check_secret)])
    def chat(body: ChatIn):
        return answer(body.text.strip(), Identity(**body.model_dump()), body.speak)

    @app.post("/v1/voice", response_model=ReplyOut, dependencies=[Depends(check_secret)])
    def voice(audio: UploadFile = File(...), user_id: str = Form(...), user_name: str = Form("there"),
              token: str = Form(...)):
        data = audio.file.read(MAX_AUDIO_BYTES + 1)
        if len(data) > MAX_AUDIO_BYTES:
            raise HTTPException(413, "Recording too long.")
        try:
            heard = stt.transcribe(data)
        except Exception as exc:  # noqa: BLE001 - undecodable or empty audio
            log.warning("Could not transcribe audio: %s", exc)
            heard = ""
        who = Identity(user_id=user_id, user_name=user_name, token=token)
        if not heard:
            spoken = tts.synthesize(DID_NOT_HEAR)
            return ReplyOut(heard="", reply=DID_NOT_HEAR, audio=base64.b64encode(spoken).decode() if spoken else None)
        return answer(heard, who, speak=True)

    @app.post("/v1/reset", status_code=204, dependencies=[Depends(check_secret)])
    def reset(who: Identity):
        conversation.reset(who.user_id)

    app.state.conversation = conversation
    return app

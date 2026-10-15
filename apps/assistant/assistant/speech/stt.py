"""Speech to text with faster-whisper, running locally."""
from __future__ import annotations

import io
import logging
import threading
from typing import Optional

log = logging.getLogger(__name__)


class WhisperSTT:
    def __init__(self, model: str = "base", language: Optional[str] = None) -> None:
        self._model_name = model
        self._language = language
        self._model = None
        self._lock = threading.Lock()             # one transcription at a time keeps the server responsive

    def _load(self):
        if self._model is None:
            from faster_whisper import WhisperModel
            log.info("Loading Whisper model '%s' (first time can take a minute)...", self._model_name)
            self._model = WhisperModel(self._model_name, device="cpu", compute_type="int8")
        return self._model

    def transcribe(self, audio) -> str:
        """`audio`: file bytes (webm / ogg / mp4 / wav) as recorded by the browser."""
        source = io.BytesIO(audio) if isinstance(audio, (bytes, bytearray)) else audio
        with self._lock:
            segments, info = self._load().transcribe(source, language=self._language, beam_size=1, vad_filter=True)
            text = " ".join(s.text for s in segments).strip()
        log.info("Heard (%s): %s", info.language, text or "<nothing>")
        return text

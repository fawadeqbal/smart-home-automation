"""Text to speech. Piper (natural, local) first, espeak-ng (robotic, tiny) as a fallback."""
from __future__ import annotations

import io
import logging
import re
import shutil
import subprocess
import wave
from pathlib import Path
from typing import Optional, Sequence

from ..domain.ports import TextToSpeech

log = logging.getLogger(__name__)


def clean_for_speech(text: str) -> str:
    """Remove markdown symbols the voice would read out loud."""
    text = re.sub(r"[*_#`>|]", "", text)
    return re.sub(r"\s+", " ", text).strip()


def pcm_to_wav(pcm16: bytes, rate: int) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm16)
    return buf.getvalue()


class PiperTTS:
    def __init__(self, model_path: Path) -> None:
        self._path = Path(model_path)
        self._voice = None
        self._failed = False

    def _load(self):
        if self._voice is None and not self._failed:
            try:
                if not self._path.exists():
                    raise FileNotFoundError(self._path)
                from piper import PiperVoice
                self._voice = PiperVoice.load(str(self._path))
            except Exception as exc:  # noqa: BLE001
                log.warning("Piper voice unavailable (%s).", exc)
                self._failed = True
        return self._voice

    def synthesize(self, text: str) -> Optional[bytes]:
        voice = self._load()
        if voice is None:
            return None
        if hasattr(voice, "synthesize_stream_raw"):                     # piper-tts 1.2
            return pcm_to_wav(b"".join(voice.synthesize_stream_raw(text)), voice.config.sample_rate)
        chunks = list(voice.synthesize(text))                           # piper-tts 1.3+
        if not chunks:
            return None
        return pcm_to_wav(b"".join(c.audio_int16_bytes for c in chunks), chunks[0].sample_rate)


class EspeakTTS:
    def synthesize(self, text: str) -> Optional[bytes]:
        if not shutil.which("espeak-ng"):
            return None
        result = subprocess.run(["espeak-ng", "-s", "160", "--stdout", text], capture_output=True, check=False)
        return result.stdout or None


class ChainTTS:
    """Tries each voice in order until one produces audio (Chain of Responsibility)."""

    def __init__(self, voices: Sequence[TextToSpeech]) -> None:
        self._voices = list(voices)

    def synthesize(self, text: str) -> Optional[bytes]:
        text = clean_for_speech(text)
        if not text:
            return None
        for voice in self._voices:
            audio = voice.synthesize(text)
            if audio:
                return audio
        return None


def create_tts(piper_model: Path) -> TextToSpeech:
    return ChainTTS([PiperTTS(piper_model), EspeakTTS()])

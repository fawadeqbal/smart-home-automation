"""Text to speech. Piper (natural, local) first, espeak-ng (robotic, tiny) as a fallback.

English replies use the English Piper voice. A reply in Urdu script uses the Urdu Piper voice
("Fasih", ur_PK), with the English words in it written in Urdu script first so it can say them;
espeak-ng's Urdu voice is the fallback when that voice isn't installed.
"""
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


URDU_SCRIPT = re.compile(r"[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]")


def is_urdu_script(text: str) -> bool:
    letters = [c for c in text if c.isalpha()]
    return bool(letters) and sum(1 for c in letters if URDU_SCRIPT.match(c)) / len(letters) > 0.3


def clean_for_speech(text: str) -> str:
    """The reply as it should be heard: Markdown signs, links and emojis removed, list items and
    lines turned into sentences so the voice pauses between them."""
    text = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", text)            # [title](link) -> title
    text = re.sub(r"https?://\S+", "", text)
    lines = []
    for line in text.splitlines():
        line = re.sub(r"^\s*(#{1,6}\s+|>\s*|[-*+•]\s+|\d+[.)]\s+)", "", line)   # headings, quotes, list markers
        line = line.strip(" |")
        if not line or re.fullmatch(r"[\s:|-]+", line):            # blank lines, table rules
            continue
        lines.append(line)
    # a pause between lines: each line but the last ends like a sentence
    text = " ".join(l if i == len(lines) - 1 or re.search(r"[.!?؟:;,،۔]\W*$", l) else l + "." for i, l in enumerate(lines))
    text = re.sub(r"[*_#`>|~]", "", text)
    text = re.sub(r"[\U0001F000-\U0001FAFF\u2600-\u27BF\uFE0F]", "", text)
    text = text.replace("°C", " degrees").replace("°", " degrees").replace("%", " percent")
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
    def __init__(self, voice: str = "en") -> None:
        self.voice = voice

    def available(self) -> bool:
        return bool(shutil.which("espeak-ng"))

    def synthesize(self, text: str) -> Optional[bytes]:
        if not self.available():
            return None
        try:
            result = subprocess.run(["espeak-ng", "-v", self.voice, "-s", "155", "--stdout", text],
                                    capture_output=True, check=False, timeout=20)
        except (OSError, subprocess.TimeoutExpired) as exc:
            log.warning("espeak-ng failed: %s", exc)
            return None
        return result.stdout or None


class UrduPiperTTS(PiperTTS):
    """The Urdu Piper voice: English names in the reply ("Fan", "AC") are written in Urdu script first."""

    def synthesize(self, text: str) -> Optional[bytes]:
        from .urdu import for_urdu_voice
        return super().synthesize(for_urdu_voice(text))


class ChainTTS:
    """Tries each voice in order until one produces audio (Chain of Responsibility).
    Urdu script skips the English-only voices."""

    def __init__(self, voices: Sequence[TextToSpeech], urdu_voices: Sequence[TextToSpeech] = ()) -> None:
        self._voices = list(voices)
        self._urdu = list(urdu_voices)

    def synthesize(self, text: str) -> Optional[bytes]:
        text = clean_for_speech(text)
        if not text:
            return None
        for voice in (self._urdu if is_urdu_script(text) and self._urdu else self._voices):
            try:
                audio = voice.synthesize(text)
            except Exception:  # noqa: BLE001 - a broken voice must not lose the written reply
                log.exception("Voice %s failed", type(voice).__name__)
                audio = None
            if audio:
                return audio
        return None

    def describe(self) -> str:
        """For the health check: 'natural' (Piper), 'basic' (espeak-ng only) or 'none'."""
        for voice in self._voices:
            if isinstance(voice, PiperTTS) and voice._load() is not None:
                return "natural"
        if any(isinstance(v, EspeakTTS) and v.available() for v in self._voices):
            return "basic"
        return "none"

    def describe_urdu(self) -> str:
        """'natural' (the Urdu Piper voice), 'basic' (espeak-ng) or 'none'."""
        if any(isinstance(v, PiperTTS) and v._load() is not None for v in self._urdu):
            return "natural"
        if any(isinstance(v, EspeakTTS) and v.available() for v in self._urdu):
            return "basic"
        return "none"


def create_tts(piper_model: Path, urdu_model: Optional[Path] = None) -> TextToSpeech:
    urdu: list = [UrduPiperTTS(urdu_model)] if urdu_model and urdu_model.exists() else []
    return ChainTTS([PiperTTS(piper_model), EspeakTTS("en")], urdu_voices=[*urdu, EspeakTTS("ur")])

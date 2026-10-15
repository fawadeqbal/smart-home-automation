"""Speech to text with faster-whisper, running locally.

Handles quiet microphones (boosts the level) and a too-strict speech filter (retries without it),
and logs how loud each recording was, which tells you at once if the browser used the wrong mic.
"""
from __future__ import annotations

import io
import logging
import threading
from typing import Optional, Sequence

log = logging.getLogger(__name__)

# Recordings quieter than this (peak, 0..1) are treated as silence: Whisper invents words on silence.
SILENT_PEAK = 0.01
# Quiet microphones are boosted to this peak level before recognition.
TARGET_PEAK = 0.5


class WhisperSTT:
    def __init__(self, model: str = "base", language: Optional[str] = None,
                 languages: Sequence[str] = ("en", "ur")) -> None:
        self._model_name = model
        self._language = language            # forced language, or None
        self._languages = tuple(languages)   # otherwise the best match among these (never e.g. Russian)
        self._model = None
        self._lock = threading.Lock()             # one transcription at a time keeps the server responsive

    def _load(self):
        if self._model is None:
            from faster_whisper import WhisperModel
            log.info("Loading Whisper model '%s' (first time can take a minute)...", self._model_name)
            self._model = WhisperModel(self._model_name, device="cpu", compute_type="int8")
        return self._model

    def _pick_language(self, samples) -> str:
        """Whisper's language guess, limited to the languages this family speaks."""
        if self._language:
            return self._language
        if len(self._languages) == 1:
            return self._languages[0]
        _, info = self._load().transcribe(samples, language=None, beam_size=1, vad_filter=False)
        scores = dict(info.all_language_probs or [])
        best = max(self._languages, key=lambda lang: scores.get(lang, 0.0))
        log.info("Language: %s (%s)", best, ", ".join(f"{l} {scores.get(l, 0):.2f}" for l in self._languages))
        return best

    def _recognize(self, samples, vad: bool, language: str) -> tuple:
        segments, info = self._load().transcribe(
            samples, language=language, beam_size=5, vad_filter=vad,
            vad_parameters={"threshold": 0.3, "min_silence_duration_ms": 500} if vad else None,
        )
        return " ".join(s.text for s in segments).strip(), info.language

    def transcribe(self, audio) -> str:
        """`audio`: file bytes (webm / ogg / mp4 / wav) as recorded by the browser."""
        from faster_whisper import decode_audio

        source = io.BytesIO(audio) if isinstance(audio, (bytes, bytearray)) else audio
        samples = decode_audio(source, sampling_rate=16000)
        peak = float(abs(samples).max()) if len(samples) else 0.0
        log.info("Recording: %.1f s, loudness peak %.3f (1.0 = maximum)", len(samples) / 16000, peak)
        if peak < SILENT_PEAK:
            log.warning("The recording is silent: check the browser's microphone choice and the Windows input level.")
            return ""
        if peak < TARGET_PEAK:
            samples = samples * (TARGET_PEAK / peak)    # quiet microphone: make it louder

        with self._lock:
            language = self._pick_language(samples)
            text, _ = self._recognize(samples, vad=True, language=language)
            if not text:                                # the speech filter was too strict: try once without it
                text, _ = self._recognize(samples, vad=False, language=language)
        log.info("Heard (%s): %s", language, text or "<nothing>")
        return text

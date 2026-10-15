"""Typed, immutable settings read once from the environment (or the repository's .env).
No other module reads os.environ."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Optional, Tuple

from dotenv import load_dotenv

APP_DIR = Path(__file__).resolve().parent.parent          # apps/assistant
REPO_ROOT = APP_DIR.parent.parent


@dataclass(frozen=True)
class Settings:
    base_dir: Path = APP_DIR

    # The platform API the device tools call, and the secret the API sends us
    api_url: str = "http://localhost:4000"
    shared_secret: str = ""

    # Brain
    llm_provider: str = "ollama"
    ollama_url: str = "http://localhost:11434"
    ollama_model: str = "qwen2.5:3b"
    anthropic_api_key: str = ""
    claude_model: str = "claude-sonnet-5-5"
    max_tokens: int = 600
    max_turns: int = 8
    # a conversation nobody has used for this long starts afresh (0 = never)
    idle_minutes: float = 30
    # speed: answer everyday commands without the AI, and skip the AI's second round after a plain action
    quick_commands: bool = True
    fast_replies: bool = True

    # the time zone of a home whose own zone is unknown
    timezone: str = "Asia/Karachi"

    # Help Center search: also by meaning (a small multilingual model on this server), not only keywords
    help_embeddings: bool = True

    # Speech
    whisper_model: str = "small"
    language: Optional[str] = None               # force one language, e.g. "en"
    languages: Tuple[str, ...] = ("en", "ur")    # otherwise: pick the best match among these only
    piper_model: Path = APP_DIR / "models" / "en_US-lessac-medium.onnx"

    @property
    def instructions_file(self) -> Path:
        return Path(self.base_dir) / "instructions.md"

    @property
    def console_instructions_file(self) -> Path:
        """The console assistant (staff, about all the homes they look after)."""
        return Path(self.base_dir) / "instructions-console.md"

    @classmethod
    def from_env(cls) -> "Settings":
        load_dotenv(REPO_ROOT / ".env")                 # real environment variables win
        env = os.environ.get
        piper = Path(env("PIPER_MODEL", "models/en_US-lessac-medium.onnx"))
        return cls(
            api_url=env("API_URL", "http://localhost:4000").rstrip("/"),
            shared_secret=env("ASSISTANT_SHARED_SECRET", ""),
            llm_provider=env("LLM_PROVIDER", "ollama").strip().lower(),
            ollama_url=env("OLLAMA_URL", "http://localhost:11434").rstrip("/"),
            ollama_model=env("OLLAMA_MODEL", "qwen2.5:3b"),
            anthropic_api_key=env("ANTHROPIC_API_KEY", ""),
            claude_model=env("CLAUDE_MODEL") or "claude-sonnet-5-5",
            max_tokens=int(env("MAX_TOKENS") or "600"),
            max_turns=int(env("MAX_TURNS") or "8"),
            idle_minutes=float(env("CONVERSATION_IDLE_MINUTES") or "30"),
            quick_commands=env("QUICK_COMMANDS", "true").strip().lower() != "false",
            fast_replies=env("FAST_REPLIES", "true").strip().lower() != "false",
            help_embeddings=(env("HELP_EMBEDDINGS") or "true").strip().lower() != "false",
            whisper_model=env("WHISPER_MODEL") or "small",
            language=env("LANGUAGE") or None,
            # an empty LANGUAGES (Compose passes "" when it isn't set) means the default, not English only
            languages=tuple(x.strip() for x in (env("LANGUAGES") or "en,ur").split(",") if x.strip()) or ("en", "ur"),
            timezone=env("HOME_TIMEZONE") or "Asia/Karachi",
            piper_model=piper if piper.is_absolute() else APP_DIR / piper,
        )

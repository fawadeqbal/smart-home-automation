"""Name -> provider class. Lets new providers plug in without editing existing code."""
from __future__ import annotations

from typing import Callable, Dict, List, Type

from ..config import Settings
from ..domain.ports import LLMProvider

_PROVIDERS: Dict[str, Callable[[Settings], LLMProvider]] = {}


def register(name: str):
    def decorator(cls: Type) -> Type:
        _PROVIDERS[name] = cls
        return cls
    return decorator


def available() -> List[str]:
    return sorted(_PROVIDERS)


def create_provider(settings: Settings) -> LLMProvider:
    try:
        factory = _PROVIDERS[settings.llm_provider]
    except KeyError:
        raise ValueError(f"Unknown LLM_PROVIDER '{settings.llm_provider}'. Choose one of: {', '.join(available())}")
    return factory(settings)

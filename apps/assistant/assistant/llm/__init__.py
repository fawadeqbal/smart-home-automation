"""AI model providers. Each one implements domain.ports.LLMProvider.

To add a provider (OpenAI, Gemini, a llama.cpp server...):
  1. create llm/<name>.py with a class that has `name` and `chat(system, messages, tools)`
  2. decorate it with @register("<name>")
  3. set LLM_PROVIDER=<name> in .env
"""
from .registry import create_provider, register, available  # noqa: F401
from . import ollama, claude  # noqa: F401,E402  - importing registers the built-in providers

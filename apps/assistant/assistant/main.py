"""Start the voice service:  python -m assistant.main   (or: uvicorn assistant.main:app --port 8000)"""
from __future__ import annotations

import logging
import os

from .config import Settings
from .web import create_app

logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"), datefmt="%H:%M:%S",
                    format="%(asctime)s  %(levelname)-7s %(name)-24s %(message)s")

settings = Settings.from_env()
app = create_app(settings)


def main() -> None:
    import uvicorn
    host = os.environ.get("ASSISTANT_HOST", "127.0.0.1")
    uvicorn.run(app, host=host, port=int(os.environ.get("ASSISTANT_PORT", "8000")), log_level="warning")


if __name__ == "__main__":
    main()

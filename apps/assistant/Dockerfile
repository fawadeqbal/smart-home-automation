FROM python:3.12-slim
# ffmpeg libraries for decoding browser audio (webm/ogg), espeak-ng as a fallback voice
RUN apt-get update && apt-get install -y --no-install-recommends espeak-ng && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY assistant ./assistant
COPY instructions.md .
ENV ASSISTANT_HOST=0.0.0.0 ASSISTANT_PORT=8000 PYTHONUNBUFFERED=1 TZ=Asia/Karachi \
    FASTEMBED_CACHE_PATH=/root/.cache/fastembed
EXPOSE 8000
CMD ["python", "-m", "assistant.main"]

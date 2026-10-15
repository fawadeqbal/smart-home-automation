#include "LogSink.h"

#include <stdarg.h>

namespace LogSink {
namespace {

Line queue[LOG_QUEUE_LINES];
uint8_t head = 0;    // next line to read
uint8_t count = 0;
uint16_t dropped = 0;

const char* const NAMES[] = {"debug", "info", "warn", "error"};
const char* const SERIAL_TAGS[] = {"DEBUG", "INFO ", "WARN ", "ERROR"};

}  // namespace

const char* levelName(uint8_t level) {
  return NAMES[level <= static_cast<uint8_t>(ERROR) ? level : static_cast<uint8_t>(INFO)];
}

void write(Level level, PGM_P format, ...) {
  char text[LOG_LINE_MAX];
  va_list args;
  va_start(args, format);
  vsnprintf_P(text, sizeof(text), format, args);
  va_end(args);

  Serial.printf("[%8lu] %s %s\n", millis(), SERIAL_TAGS[level], text);

#if REMOTE_LOGS
#if REMOTE_LOG_MIN_LEVEL > 0
  if (level < REMOTE_LOG_MIN_LEVEL) return;
#endif
  if (count == LOG_QUEUE_LINES) {   // full: drop the oldest
    head = (head + 1) % LOG_QUEUE_LINES;
    count--;
    dropped++;
  }
  Line& line = queue[(head + count) % LOG_QUEUE_LINES];
  line.level = level;
  line.uptimeSec = millis() / 1000;
  strncpy(line.text, text, sizeof(line.text));
  line.text[sizeof(line.text) - 1] = '\0';
  count++;
#endif
}

bool pop(Line& out) {
  if (count == 0) return false;
  out = queue[head];
  head = (head + 1) % LOG_QUEUE_LINES;
  count--;
  return true;
}

uint16_t takeDropped() {
  const uint16_t n = dropped;
  dropped = 0;
  return n;
}

}  // namespace LogSink

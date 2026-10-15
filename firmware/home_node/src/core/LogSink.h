// ============================================================================
//  LogSink  -  where log lines go: the Serial Monitor right away, and a small
//  queue that MqttBridge empties to the server when connected (live logs in the
//  web app). Lines written while offline wait in the queue; if it overflows,
//  the oldest are dropped and the server is told how many.
//  write() never touches the network, so logging inside MQTT code is safe.
// ============================================================================
#pragma once

#include <Arduino.h>

#include "../../config.h"

namespace LogSink {

enum Level : uint8_t { DEBUG = 0, INFO = 1, WARN = 2, ERROR = 3 };

struct Line {
  uint8_t level;
  uint32_t uptimeSec;
  char text[LOG_LINE_MAX];
};

void write(Level level, PGM_P format, ...);

/** Takes the oldest queued line; false when the queue is empty. */
bool pop(Line& out);

/** Lines lost because the queue was full (and resets the count). */
uint16_t takeDropped();

const char* levelName(uint8_t level);

}  // namespace LogSink

// Logging. Every line goes to the Serial Monitor (115200 baud) and, with REMOTE_LOGS on, is also
// queued for the server, which shows it live in the web app (Boards > Logs).
// Compiled out completely when LOG_ENABLED is 0.
#pragma once

#include <Arduino.h>

#include "../../config.h"
#include "LogSink.h"

#if LOG_ENABLED
  #define LOG_DEBUG(fmt, ...) LogSink::write(LogSink::DEBUG, PSTR(fmt), ##__VA_ARGS__)
  #define LOG_INFO(fmt, ...)  LogSink::write(LogSink::INFO, PSTR(fmt), ##__VA_ARGS__)
  #define LOG_WARN(fmt, ...)  LogSink::write(LogSink::WARN, PSTR(fmt), ##__VA_ARGS__)
  #define LOG_ERROR(fmt, ...) LogSink::write(LogSink::ERROR, PSTR(fmt), ##__VA_ARGS__)
#else
  #define LOG_DEBUG(...) do {} while (0)
  #define LOG_INFO(...)  do {} while (0)
  #define LOG_WARN(...)  do {} while (0)
  #define LOG_ERROR(...) do {} while (0)
#endif

// Small helpers for JSON files in LittleFS. Writes go to a temp file first and are then renamed,
// so a power cut in the middle of a write never leaves a corrupt file.
#pragma once

#include <ArduinoJson.h>
#include <LittleFS.h>

#include "../core/Log.h"

namespace Files {

static const char* const SETTINGS = "/settings.json";   // server address and login (from the setup page)
static const char* const CONFIG = "/config.json";       // devices and pins (from the server)
static const char* const STATE = "/state.json";         // last switch states

inline bool begin() {
  if (LittleFS.begin()) return true;
  LOG_WARN("Formatting the file system (first start?)");
  return LittleFS.format() && LittleFS.begin();
}

inline bool readJson(const char* path, JsonDocument& doc) {
  if (!LittleFS.exists(path)) return false;
  File f = LittleFS.open(path, "r");
  const DeserializationError err = deserializeJson(doc, f);
  f.close();
  if (err) LOG_WARN("%s unreadable (%s), ignoring it", path, err.c_str());
  return !err;
}

inline bool writeJson(const char* path, const JsonDocument& doc) {
  const String tmp = String(path) + ".tmp";
  File f = LittleFS.open(tmp, "w");
  if (!f) {
    LOG_ERROR("Cannot write %s", path);
    return false;
  }
  serializeJson(doc, f);
  f.close();
  LittleFS.remove(path);
  return LittleFS.rename(tmp, path);
}

}  // namespace Files

#include "StateStore.h"

#include <LittleFS.h>

#include "../core/Log.h"
#include "Files.h"

void StateStore::restore() {
  JsonDocument doc;
  if (!Files::readJson(Files::STATE, doc)) return;
  restoring_ = true;
  for (size_t i = 0; i < registry_.count(); ++i) {
    Device& device = registry_.at(i);
    JsonObjectConst saved = doc[device.key()];
    if (device.controllable() && !saved.isNull()) device.apply(saved);
  }
  restoring_ = false;
}

void StateStore::onDeviceChanged(Device& device) {
  if (restoring_ || !device.controllable()) return;
  dirty_ = true;
  changedAt_ = millis();
}

void StateStore::loop() {
  if (dirty_ && millis() - changedAt_ >= STATE_SAVE_DELAY_MS) save();
}

void StateStore::save() {
  dirty_ = false;
  JsonDocument doc;
  for (size_t i = 0; i < registry_.count(); ++i) {
    Device& device = registry_.at(i);
    if (device.controllable()) device.writeState(doc[device.key()].to<JsonObject>());
  }
  if (Files::writeJson(Files::STATE, doc)) LOG_INFO("Switch states saved");
}

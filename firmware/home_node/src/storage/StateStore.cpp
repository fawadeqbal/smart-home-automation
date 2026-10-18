#include "StateStore.h"

#include <LittleFS.h>
#include <user_interface.h>

#include "../core/Log.h"
#include "Files.h"

void StateStore::load() {
  if (loaded_) return;
  loaded_ = true;
  if (!Files::readJson(Files::STATE, saved_)) saved_.to<JsonObject>();
}

bool StateStore::differs(Device& device, JsonObjectConst saved) const {
  JsonDocument now;
  device.writeState(now.to<JsonObject>());
  String a, b;
  serializeJson(now, a);
  serializeJson(saved, b);
  return a != b;
}

void StateStore::restore(bool boot, uint32_t gapMs) {
  load();
  pendingCount_ = pendingNext_ = 0;
  gapMs_ = gapMs;
  // "stay off" is about electricity coming back, not about a restart the board chose (update, crash)
  const bool powerOn = boot && ESP.getResetInfoPtr()->reason == REASON_DEFAULT_RST;
  applying_ = true;
  ChangeSource source("boot");
  for (size_t i = 0; i < registry_.count(); ++i) {
    Device& device = registry_.at(i);
    if (!device.controllable()) continue;
    JsonObjectConst saved = saved_[device.key()];
    if (powerOn && device.restoreOff()) {
      if (!saved.isNull() && differs(device, saved)) {
        LOG_INFO("%s stays off after the power cut", device.key().c_str());
        dirty_ = true;   // remember it as off
        changedAt_ = millis();
      }
      continue;
    }
    if (saved.isNull() || !differs(device, saved)) continue;
    if (boot && gapMs > 0) pending_[pendingCount_++] = device.key();
    else device.apply(saved);
  }
  applying_ = false;
  nextAt_ = millis();
  if (pendingCount_) LOG_INFO("Switching %u devices back on, one every %lu ms", (unsigned)pendingCount_, (unsigned long)gapMs);
}

void StateStore::onDeviceChanged(Device& device) {
  if (applying_ || !device.controllable()) return;
  // someone switched a device that was still waiting to come back: their choice wins
  for (size_t i = pendingNext_; i < pendingCount_; ++i) {
    if (pending_[i] == device.key()) pending_[i] = "";
  }
  dirty_ = true;
  changedAt_ = millis();
}

void StateStore::loop() {
  if (pendingNext_ < pendingCount_ && (int32_t)(millis() - nextAt_) >= 0) {
    const String key = pending_[pendingNext_++];
    Device* device = key.length() ? registry_.find(key) : nullptr;
    JsonObjectConst saved = saved_[key];
    if (device && !saved.isNull()) {
      applying_ = true;
      ChangeSource source("boot");
      device->apply(saved);
      applying_ = false;
      nextAt_ = millis() + gapMs_;
    }
    if (pendingNext_ >= pendingCount_) pendingCount_ = pendingNext_ = 0;
  }
  if (dirty_ && millis() - changedAt_ >= STATE_SAVE_DELAY_MS) save();
}

void StateStore::save() {
  dirty_ = false;
  for (size_t i = 0; i < registry_.count(); ++i) {
    Device& device = registry_.at(i);
    if (!device.controllable()) continue;
    bool waiting = false;   // still coming back: keep the state it is coming back to
    for (size_t j = pendingNext_; j < pendingCount_; ++j) waiting |= pending_[j] == device.key();
    if (!waiting) device.writeState(saved_[device.key()].to<JsonObject>());
  }
  if (Files::writeJson(Files::STATE, saved_)) LOG_INFO("Switch states saved");
}

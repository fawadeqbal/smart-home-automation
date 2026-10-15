#include "RelayDevice.h"

#include "../core/Log.h"

RelayDevice::RelayDevice(const String& key, uint8_t pin, bool activeLow) : Device(key, pin), activeLow_(activeLow) {}

RelayDevice::~RelayDevice() {
  if (!started_) return;   // built but never started (rejected config): the pin belongs to someone else
  on_ = false;
  writePin();
  pinMode(pin(), INPUT);
}

void RelayDevice::begin() {
  // Write the "off" level before making the pin an output, so the relay never clicks on at boot.
  writePin();
  pinMode(pin(), OUTPUT);
  writePin();
  started_ = true;
}

void RelayDevice::set(bool on) {
  if (on == on_) return;
  on_ = on;
  writePin();
  LOG_INFO("%s -> %s", key().c_str(), on_ ? "ON" : "OFF");
  notifyChanged();
}

void RelayDevice::writeState(JsonObject out) const {
  out["on"] = on_;
}

CommandResult RelayDevice::apply(JsonObjectConst command) {
  if (command["toggle"].is<bool>()) {
    if (command["toggle"].as<bool>()) set(!on_);
    return CommandResult::success();
  }
  if (command["on"].is<bool>()) {
    set(command["on"].as<bool>());
    return CommandResult::success();
  }
  return CommandResult::failure("expected {\"on\": true|false} or {\"toggle\": true}");
}

void RelayDevice::writePin() {
  digitalWrite(pin(), (on_ != activeLow_) ? HIGH : LOW);
}

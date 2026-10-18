// ============================================================================
//  FanDevice  -  "fan": a ceiling fan on a 3-relay capacitor regulator (the usual local smart
//  regulator). Each speed closes a set of relays: by default relay 1 alone (small capacitor),
//  relay 2 alone (bigger capacitor), both together, and relay 3 (bypass, full speed). All open = off.
//
//  State:    {"on": bool, "speed": 1..n}   (speed is kept while off, so "on" comes back at it)
//  Commands: {"on": bool} | {"toggle": true} | {"speed": 0..n} (0 = off) | {"on": true, "speed": 2}
// ============================================================================
#pragma once

#include "../core/Device.h"
#include "../core/Log.h"

class FanDevice : public Device {
 public:
  static const uint8_t MAX_SPEEDS = 6;

  /** pins[0] is the device's own pin (relay 1). combos[i] = bit mask of relays closed at speed i+1. */
  FanDevice(const String& key, const uint8_t pins[3], bool activeLow, const uint8_t* combos, uint8_t speedCount)
      : Device(key, pins[0]), activeLow_(activeLow), speedCount_(speedCount) {
    for (int i = 0; i < 3; ++i) pins_[i] = pins[i];
    for (uint8_t i = 0; i < speedCount_ && i < MAX_SPEEDS; ++i) combos_[i] = combos[i];
    speed_ = speedCount_ >= 3 ? 3 : speedCount_;   // a sensible first speed
  }

  ~FanDevice() override {
    if (!started_) return;   // never started: the pins may belong to the previous configuration
    writeRelays(0);
    for (uint8_t p : pins_) pinMode(p, INPUT);
  }

  const char* type() const override { return "fan"; }
  bool controllable() const override { return true; }
  bool isOn() const override { return on_; }

  uint8_t extraPins(uint8_t out[2]) const override {
    out[0] = pins_[1];
    out[1] = pins_[2];
    return 2;
  }

  void begin() override {
    // "off" level before each pin becomes an output, so no relay clicks at boot
    for (uint8_t p : pins_) digitalWrite(p, activeLow_ ? HIGH : LOW);
    for (uint8_t p : pins_) pinMode(p, OUTPUT);
    started_ = true;
  }

  void writeState(JsonObject out) const override {
    out["on"] = on_;
    out["speed"] = speed_;
  }

  CommandResult apply(JsonObjectConst command) override {
    bool on = on_;
    uint8_t speed = speed_;
    bool understood = false;
    if (command["speed"].is<int>()) {
      const int s = command["speed"].as<int>();
      if (s < 0 || s > speedCount_) return CommandResult::failure("speed out of range for this fan");
      if (s == 0) on = false;
      else { speed = s; on = true; }
      understood = true;
    }
    if (command["on"].is<bool>()) {
      on = command["on"].as<bool>();
      understood = true;
    }
    if (command["toggle"].is<bool>()) {
      if (command["toggle"].as<bool>()) on = !on_;
      understood = true;
    }
    if (!understood) return CommandResult::failure("expected {\"on\": true|false}, {\"toggle\": true} or {\"speed\": n}");
    set(on, speed);
    return CommandResult::success();
  }

 private:
  void set(bool on, uint8_t speed) {
    if (on == on_ && speed == speed_) return;
    const uint8_t before = on_ ? combos_[speed_ - 1] : 0;
    const uint8_t after = on ? combos_[speed - 1] : 0;
    on_ = on;
    speed_ = speed;
    if (before != after) {
      // break before make: when relays open and others close, open first and let the contacts settle
      if ((before & ~after) && (after & ~before)) {
        writeRelays(before & after);
        delay(60);
      }
      writeRelays(after);
    }
    LOG_INFO("%s -> %s (speed %u)", key().c_str(), on_ ? "ON" : "OFF", speed_);
    notifyChanged();
  }

  void writeRelays(uint8_t mask) {
    for (int i = 0; i < 3; ++i) {
      const bool closed = mask & (1 << i);
      digitalWrite(pins_[i], (closed != activeLow_) ? HIGH : LOW);
    }
  }

  uint8_t pins_[3];
  bool activeLow_;
  uint8_t combos_[MAX_SPEEDS] = {};
  uint8_t speedCount_;
  bool on_ = false;
  uint8_t speed_ = 1;
  bool started_ = false;
};

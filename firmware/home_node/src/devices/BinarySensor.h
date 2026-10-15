// On/off sensor on a digital pin: door/window reed switch, PIR motion, water leak, any contact.
// State: {"active": true|false}. Published whenever it changes (after debouncing).
#pragma once

#include "../core/Device.h"

class BinarySensor : public Device {
 public:
  BinarySensor(const String& key, uint8_t pin, bool activeLow, bool pullup, uint16_t debounceMs)
      : Device(key, pin), activeLow_(activeLow), pullup_(pullup), debounceMs_(debounceMs) {}
  ~BinarySensor() override {
    if (started_) pinMode(pin(), INPUT);
  }
  const char* type() const override { return "contact"; }
  bool controllable() const override { return false; }

  void begin() override {
    // GPIO 16 has no pull-up; the server never offers it for inputs
    pinMode(pin(), pullup_ ? INPUT_PULLUP : INPUT);
    stable_ = lastRead_ = digitalRead(pin());
    started_ = true;
    known_ = true;
    notifyChanged();
  }

  void loop() override {
    const int reading = digitalRead(pin());
    if (reading != lastRead_) {
      lastRead_ = reading;
      changedAt_ = millis();
    }
    if (reading != stable_ && millis() - changedAt_ >= debounceMs_) {
      stable_ = reading;
      notifyChanged();
    }
  }

  void writeState(JsonObject out) const override {
    if (known_) out["active"] = activeLow_ ? stable_ == LOW : stable_ == HIGH;
  }
  CommandResult apply(JsonObjectConst) override { return CommandResult::failure("a sensor cannot be switched"); }

 private:
  bool activeLow_;
  bool pullup_;
  uint16_t debounceMs_;
  bool started_ = false;
  bool known_ = false;
  int stable_ = HIGH;
  int lastRead_ = HIGH;
  uint32_t changedAt_ = 0;
};

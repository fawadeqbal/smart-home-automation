// "wall_switch": an ordinary wall switch (it stays up or down) between the pin and GND. Every flip,
// either way, toggles its switch: like a two-way staircase switch, it always works, whatever the app
// did last. Debounced in software; uses the internal pull-up.
#pragma once

#include <ArduinoJson.h>

#include "../core/Device.h"
#include "Input.h"

class WallSwitch : public Input {
 public:
  WallSwitch(uint8_t pin, Device* target, uint16_t debounceMs) : pin_(pin), target_(target), debounceMs_(debounceMs) {}
  uint8_t pin() const override { return pin_; }
  ~WallSwitch() override {
    if (started_) pinMode(pin_, INPUT);
  }

  void begin() override {
    pinMode(pin_, INPUT_PULLUP);
    // the position at start-up is just where it is: only changes count
    stable_ = lastRead_ = digitalRead(pin_);
    started_ = true;
  }

  void loop() override {
    const int reading = digitalRead(pin_);
    const uint32_t now = millis();
    if (reading != lastRead_) {
      lastRead_ = reading;
      changedAt_ = now;
    }
    if (reading != stable_ && now - changedAt_ >= debounceMs_) {
      stable_ = reading;
      if (target_ != nullptr) {
        JsonDocument cmd;
        cmd["toggle"] = true;
        target_->apply(cmd.as<JsonObjectConst>());
      }
      reportInput(pin_, "flip");
    }
  }

 private:
  uint8_t pin_;
  Device* target_;
  uint16_t debounceMs_;
  int stable_ = HIGH;
  int lastRead_ = HIGH;
  uint32_t changedAt_ = 0;
  bool started_ = false;
};

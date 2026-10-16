// "toggle_button": a momentary push-button between the pin and GND. A press toggles its switch (if it has
// one) at once. With "gestures" on, it also tells a double-press and a long press apart: a single press
// then acts when the button is released and no second press follows within GAP_MS.
// Debounced in software; uses the internal pull-up.
#pragma once

#include <ArduinoJson.h>

#include "../core/Device.h"
#include "Input.h"

class ToggleButton : public Input {
 public:
  static constexpr uint16_t GAP_MS = 350;    // a second press within this is a double-press
  static constexpr uint16_t LONG_MS = 700;   // held this long is a long press

  ToggleButton(uint8_t pin, Device* target, uint16_t debounceMs, bool gestures)
      : pin_(pin), target_(target), debounceMs_(debounceMs), gestures_(gestures) {}
  uint8_t pin() const override { return pin_; }
  ~ToggleButton() override {
    if (started_) pinMode(pin_, INPUT);
  }

  void begin() override {
    pinMode(pin_, INPUT_PULLUP);
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
      if (stable_ == LOW) pressed(now); else released(now);
    }
    if (!gestures_) return;
    // held down long enough: a long press (once per hold)
    if (stable_ == LOW && !longSent_ && now - downAt_ >= LONG_MS) {
      longSent_ = true;
      presses_ = 0;
      reportInput(pin_, "long");
    }
    // released and no second press came: a single press
    if (stable_ == HIGH && presses_ == 1 && now - upAt_ >= GAP_MS) {
      presses_ = 0;
      toggle();
      reportInput(pin_, "single");
    }
  }

 private:
  void pressed(uint32_t now) {
    if (!gestures_) {   // at once: no waiting for a second press
      toggle();
      reportInput(pin_, "single");
      return;
    }
    downAt_ = now;
    longSent_ = false;
    if (presses_ == 1 && now - upAt_ < GAP_MS) {
      presses_ = 0;
      ignoreRelease_ = true;
      reportInput(pin_, "double");
    }
  }

  void released(uint32_t now) {
    if (!gestures_) return;
    if (longSent_ || ignoreRelease_) {
      ignoreRelease_ = false;
      return;
    }
    upAt_ = now;
    presses_ = 1;
  }

  void toggle() {
    if (target_ == nullptr) return;
    JsonDocument cmd;
    cmd["toggle"] = true;
    target_->apply(cmd.as<JsonObjectConst>());
  }

  uint8_t pin_;
  Device* target_;
  uint16_t debounceMs_;
  bool gestures_;
  int stable_ = HIGH;
  int lastRead_ = HIGH;
  uint32_t changedAt_ = 0;
  uint32_t downAt_ = 0;
  uint32_t upAt_ = 0;
  uint8_t presses_ = 0;
  bool longSent_ = false;
  bool ignoreRelease_ = false;
  bool started_ = false;
};

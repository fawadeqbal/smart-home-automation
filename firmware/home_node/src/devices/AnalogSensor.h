// Analog sensor on A0: light (LDR), gas (MQ-x), soil moisture, water level, potentiometer.
// State: {"level": 0-100 (%), "raw": 0-1023}. Published when the level moves by `reportDelta` points.
#pragma once

#include "../core/Device.h"

class AnalogSensor : public Device {
 public:
  AnalogSensor(const String& key, uint8_t pin, uint32_t intervalMs, bool invert, uint8_t reportDelta)
      : Device(key, pin), intervalMs_(intervalMs), invert_(invert), reportDelta_(reportDelta) {}
  const char* type() const override { return "analog"; }
  bool controllable() const override { return false; }

  void begin() override { lastRead_ = millis() - intervalMs_ + 1000; }

  void loop() override {
    if (millis() - lastRead_ < intervalMs_) return;
    lastRead_ = millis();
    // average a few samples: the ESP8266 ADC is noisy
    uint32_t sum = 0;
    for (int i = 0; i < 8; ++i) sum += analogRead(A0);
    raw_ = sum / 8;
    int level = (int)lround(raw_ * 100.0 / 1023.0);
    if (invert_) level = 100 - level;
    if (!known_ || abs(level - level_) >= reportDelta_) {
      level_ = level;
      known_ = true;
      notifyChanged();
    }
  }

  void writeState(JsonObject out) const override {
    if (!known_) return;
    out["level"] = level_;
    out["raw"] = raw_;
  }
  CommandResult apply(JsonObjectConst) override { return CommandResult::failure("a sensor cannot be switched"); }

 private:
  uint32_t intervalMs_;
  bool invert_;
  uint8_t reportDelta_;
  uint32_t lastRead_ = 0;
  bool known_ = false;
  int level_ = 0;
  uint16_t raw_ = 0;
};

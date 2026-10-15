// ============================================================================
//  DhtSensor  -  "dht": DHT22 / DHT11 temperature and humidity sensor.
//  State: {"temperature": 25.1, "humidity": 51.0}   (no commands)
//  Wiring: VCC to 3V3, GND to GND, DATA to the pin (+ 10k pull-up to 3V3 if the
//  sensor is a bare 4-pin part; modules with 3 pins already have it).
// ============================================================================
#pragma once

#include <DHT.h>

#include "../core/Device.h"

class DhtSensor : public Device {
 public:
  DhtSensor(const String& key, uint8_t pin, uint8_t model, uint32_t intervalMs);

  const char* type() const override { return "dht"; }
  bool controllable() const override { return false; }
  void begin() override;
  void loop() override;
  void writeState(JsonObject out) const override;
  CommandResult apply(JsonObjectConst) override { return CommandResult::failure("a sensor cannot be switched"); }

 private:
  DHT dht_;
  uint32_t intervalMs_;
  uint32_t lastRead_ = 0;
  bool hasReading_ = false;
  float temperature_ = 0;
  float humidity_ = 0;
  uint8_t failures_ = 0;
};

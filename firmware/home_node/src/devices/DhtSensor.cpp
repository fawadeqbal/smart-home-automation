#include "DhtSensor.h"

#include "../core/Log.h"

namespace {
float round1(float v) { return roundf(v * 10.0f) / 10.0f; }
}  // namespace

DhtSensor::DhtSensor(const String& key, uint8_t pin, uint8_t model, uint32_t intervalMs)
    : Device(key, pin), dht_(pin, model), intervalMs_(intervalMs) {}

void DhtSensor::begin() {
  dht_.begin();
  lastRead_ = millis() - intervalMs_ + 2000;   // first reading 2 s after start (sensor warm-up)
}

void DhtSensor::loop() {
  if (millis() - lastRead_ < intervalMs_) return;
  lastRead_ = millis();
  const float h = dht_.readHumidity();
  const float t = dht_.readTemperature();
  if (isnan(h) || isnan(t)) {
    // Flaky reads are normal for DHT sensors; report only when it keeps failing.
    if (++failures_ == 3) LOG_WARN("%s: no reading from the sensor on GPIO %u (check wiring)", key().c_str(), pin());
    return;
  }
  failures_ = 0;
  temperature_ = round1(t);
  humidity_ = round1(h);
  hasReading_ = true;
  LOG_DEBUG("%s: %.1f C, %.1f %%", key().c_str(), temperature_, humidity_);
  notifyChanged();   // every reading is published: the server keeps the history
}

void DhtSensor::writeState(JsonObject out) const {
  if (!hasReading_) return;
  out["temperature"] = temperature_;
  out["humidity"] = humidity_;
}

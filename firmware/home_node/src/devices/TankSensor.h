// ============================================================================
//  TankSensor  -  "tank": water level from a JSN-SR04T waterproof ultrasonic sensor at the top of
//  the tank. TRIG on the device's pin, ECHO on echoPin (through a divider: the sensor's echo is 5 V).
//
//  State: {"level": 0-100 (%), "cm": distance to the water, "alarm": "" | "dry" | "long" | "sensor"}
//
//  When its motor is a switch on this same board (motorKey), the board looks after it by itself,
//  even without internet: off when the tank is full, and off with an alarm when the level hasn't
//  risen after dryRunMin minutes (dry well, closed valve) or the motor ran maxRunMin minutes.
//  Switching the motor on is the server's job (it knows the person's rules); a person switching it
//  on again clears the alarm.
// ============================================================================
#pragma once

#include "../core/Device.h"
#include "../core/Log.h"

class TankSensor : public Device {
 public:
  struct Settings {
    uint8_t echoPin;
    uint16_t emptyCm, fullCm;
    uint32_t intervalMs;
    String motorKey;
    uint8_t stopAtPct;
    uint16_t dryRunMin, maxRunMin;
  };

  TankSensor(const String& key, uint8_t trigPin, const Settings& s) : Device(key, trigPin), s_(s) {}
  ~TankSensor() override {
    if (!started_) return;
    pinMode(pin(), INPUT);
    pinMode(s_.echoPin, INPUT);
  }

  const char* type() const override { return "tank"; }
  bool controllable() const override { return false; }

  uint8_t extraPins(uint8_t out[2]) const override {
    out[0] = s_.echoPin;
    return 1;
  }

  void link(Device* (*find)(const String&, void*), void* ctx) override {
    motor_ = s_.motorKey.length() ? find(s_.motorKey, ctx) : nullptr;
    if (motor_ && !motor_->controllable()) motor_ = nullptr;
  }

  void begin() override {
    digitalWrite(pin(), LOW);
    pinMode(pin(), OUTPUT);
    pinMode(s_.echoPin, INPUT);
    started_ = true;
    nextSample_ = millis() + 2000;   // first reading soon after start
  }

  void loop() override {
    watchMotor();
    if ((int32_t)(millis() - nextSample_) < 0) return;
    // five pings ~70 ms apart (the sensor needs ~60 ms between pings), then the middle value
    const int cm = ping();
    if (cm > 0) samples_[sampleCount_++] = cm;
    if (++pings_ < 5) {
      nextSample_ = millis() + 70;
      return;
    }
    pings_ = 0;
    nextSample_ = millis() + s_.intervalMs;
    if (sampleCount_ < 3) {
      sampleCount_ = 0;
      if (++misses_ == 3) LOG_WARN("%s: no echo from the tank sensor (wiring, or water/foam on it?)", key().c_str());
      return;
    }
    misses_ = 0;
    const int distance = median(samples_, sampleCount_);
    sampleCount_ = 0;
    const int span = (int)s_.emptyCm - (int)s_.fullCm;
    int level = (int)lround(((int)s_.emptyCm - distance) * 100.0 / span);
    level = constrain(level, 0, 100);
    if (!known_ || abs(level - level_) >= 1 || abs(distance - cm_) >= 2) {
      known_ = true;
      level_ = level;
      cm_ = distance;
      notifyChanged();
    }
  }

  void writeState(JsonObject out) const override {
    if (!known_) return;
    out["level"] = level_;
    out["cm"] = cm_;
    out["alarm"] = alarm_;
  }
  CommandResult apply(JsonObjectConst) override { return CommandResult::failure("a sensor cannot be switched"); }

 private:
  int ping() {
    digitalWrite(pin(), LOW);
    delayMicroseconds(4);
    digitalWrite(pin(), HIGH);
    delayMicroseconds(20);   // the JSN-SR04T wants a longer trigger than the HC-SR04
    digitalWrite(pin(), LOW);
    const unsigned long us = pulseIn(s_.echoPin, HIGH, 38000UL);   // ~6.5 m round trip at most
    if (us == 0) return -1;
    const int cm = (int)(us / 58UL);
    return cm >= 20 && cm <= 650 ? cm : -1;   // the sensor's blind zone is ~20 cm
  }

  static int median(int* v, uint8_t n) {
    for (uint8_t i = 1; i < n; ++i)
      for (uint8_t j = i; j > 0 && v[j - 1] > v[j]; --j) std::swap(v[j - 1], v[j]);
    return v[n / 2];
  }

  /** Motor on this board: stop it when full, or with an alarm when it runs dry or too long. */
  void watchMotor() {
    if (!motor_) return;
    if (!motor_->isOn()) {
      runningSince_ = 0;
      return;
    }
    const uint32_t now = millis();
    if (runningSince_ == 0) {   // it just went on: a person or the server started it
      runningSince_ = now | 1;
      startLevel_ = known_ ? level_ : -1;
      if (alarm_[0]) { alarm_ = ""; if (known_) notifyChanged(); }
      return;
    }
    const uint32_t minutes = (now - runningSince_) / 60000UL;
    if (known_ && level_ >= s_.stopAtPct) return stopMotor("", "the tank is full");
    if (minutes >= s_.dryRunMin && (startLevel_ < 0 || !known_))
      return stopMotor("sensor", "the tank sensor isn't giving readings");
    if (minutes >= s_.dryRunMin && level_ < startLevel_ + 2) return stopMotor("dry", "the water level isn't rising");
    if (minutes >= s_.maxRunMin) return stopMotor("long", "it ran for too long");
  }

  void stopMotor(const char* alarm, const char* why) {
    LOG_WARN("%s: switching %s off: %s", key().c_str(), motor_->key().c_str(), why);
    {
      ChangeSource source("automation");
      JsonDocument cmd;
      cmd["on"] = false;
      motor_->apply(cmd.as<JsonObjectConst>());
    }
    runningSince_ = 0;
    alarm_ = alarm;
    if (known_) notifyChanged();
  }

  Settings s_;
  Device* motor_ = nullptr;
  bool started_ = false;
  bool known_ = false;
  int level_ = 0;
  int cm_ = 0;
  const char* alarm_ = "";
  int samples_[5] = {};
  uint8_t sampleCount_ = 0;
  uint8_t pings_ = 0;
  uint8_t misses_ = 0;
  uint32_t nextSample_ = 0;
  uint32_t runningSince_ = 0;
  int startLevel_ = -1;
};

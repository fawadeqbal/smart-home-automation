// ============================================================================
//  Device  -  the one abstraction every controllable or measuring thing implements.
//
//    writeState()  its state as JSON              {"on": true} / {"temperature": 25.1, ...}
//    apply()       a JSON command                 {"on": false} / {"toggle": true}
//    loop()        its own non-blocking work      (a sensor reading every N seconds)
//
//  Devices are created at runtime from the configuration the server sends
//  (see DeviceFactory). New kinds of devices = a new subclass + one line in the
//  factory; nothing else in the firmware changes.
// ============================================================================
#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>

class Device;

/** Observer: told whenever a device's state changes (storage, MQTT...). */
class DeviceListener {
 public:
  virtual ~DeviceListener() = default;
  virtual void onDeviceChanged(Device& device) = 0;
};

/** Result of a command; `error` always points to a constant string. */
struct CommandResult {
  bool ok;
  const char* error;
  static CommandResult success() { return {true, nullptr}; }
  static CommandResult failure(const char* why) { return {false, why}; }
};

class Device {
 public:
  Device(const String& key, uint8_t pin) : key_(key), pin_(pin) {}
  virtual ~Device() = default;

  const String& key() const { return key_; }
  uint8_t pin() const { return pin_; }

  virtual const char* type() const = 0;
  /** true for things people switch (relays); false for sensors. */
  virtual bool controllable() const = 0;

  virtual void begin() = 0;
  virtual void loop() {}

  /** Current state. Empty object when there is nothing to report yet (sensor not read). */
  virtual void writeState(JsonObject out) const = 0;
  virtual CommandResult apply(JsonObjectConst command) = 0;

  void setListener(DeviceListener* listener) { listener_ = listener; }

 protected:
  void notifyChanged() {
    if (listener_) listener_->onDeviceChanged(*this);
  }

 private:
  String key_;
  uint8_t pin_;
  DeviceListener* listener_ = nullptr;
};

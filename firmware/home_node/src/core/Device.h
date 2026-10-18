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

  /** Pins it uses besides pin() (a fan's other relays, a tank sensor's echo). Returns how many (max 2). */
  virtual uint8_t extraPins(uint8_t out[2]) const { (void)out; return 0; }
  /** true while it is switched on (relays, fans); sensors are never "on". */
  virtual bool isOn() const { return false; }
  /** Called once the whole configuration is built: a device that works with another one (the tank and
   *  its motor) finds it here. `find` returns nullptr for an unknown key. */
  virtual void link(Device* (*find)(const String& key, void* ctx), void* ctx) { (void)find; (void)ctx; }

  /** After a power cut: false = come back the way it was, true = stay off. */
  bool restoreOff() const { return restoreOff_; }
  void setRestoreOff(bool off) { restoreOff_ = off; }

  /** Who is changing devices right now, when it isn't a person ("boot" while restoring after power-on,
   *  "automation" when the board acts by itself, e.g. stopping the motor when the tank is full). */
  static const char* changeSource;

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
  bool restoreOff_ = false;
  DeviceListener* listener_ = nullptr;
};

/** Sets Device::changeSource for as long as it lives. */
struct ChangeSource {
  explicit ChangeSource(const char* src) : previous_(Device::changeSource) { Device::changeSource = src; }
  ~ChangeSource() { Device::changeSource = previous_; }
  const char* previous_;
};

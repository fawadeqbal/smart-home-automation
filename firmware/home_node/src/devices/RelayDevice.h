// ============================================================================
//  RelayDevice  -  "switch": anything switched on/off by one pin (bulb, fan, socket).
//  State: {"on": bool}     Commands: {"on": bool} or {"toggle": true}
// ============================================================================
#pragma once

#include "../core/Device.h"

class RelayDevice : public Device {
 public:
  RelayDevice(const String& key, uint8_t pin, bool activeLow);
  ~RelayDevice() override;   // switches off and releases the pin

  const char* type() const override { return "switch"; }
  bool controllable() const override { return true; }
  void begin() override;
  void writeState(JsonObject out) const override;
  CommandResult apply(JsonObjectConst command) override;

  bool isOn() const { return on_; }
  void set(bool on);

 private:
  void writePin();
  bool activeLow_;
  bool on_ = false;
  bool started_ = false;   // only a started device owns its pin
};

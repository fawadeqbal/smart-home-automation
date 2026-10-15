// ============================================================================
//  StateStore  -  remembers switch states in flash (LittleFS) so a bulb comes back
//  the way it was after a power cut. Sensors are not saved (they change every few
//  seconds and would wear the flash). Saves are delayed and grouped.
// ============================================================================
#pragma once

#include "../core/DeviceRegistry.h"

class StateStore : public DeviceListener {
 public:
  explicit StateStore(DeviceRegistry& registry) : registry_(registry) {}

  /** Applies saved states to the switches currently in the registry. */
  void restore();
  void loop();
  void onDeviceChanged(Device& device) override;

 private:
  void save();
  DeviceRegistry& registry_;
  bool restoring_ = false;
  bool dirty_ = false;
  uint32_t changedAt_ = 0;
};

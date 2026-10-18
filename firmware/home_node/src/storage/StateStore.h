// ============================================================================
//  StateStore  -  remembers switch states in flash (LittleFS) so a bulb comes back
//  the way it was after a power cut. Sensors are not saved (they change every few
//  seconds and would wear the flash). Saves are delayed and grouped.
//
//  After power-on (2.6.0+), switches come back one by one, `gapMs` apart: when the
//  electricity returns on a UPS or generator, twenty relays and motors starting in the
//  same instant can trip it. Devices set to "stay off after a power cut" stay off.
// ============================================================================
#pragma once

#include "../core/DeviceRegistry.h"

class StateStore : public DeviceListener {
 public:
  explicit StateStore(DeviceRegistry& registry) : registry_(registry) {}

  /** Applies saved states to the switches now in the registry: at power-on (`boot`) one by one and
   *  honouring "stay off"; after a configuration change all at once, exactly as they were. */
  void restore(bool boot, uint32_t gapMs);
  void loop();
  void onDeviceChanged(Device& device) override;
  /** true while switches are still coming back after power-on. */
  bool restoring() const { return pendingCount_ > 0; }

 private:
  void save();
  void load();
  bool differs(Device& device, JsonObjectConst saved) const;
  DeviceRegistry& registry_;
  JsonDocument saved_;          // the last saved states (what each switch should come back to)
  bool loaded_ = false;
  bool applying_ = false;
  bool dirty_ = false;
  uint32_t changedAt_ = 0;
  String pending_[MAX_DEVICES];  // keys still to come back, in order
  size_t pendingCount_ = 0;
  size_t pendingNext_ = 0;
  uint32_t gapMs_ = 0;
  uint32_t nextAt_ = 0;
};

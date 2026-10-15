// ============================================================================
//  DeviceRegistry  -  owns the devices currently configured on this board.
//
//  replaceAll() swaps the whole set at once: the new devices are built and
//  checked first, so a bad configuration never leaves the board half-configured.
//  Change events from any device are forwarded to every listener (Observer).
// ============================================================================
#pragma once

#include <memory>

#include "../../config.h"
#include "Device.h"

class DeviceRegistry : public DeviceListener {
 public:
  using DevicePtr = std::unique_ptr<Device>;

  /** Takes ownership of `count` devices; the old ones are destroyed (pins released). */
  void replaceAll(DevicePtr* devices, size_t count);

  bool addListener(DeviceListener& listener);

  Device* find(const String& key) const;
  size_t count() const { return count_; }
  Device& at(size_t i) const { return *devices_[i]; }

  void loopAll();
  void onDeviceChanged(Device& device) override;

 private:
  DevicePtr devices_[MAX_DEVICES];
  size_t count_ = 0;
  DeviceListener* listeners_[4] = {};
  size_t listenerCount_ = 0;
};

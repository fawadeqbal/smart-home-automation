#include "DeviceRegistry.h"

#include "Log.h"

const char* Device::changeSource = nullptr;

void DeviceRegistry::replaceAll(DevicePtr* devices, size_t count) {
  for (size_t i = 0; i < count_; ++i) devices_[i].reset();   // destructors release the pins
  count_ = 0;
  for (size_t i = 0; i < count && i < MAX_DEVICES; ++i) {
    devices_[i] = std::move(devices[i]);
    devices_[i]->setListener(this);
    devices_[i]->begin();
    LOG_INFO("Device ready: %s (%s) on GPIO %u", devices_[i]->key().c_str(), devices_[i]->type(), devices_[i]->pin());
    count_++;
  }
}

bool DeviceRegistry::addListener(DeviceListener& listener) {
  if (listenerCount_ >= 4) return false;
  listeners_[listenerCount_++] = &listener;
  return true;
}

Device* DeviceRegistry::find(const String& key) const {
  for (size_t i = 0; i < count_; ++i) {
    if (devices_[i]->key() == key) return devices_[i].get();
  }
  return nullptr;
}

void DeviceRegistry::loopAll() {
  for (size_t i = 0; i < count_; ++i) devices_[i]->loop();
}

void DeviceRegistry::onDeviceChanged(Device& device) {
  for (size_t i = 0; i < listenerCount_; ++i) listeners_[i]->onDeviceChanged(device);
}

#include "ConfigManager.h"

#include "../core/Log.h"
#include "../devices/DeviceFactory.h"
#include "../storage/Files.h"

namespace {

struct Building {
  DeviceRegistry::DevicePtr* devices;
  size_t count;
};

Device* findIn(const String& key, void* ctx) {
  Building* b = static_cast<Building*>(ctx);
  for (size_t i = 0; i < b->count; ++i) {
    if (b->devices[i]->key() == key) return b->devices[i].get();
  }
  return nullptr;
}

}  // namespace

void ConfigManager::begin() {
  JsonDocument doc;
  if (!Files::readJson(Files::CONFIG, doc)) {
    LOG_INFO("No saved configuration yet: waiting for the server");
    return;
  }
  String error;
  if (apply(doc.as<JsonObjectConst>(), error, false)) {
    LOG_INFO("Saved configuration rev %d loaded (%u devices)", rev_, (unsigned)registry_.count());
  } else {
    LOG_WARN("Saved configuration ignored: %s", error.c_str());
  }
}

bool ConfigManager::apply(JsonObjectConst config, String& error, bool save) {
  JsonArrayConst deviceList = config["devices"];
  JsonArrayConst inputList = config["inputs"];
  if (deviceList.size() > MAX_DEVICES) {
    error = "too many devices for one board (max " + String(MAX_DEVICES) + ")";
    return false;
  }
  if (inputList.size() > MAX_INPUTS) {
    error = "too many buttons for one board (max " + String(MAX_INPUTS) + ")";
    return false;
  }

  // 1. Build everything aside, checking as we go.
  DeviceRegistry::DevicePtr devices[MAX_DEVICES];
  std::unique_ptr<Input> inputs[MAX_INPUTS];
  bool pinUsed[17] = {};
  size_t deviceCount = 0, inputCount = 0;

  auto claimPin = [&](int pin) -> bool {
    if (pin < 0 || pin > 16 || pinUsed[pin]) {
      error = "GPIO " + String(pin) + " is used twice";
      return false;
    }
    pinUsed[pin] = true;
    return true;
  };

  for (JsonObjectConst entry : deviceList) {
    std::unique_ptr<Device> device = DeviceFactory::createDevice(entry, error);
    if (!device || !claimPin(device->pin())) return false;
    uint8_t extra[2];
    const uint8_t n = device->extraPins(extra);
    for (uint8_t i = 0; i < n; ++i) if (!claimPin(extra[i])) return false;
    device->setRestoreOff(String(entry["restore"] | "last") == "off");
    devices[deviceCount++] = std::move(device);
  }
  Building building{devices, deviceCount};
  for (size_t i = 0; i < deviceCount; ++i) devices[i]->link(findIn, &building);
  for (JsonObjectConst entry : inputList) {
    if (!claimPin(entry["pin"] | -1)) return false;
    std::unique_ptr<Input> input = DeviceFactory::createInput(entry, findIn, &building, error);
    if (!input) return false;
    inputs[inputCount++] = std::move(input);
  }

  // 2. All good: swap the old set for the new one.
  for (size_t i = 0; i < inputCount_; ++i) inputs_[i].reset();   // buttons first: they point at devices
  inputCount_ = 0;
  registry_.replaceAll(devices, deviceCount);
  for (size_t i = 0; i < inputCount; ++i) {
    inputs_[i] = std::move(inputs[i]);
    inputs_[i]->begin();
  }
  inputCount_ = inputCount;
  restoreGapMs_ = constrain((int)(config["restoreGapMs"] | 1500), 0, 10000);
  // at power-on: switches come back one by one, and "stay off" ones stay off; after a change from
  // the server: everything stays as it was
  states_.restore(!started_, restoreGapMs_);
  started_ = true;

  rev_ = config["rev"] | 0;
  adopted_ = config["adopted"] | false;
  telemetrySec_ = constrain((int)(config["telemetrySec"] | 60), 10, 3600);

  currentJson_ = "";
  serializeJson(config, currentJson_);
  if (save) {
    JsonDocument copy;
    copy.set(config);
    Files::writeJson(Files::CONFIG, copy);
  }
  return true;
}

bool ConfigManager::isCurrent(JsonObjectConst config) const {
  String text;
  serializeJson(config, text);
  return text == currentJson_;
}

void ConfigManager::loopInputs() {
  for (size_t i = 0; i < inputCount_; ++i) inputs_[i]->loop();
}

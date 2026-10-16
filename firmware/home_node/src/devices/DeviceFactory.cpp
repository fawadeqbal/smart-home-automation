#include "DeviceFactory.h"

#include <DHT.h>

#include "../config/BoardPins.h"
#include "../inputs/ToggleButton.h"
#include "../inputs/WallSwitch.h"
#include "AnalogSensor.h"
#include "BinarySensor.h"
#include "DhtSensor.h"
#include "RelayDevice.h"

namespace {

bool validKey(const String& key) {
  if (key.length() == 0 || key.length() > 48) return false;
  for (size_t i = 0; i < key.length(); ++i) {
    const char c = key[i];
    if (!(isLowerCase(c) || isDigit(c) || c == '_' || c == '-')) return false;
  }
  return true;
}

bool checkPin(int pin, BoardPins::Use use, String& error) {
  if (BoardPins::allowed(pin, use)) return true;
  error = "GPIO " + String(pin) + " cannot be used for that on this board";
  return false;
}

}  // namespace

namespace DeviceFactory {

std::unique_ptr<Device> createDevice(JsonObjectConst entry, String& error) {
  const String key = entry["key"] | "";
  const String type = entry["type"] | "";
  const int pin = entry["pin"] | -1;
  JsonObjectConst settings = entry["settings"];

  if (!validKey(key)) {
    error = "invalid device key '" + key + "'";
    return nullptr;
  }
  if (type == "switch") {
    if (!checkPin(pin, BoardPins::OUTPUT_USE, error)) return nullptr;
    return std::unique_ptr<Device>(new RelayDevice(key, pin, entry["activeLow"] | false));
  }
  if (type == "dht") {
    if (!checkPin(pin, BoardPins::SENSOR_USE, error)) return nullptr;
    const String model = settings["model"] | "dht22";
    const uint32_t interval = constrain((int)(settings["intervalSec"] | 30), 5, 3600);
    return std::unique_ptr<Device>(new DhtSensor(key, pin, model == "dht11" ? DHT11 : DHT22, interval * 1000UL));
  }
  if (type == "contact") {
    if (!checkPin(pin, BoardPins::INPUT_USE, error)) return nullptr;
    return std::unique_ptr<Device>(new BinarySensor(key, pin, entry["activeLow"] | true, settings["pullup"] | true,
                                                    constrain((int)(settings["debounceMs"] | 50), 5, 2000)));
  }
  if (type == "analog") {
#if MEASURE_SUPPLY_VOLTAGE
    error = "A0 is measuring the board's supply voltage (set MEASURE_SUPPLY_VOLTAGE 0 in config.h to use it)";
    return nullptr;
#endif
    if (!checkPin(pin, BoardPins::ANALOG_USE, error)) return nullptr;
    const uint32_t interval = constrain((int)(settings["intervalSec"] | 10), 1, 3600);
    return std::unique_ptr<Device>(new AnalogSensor(key, pin, interval * 1000UL, settings["invert"] | false,
                                                    constrain((int)(settings["reportDelta"] | 2), 0, 50)));
  }
  error = "unknown device type '" + type + "' (update the firmware?)";
  return nullptr;
}

std::unique_ptr<Input> createInput(JsonObjectConst entry, Device* (*findTarget)(const String&, void*), void* ctx,
                                   String& error) {
  const String type = entry["type"] | "";
  const int pin = entry["pin"] | -1;
  if (type == "toggle_button" || type == "wall_switch") {
    if (!checkPin(pin, BoardPins::INPUT_USE, error)) return nullptr;
    // its own switch on this board (optional: a button may only run actions through the server)
    const String targetKey = entry["target"] | "";
    Device* target = targetKey.length() ? findTarget(targetKey, ctx) : nullptr;
    if (targetKey.length() && (target == nullptr || !target->controllable())) {
      error = "input on GPIO " + String(pin) + " must target a switch on this board";
      return nullptr;
    }
    if (type == "wall_switch") {
      const uint16_t debounce = constrain((int)(entry["settings"]["debounceMs"] | 60), 5, 500);
      return std::unique_ptr<Input>(new WallSwitch(pin, target, debounce));
    }
    const uint16_t debounce = constrain((int)(entry["settings"]["debounceMs"] | 40), 5, 500);
    return std::unique_ptr<Input>(new ToggleButton(pin, target, debounce, entry["settings"]["gestures"] | false));
  }
  error = "unknown input type '" + type + "'";
  return nullptr;
}

}  // namespace DeviceFactory

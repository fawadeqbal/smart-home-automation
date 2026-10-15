// ============================================================================
//  DeviceFactory  -  turns one entry of the server's configuration into an object.
//
//    {"key":"bulb","type":"switch","pin":5,"activeLow":true}          -> RelayDevice
//    {"key":"climate","type":"dht","pin":4,"settings":{"model":"dht22","intervalSec":30}} -> DhtSensor
//    {"type":"toggle_button","pin":14,"target":"bulb"}                 -> ToggleButton
//
//  To support a new kind of device: write its class, add one `if` below, and add the type
//  to packages/contracts/src/device-types.ts. Nothing else changes.
// ============================================================================
#pragma once

#include <ArduinoJson.h>
#include <memory>

#include "../core/DeviceRegistry.h"
#include "../inputs/Input.h"

namespace DeviceFactory {

/** nullptr + `error` set when the entry is invalid (unknown type, forbidden pin...). */
std::unique_ptr<Device> createDevice(JsonObjectConst entry, String& error);

/** `findTarget` looks a device up by key among the devices being built. */
std::unique_ptr<Input> createInput(JsonObjectConst entry, Device* (*findTarget)(const String&, void*), void* ctx,
                                   String& error);

}  // namespace DeviceFactory

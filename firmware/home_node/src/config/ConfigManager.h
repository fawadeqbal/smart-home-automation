// ============================================================================
//  ConfigManager  -  applies the configuration the server sends (devices, pins,
//  wall buttons), and keeps it in flash so the board works after a reboot even
//  when the server or Wi-Fi is down.
//
//  apply() checks everything first (types, allowed pins, no pin used twice,
//  button targets) and only then swaps the new devices in. On any error the
//  board keeps its previous configuration and reports why.
// ============================================================================
#pragma once

#include <memory>

#include "../core/DeviceRegistry.h"
#include "../inputs/Input.h"
#include "../storage/StateStore.h"

class ConfigManager {
 public:
  ConfigManager(DeviceRegistry& registry, StateStore& states) : registry_(registry), states_(states) {}

  /** Loads the configuration saved in flash (call once at start-up). */
  void begin();

  /** Validates and applies a configuration. false + `error` when rejected (nothing changed). */
  bool apply(JsonObjectConst config, String& error, bool save = true);

  void loopInputs();

  /** true when this exact configuration is already running (no need to rebuild or rewrite flash). */
  bool isCurrent(JsonObjectConst config) const;

  int rev() const { return rev_; }
  bool adopted() const { return adopted_; }
  uint32_t telemetrySec() const { return telemetrySec_; }

  /** true when a device or input of the running configuration uses this GPIO. */
  bool pinInUse(uint8_t gpio) const {
    for (size_t i = 0; i < registry_.count(); ++i) if (registry_.at(i).pin() == gpio) return true;
    for (size_t i = 0; i < inputCount_; ++i) if (inputs_[i] && inputs_[i]->pin() == gpio) return true;
    return false;
  }

 private:
  DeviceRegistry& registry_;
  StateStore& states_;
  std::unique_ptr<Input> inputs_[MAX_INPUTS];
  size_t inputCount_ = 0;
  int rev_ = -1;
  bool adopted_ = false;
  uint32_t telemetrySec_ = 60;
  String currentJson_;   // the configuration now running, as JSON text
};

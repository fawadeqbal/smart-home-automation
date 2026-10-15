// ============================================================================
//  MqttBridge  -  the board's only link to the server.
//
//    * connects to the broker (plain on your PC, TLS in the cloud) with a Last Will,
//      so the server learns at once when the board disappears
//    * announces itself, receives its configuration, executes commands, and echoes
//      each command's id in the state it publishes (the server's acknowledgement)
//    * publishes every state change (wall button, sensor reading) as a DeviceListener
//    * reconnects with growing back-off; nothing here ever blocks the main loop
// ============================================================================
#pragma once

#include <BearSSLHelpers.h>
#include <ESP8266WiFi.h>
#include <PubSubClient.h>
#include <WiFiClientSecureBearSSL.h>

#include "../config/ConfigManager.h"
#include "../config/NodeSettings.h"
#include "../core/DeviceRegistry.h"
#include "Topics.h"
#include "WifiSwitch.h"

class MqttBridge : public DeviceListener {
 public:
  MqttBridge(DeviceRegistry& registry, ConfigManager& config) : registry_(registry), config_(config) {}

  void begin(const NodeSettings& settings);
  void loop();
  bool connected() { return mqtt_.connected(); }

  void onDeviceChanged(Device& device) override;

 private:
  bool connect();
  void reportNetwork();
  WifiSwitch wifiSwitch_;
  void runOta();
  String otaUrl_, otaVersion_;
  bool scanning_ = false;
  uint16_t connects_ = 0;   // successful connections since boot (more than 1 = it dropped)
  void onMessage(char* topic, uint8_t* payload, unsigned int length);
  void handleConfig(JsonObjectConst config);
  void handleSet(const String& key, JsonObjectConst command);
  void handleCmd(JsonObjectConst cmd);
  void publishState(Device& device, const char* src, const char* cid = nullptr);
  void publishAllStates(const char* src);
  void publishTelemetry();
  void flushLogs();
  bool publishJson(const String& topic, const JsonDocument& doc, bool retained);
  bool clockReady();

  DeviceRegistry& registry_;
  ConfigManager& config_;
  const NodeSettings* settings_ = nullptr;
  Topics* topics_ = nullptr;

  WiFiClient plain_;
  BearSSL::WiFiClientSecure secure_;
  BearSSL::X509List* trustAnchor_ = nullptr;
  PubSubClient mqtt_;

  bool everConnected_ = false;
  bool changedWhileOffline_ = false;
  bool quiet_ = false;            // while applying a config or a command: we publish explicitly
  uint32_t nextAttempt_ = 0;
  uint32_t backoff_ = 1000;
  uint32_t lastTelemetry_ = 0;
  uint32_t rebootAt_ = 0;
};

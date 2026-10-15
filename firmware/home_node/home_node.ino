// ============================================================================
//  home_node.ino  -  ESP8266 firmware for the home platform (version 2).
//
//  One firmware for every board. Nothing about your home is compiled in:
//    * Wi-Fi and the server address/login: typed into the board's setup page
//    * devices, pins, wall buttons: set in the web app, sent over MQTT,
//      checked, applied, and kept in flash
//
//  This file is the composition root: it creates the parts and wires them.
//    src/core/      Device interface, DeviceRegistry, logging
//    src/devices/   RelayDevice ("switch"), DhtSensor ("dht"), DeviceFactory
//    src/inputs/    ToggleButton ("toggle_button")
//    src/config/    NodeSettings (setup page), ConfigManager (config from the server), BoardPins
//    src/storage/   StateStore (switch states across power cuts), Files
//    src/net/       MqttBridge (the link to the server), Topics, CaCert (cloud TLS)
//
//  Board:     Tools > Board > "NodeMCU 1.0 (ESP-12E Module)" or "LOLIN(WEMOS) D1 R2 & mini"
//  Libraries: ArduinoJson 7, PubSubClient, WiFiManager (tzapu), DHT sensor library + Adafruit Unified Sensor
// ============================================================================
#include <ESP8266WiFi.h>

#include "config.h"
#include "src/config/ConfigManager.h"
#include "src/config/NodeSettings.h"
#include "src/core/DeviceRegistry.h"
#include "src/core/Log.h"
#include "src/net/MqttBridge.h"
#include "src/storage/Files.h"
#include "src/storage/StateStore.h"

#if MEASURE_SUPPLY_VOLTAGE
ADC_MODE(ADC_VCC);   // ESP.getVcc() reads the 3.3 V rail; A0 is not available for sensors
#endif

DeviceRegistry registry;
StateStore states(registry);
ConfigManager config(registry, states);
NodeSettings settings;

// The web app reads this marker from an uploaded .bin to learn its version (the number this board will
// report after installing it). Stored at start-up through a volatile pointer so the linker keeps it.
const char FIRMWARE_TAG[] = "@@HOMENODE-FW:" FIRMWARE_VERSION "@@";
const char* volatile firmwareTag = nullptr;
MqttBridge bridge(registry, config);

// ---------------------------------------------------------------- status LED
void led(bool on) {
#if STATUS_LED_PIN >= 0
  if (config.pinInUse(STATUS_LED_PIN)) return;   // D4 given to a device or button: leave it alone
  digitalWrite(STATUS_LED_PIN, on ? LOW : HIGH);   // built-in LED is active LOW
#endif
}

void blinkStatus() {
#if STATUS_LED_PIN >= 0
  static uint32_t last = 0;
  static bool on = false;
  if (bridge.connected()) {
    if (on) led(on = false);
    return;
  }
  if (millis() - last >= (WiFi.status() == WL_CONNECTED ? 1000UL : 250UL)) {
    last = millis();
    led(on = !on);
  }
#endif
}

/** Fast blink for a few seconds after power-on; holding FLASH meanwhile opens the setup page. */
bool setupRequested() {
  pinMode(SETUP_BUTTON_PIN, INPUT_PULLUP);
  const uint32_t start = millis();
  while (millis() - start < SETUP_WINDOW_MS) {
    led((millis() / 100) % 2);
    if (digitalRead(SETUP_BUTTON_PIN) == LOW) {
      delay(50);
      if (digitalRead(SETUP_BUTTON_PIN) == LOW) return true;
    }
    delay(10);
  }
  led(false);
  return false;
}

void setup() {
#if LOG_ENABLED
  Serial.begin(SERIAL_BAUD, SERIAL_8N1, SERIAL_TX_ONLY);   // RX (GPIO 3) stays free for a sensor or button
  Serial.println();
#endif
#if STATUS_LED_PIN >= 0
  pinMode(STATUS_LED_PIN, OUTPUT);
  led(false);
#endif
  firmwareTag = FIRMWARE_TAG;
  Files::begin();
  settings.begin();
  LOG_INFO("Home node %s, firmware %s, board %s", settings.nodeId().c_str(), FIRMWARE_VERSION, BOARD_TYPE);

  // 1. Devices from the saved configuration: lights and wall buttons work before Wi-Fi is up.
  registry.addListener(states);
  registry.addListener(bridge);
  config.begin();

  // 2. Setup page when nothing is configured yet, or FLASH is held after power-on.
  WiFi.persistent(true);   // WiFiManager stores the Wi-Fi in the SDK's flash area
  WiFi.mode(WIFI_STA);
  if (!settings.configured() || WiFi.SSID().length() == 0 || setupRequested()) {
    settings.runSetupPortal();
  }

  // 3. Wi-Fi (non-blocking: the SDK keeps reconnecting by itself) and the server link.
  WiFi.hostname(settings.nodeId());
  WiFi.setAutoReconnect(true);
  WiFi.begin();
  bridge.begin(settings);
}

void loop() {
  config.loopInputs();
  registry.loopAll();
  states.loop();
  bridge.loop();
  blinkStatus();
}

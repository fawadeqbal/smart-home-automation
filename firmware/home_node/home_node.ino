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
//    src/devices/   RelayDevice ("switch"), FanDevice ("fan"), TankSensor ("tank"), DhtSensor ("dht"), DeviceFactory
//    src/inputs/    ToggleButton ("toggle_button", with double-press and long press), WallSwitch ("wall_switch")
//    src/config/    NodeSettings (setup page), ConfigManager (config from the server), BoardPins
//    src/storage/   StateStore (switch states across power cuts, back one by one), Files
//    src/net/       MqttBridge (the link to the server), Topics, CaCert (cloud TLS),
//                   LocalServer + LocalAuth (the phone app straight over Wi-Fi, without internet)
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
#include "src/net/LocalServer.h"
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
LocalServer local(registry);   // the phone app over the home's Wi-Fi, even without internet

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

/**
 * FLASH held for SETUP_HOLD_MS while the board runs: open the setup page, no RST timing needed.
 * While it is held the LED blinks fast ("keep holding"); at 5 s it stays on and the hotspot opens.
 * Returns true while the button is being held, so the normal status blink stays out of the way.
 * Off when a wall button uses GPIO 0 (someone holding that button must not open the setup page).
 */
bool checkSetupHold() {
  static uint32_t downSince = 0;
  static bool pulled = false;
  if (config.pinInUse(SETUP_BUTTON_PIN)) { downSince = 0; pulled = false; return false; }
  if (!pulled) { pinMode(SETUP_BUTTON_PIN, INPUT_PULLUP); pulled = true; }
  if (digitalRead(SETUP_BUTTON_PIN) == HIGH) { downSince = 0; return false; }
  const uint32_t now = millis();
  if (downSince == 0) { downSince = now | 1; return true; }
  const uint32_t held = now - downSince;
  if (held < 600) return true;                  // a tap does nothing
  if (held < SETUP_HOLD_MS) { led((now / 80) % 2); return true; }
  led(true);
  LOG_INFO("FLASH held for %lu s: opening the setup page", (unsigned long)(SETUP_HOLD_MS / 1000));
  local.stop();                                 // the setup page needs port 80
  settings.runSetupPortal();                    // blocks until saved or it times out (then it restarts)
  ESP.restart();                                // start cleanly with the new settings
  return true;
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
  bridge.setLocal(local);
  bridge.begin(settings);
  local.begin(settings.nodeId());
}

void loop() {
  config.loopInputs();
  registry.loopAll();
  states.loop();
  bridge.loop();
  local.loop();
  if (!checkSetupHold()) blinkStatus();
}

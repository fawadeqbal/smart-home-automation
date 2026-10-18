// ============================================================================
//  config.h  -  Settings compiled into the firmware. The same firmware runs on
//  every board: Wi-Fi and the server are entered on the board's setup page,
//  and its devices and pins come from the web app over MQTT.
// ============================================================================
#pragma once

// Raise this for every build you upload in the web app (Board → Firmware). It is stamped into the
// .bin, the web app reads it from the file, and the board reports it after installing — so a build
// with the same number as the old one looks like "nothing changed".
#define FIRMWARE_VERSION      "2.6.3"

// The board type reported to the server. Must match packages/contracts/src/boards.ts:
//   "NODEMCU_V2"  or  "WEMOS_D1_MINI"  (both have the same usable pins)
#define BOARD_TYPE            "NODEMCU_V3"   // NODEMCU_V3 (black LoLin), NODEMCU_V2 (Amica) or WEMOS_D1_MINI

// ---------- Setup page
// Opens the setup page (Wi-Fi + server) as the hotspot HomeNode-xxxxxx:
//   * hold the FLASH button (GPIO 0) for SETUP_HOLD_MS at any time while the board runs (2.3.0+), or
//   * hold it during the first 3 seconds after power-on (press it AFTER releasing RST: FLASH held
//     while the board resets starts the chip's programming mode instead), or
//   * by itself when nothing is configured yet.
// The long press is off when a wall button is wired to D3 (GPIO 0).
#define SETUP_BUTTON_PIN      0
#define SETUP_WINDOW_MS       3000UL
#define SETUP_HOLD_MS         5000UL   // long press while running
#define SETUP_PORTAL_TIMEOUT  300      // seconds, then the board restarts
#define SETUP_AP_PREFIX       "HomeNode-"

// ---------- MQTT
#define MQTT_DEFAULT_PORT     1883
#define MQTT_KEEPALIVE_SEC    15       // broker declares the board offline after ~1.5x this
#define MQTT_BUFFER_BYTES     2048     // largest message (the configuration)
#define MQTT_RETRY_MIN_MS     1000UL
#define MQTT_RETRY_MAX_MS     60000UL

// ---------- Capacity (fixed, so memory use is predictable)
#define MAX_DEVICES           12
#define MAX_INPUTS            8

// ---------- Flash wear: switch states are saved at most this often
#define STATE_SAVE_DELAY_MS   3000UL

// ---------- Status LED (built-in, active LOW). -1 to disable.
// Fast blink: setup window / portal. Slow blink: connecting. Off: connected.
#define STATUS_LED_PIN        2

// The board measures its own 3.3 V supply through the ADC (shown in the web app).
// The ESP8266 has one ADC: while this is 1, A0 cannot read an analog sensor. Set 0 to use A0.
#define MEASURE_SUPPLY_VOLTAGE 1

// ---------- Logging to the Serial Monitor (115200 baud). 0 = silent.
#define LOG_ENABLED           1
#define SERIAL_BAUD           115200

// ---------- Live logs in the web app (Boards > Logs), sent over MQTT
#define REMOTE_LOGS           1
#define REMOTE_LOG_MIN_LEVEL  0        // 0 debug (includes every sensor reading), 1 info, 2 warnings, 3 errors
#define LOG_QUEUE_LINES       16       // lines kept while offline (oldest dropped beyond this)
#define LOG_LINE_MAX          112      // characters per line

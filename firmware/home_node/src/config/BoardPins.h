// Which GPIOs may be used for what. Same rules as packages/contracts/src/boards.ts (the server
// checks first; the board checks again so a wrong config can never drive a dangerous pin).
//   not allowed: 1 (TX, logs), 6-11 (flash chip). GPIO 3 (RX) is free because Serial runs transmit-only.
//   17 = A0, the analog input.
#pragma once

#include <Arduino.h>

namespace BoardPins {

enum Use : uint8_t { OUTPUT_USE = 1, INPUT_USE = 2, SENSOR_USE = 4, ANALOG_USE = 8 };

struct Pin {
  uint8_t gpio;
  uint8_t uses;
};

static const Pin PINS[] = {
    {5, OUTPUT_USE | INPUT_USE | SENSOR_USE},    // D1
    {4, OUTPUT_USE | INPUT_USE | SENSOR_USE},    // D2
    {14, OUTPUT_USE | INPUT_USE | SENSOR_USE},   // D5
    {12, OUTPUT_USE | INPUT_USE | SENSOR_USE},   // D6
    {13, OUTPUT_USE | INPUT_USE | SENSOR_USE},   // D7
    {16, OUTPUT_USE},                            // D0: no pull-up
    {15, OUTPUT_USE},                            // D8: pulled LOW at boot, output only
    {0, INPUT_USE},                              // D3: boot pin
    {2, OUTPUT_USE | INPUT_USE},                 // D4: boot pin + LED (the LED stops when used)
    {3, INPUT_USE | SENSOR_USE},                 // RX: free, Serial is transmit-only
    {17, ANALOG_USE},                            // A0: analog 0-1 V (0-3.3 V on NodeMCU/D1 mini)
};

inline bool allowed(int gpio, Use use) {
  for (const Pin& p : PINS) {
    if (p.gpio == gpio) return (p.uses & use) != 0;
  }
  return false;
}

}  // namespace BoardPins

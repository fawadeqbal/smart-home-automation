// Local inputs act on devices directly (no Wi-Fi needed): a wall push-button or an ordinary wall switch.
// They also report what happened (a press, a double-press, a long press, a flip) so the server can do more.
#pragma once

#include <Arduino.h>

/** Set by the MQTT bridge: tells the server about a press or flip (dropped while offline). */
using InputEventHandler = void (*)(uint8_t pin, const char* gesture);
extern InputEventHandler inputEventHandler;

inline void reportInput(uint8_t pin, const char* gesture) {
  if (inputEventHandler) inputEventHandler(pin, gesture);
}

class Input {
 public:
  virtual ~Input() = default;
  virtual void begin() = 0;
  virtual void loop() = 0;   // must never block
  virtual uint8_t pin() const { return 255; }
};

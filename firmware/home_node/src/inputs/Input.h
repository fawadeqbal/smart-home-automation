// Local inputs act on devices directly (no Wi-Fi needed): a wall push-button, later a motion sensor.
#pragma once

#include <Arduino.h>

class Input {
 public:
  virtual ~Input() = default;
  virtual void begin() = 0;
  virtual void loop() = 0;   // must never block
  virtual uint8_t pin() const { return 255; }
};

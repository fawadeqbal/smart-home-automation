// Moves the board to another Wi-Fi network on request from the web app, safely:
// it remembers the network it is on, tries the new one for up to 30 s, keeps it when it works
// and goes back to the old one when it does not (wrong password, out of range...).
// The outcome is kept until the server connection is back, then reported on .../network.
#pragma once

#include <ESP8266WiFi.h>

#include "../core/Log.h"

class WifiSwitch {
 public:
  static constexpr uint32_t TRY_MS = 30000;

  /** Starts a change. Returns false (with a reason) when the request is not usable. */
  bool start(const String& ssid, const String& password, String& why) {
    if (busy()) { why = "a Wi-Fi change is already in progress"; return false; }
    if (ssid.length() == 0 || ssid.length() > 32) { why = "invalid network name"; return false; }
    if (password.length() > 0 && password.length() < 8) { why = "password too short"; return false; }
    oldSsid_ = WiFi.SSID();
    oldPass_ = WiFi.psk();
    newSsid_ = ssid;
    LOG_INFO("Switching Wi-Fi from \"%s\" to \"%s\"...", oldSsid_.c_str(), ssid.c_str());
    WiFi.persistent(false);        // don't save until it worked
    WiFi.disconnect();
    WiFi.begin(ssid.c_str(), password.c_str());
    newPass_ = password;
    phase_ = TRYING;
    startedAt_ = millis();
    return true;
  }

  void loop() {
    if (phase_ == TRYING) {
      if (WiFi.status() == WL_CONNECTED && WiFi.SSID() == newSsid_) {
        WiFi.persistent(true);     // now save it in flash for the next start
        WiFi.begin(newSsid_.c_str(), newPass_.c_str());
        finish(true, "connected, signal " + String(WiFi.RSSI()) + " dBm");
      } else if (millis() - startedAt_ > TRY_MS) {
        const wl_status_t st = WiFi.status();
        const String why = st == WL_NO_SSID_AVAIL ? "network not found" : st == WL_WRONG_PASSWORD ? "wrong password" : "could not connect";
        LOG_WARN("Could not join \"%s\" (%s): going back to \"%s\"", newSsid_.c_str(), why.c_str(), oldSsid_.c_str());
        WiFi.persistent(false);
        WiFi.disconnect();
        WiFi.begin(oldSsid_.c_str(), oldPass_.c_str());
        WiFi.persistent(true);
        finish(false, why + " - stayed on \"" + oldSsid_ + "\"");
      }
    }
  }

  bool busy() const { return phase_ == TRYING; }

  /** A finished change not reported yet: fills ok/ssid/message and forgets it. */
  bool takeResult(bool& ok, String& ssid, String& message) {
    if (phase_ != DONE) return false;
    ok = ok_; ssid = newSsid_; message = message_;
    phase_ = IDLE;
    newPass_ = ""; oldPass_ = "";
    return true;
  }

 private:
  void finish(bool ok, const String& message) {
    ok_ = ok;
    message_ = message;
    phase_ = DONE;
    if (ok) LOG_INFO("Now on Wi-Fi \"%s\" (%s)", newSsid_.c_str(), message.c_str());
  }

  enum Phase : uint8_t { IDLE, TRYING, DONE } phase_ = IDLE;
  String oldSsid_, oldPass_, newSsid_, newPass_, message_;
  bool ok_ = false;
  uint32_t startedAt_ = 0;
};

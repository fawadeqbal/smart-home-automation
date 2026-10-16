// ============================================================================
//  LocalServer  -  the phone app switches this board straight over the home's
//  Wi-Fi, with no server in between (local control, firmware 2.5.0+). Works
//  while the internet is down, as long as the board and the phone share a
//  Wi-Fi network.
//
//    GET  /local/hello     {"id", "fw", "local": has a key, "nonce"}  (no pass needed)
//    POST /local/state     the devices the pass may see, with their state
//    POST /local/command   {"key": "bulb", "on": true} or {"key": "bulb", "toggle": true}
//
//  Every POST carries X-Pass, X-Nonce and X-Sig, checked by LocalAuth. The key
//  and epoch come from the server over MQTT (cmd "local") and are kept in flash.
//  The board also answers to <node id>.local (mDNS), so the app finds it when
//  its address changed.
// ============================================================================
#pragma once

#include <ESP8266WebServer.h>

#include "../core/DeviceRegistry.h"
#include "LocalAuth.h"

class BearSslHasher : public Hasher {
 public:
  void sha256(const void* data, size_t len, uint8_t out[32]) override;
  void hmac(const void* key, size_t keyLen, const void* const* parts, const size_t* lens, size_t count,
            uint8_t out[32]) override;
};

class LocalServer {
 public:
  explicit LocalServer(DeviceRegistry& registry) : registry_(registry), auth_(hasher_), server_(80) {}

  void begin(const String& nodeId);
  void loop();
  /** Frees port 80 (the setup page needs it). */
  void stop() { server_.stop(); }

  /** From the server: the key and epoch to check passes with (saved in flash). */
  bool setKey(const char* key, long epoch);
  /** The board left the home: forget the key, so no older pass works. */
  void clear();
  /** "<key id>:<epoch>" for the board's telemetry ("" without a key). */
  String tag();

  /** true while a phone's command is being applied (the change is reported as "local"). */
  static bool applying() { return applying_; }

 private:
  void hello();
  void state();
  void command();
  bool authorized(JsonDocument& pass);
  void reply(int code, const JsonDocument& doc);
  void fail(int code, const char* error);
  void save();

  DeviceRegistry& registry_;
  BearSslHasher hasher_;
  LocalAuth auth_;
  NonceBook nonces_;
  ESP8266WebServer server_;
  String nodeId_;
  bool mdns_ = false;
  static bool applying_;
};

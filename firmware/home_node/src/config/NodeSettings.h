// ============================================================================
//  NodeSettings  -  who this board is and how it reaches the server.
//
//  The node id is made from the chip id ("esp-3c71bf"), so every board is unique
//  without editing code. Wi-Fi and the broker address/login are typed into the
//  board's own setup page (WiFiManager), then kept in flash.
// ============================================================================
#pragma once

#include <Arduino.h>

struct BrokerSettings {
  String host;
  uint16_t port = 1883;
  String user = "node";
  String password;
  bool tls = false;
};

class NodeSettings {
 public:
  void begin();                         // load from flash, build the node id
  bool configured() const { return broker_.host.length() > 0; }

  /** Runs the setup page (blocking). Returns true when settings were saved. Restarts on timeout. */
  bool runSetupPortal();

  const String& nodeId() const { return nodeId_; }
  const BrokerSettings& broker() const { return broker_; }

 private:
  void save();
  String nodeId_;
  BrokerSettings broker_;
};

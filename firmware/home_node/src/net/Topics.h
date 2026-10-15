// MQTT topics. Same scheme as packages/contracts/src/topics.ts and tools/fake-node.
#pragma once

#include <Arduino.h>

class Topics {
 public:
  explicit Topics(const String& nodeId) : base_(String("home/v1/nodes/") + nodeId + "/") {}

  String status() const { return base_ + "status"; }
  String announce() const { return base_ + "announce"; }
  String config() const { return base_ + "config"; }
  String configApplied() const { return base_ + "config/applied"; }
  String telemetry() const { return base_ + "telemetry"; }
  String cmd() const { return base_ + "cmd"; }
  String network() const { return base_ + "network"; }
  String log() const { return base_ + "log"; }
  String deviceState(const String& key) const { return base_ + "devices/" + key + "/state"; }
  String deviceSetFilter() const { return base_ + "devices/+/set"; }

  /** "home/v1/nodes/<id>/devices/<key>/set" -> "<key>", or "" for any other topic. */
  String keyFromSet(const String& topic) const {
    const String prefix = base_ + "devices/";
    if (!topic.startsWith(prefix) || !topic.endsWith("/set")) return "";
    return topic.substring(prefix.length(), topic.length() - 4);
  }

 private:
  String base_;
};

#include "NodeSettings.h"

#include <ArduinoJson.h>
#include <ESP8266WiFi.h>
#include <WiFiManager.h>

#include "../../config.h"
#include "../core/Log.h"
#include "../storage/Files.h"

// Encrypted (TLS) connections use 8883. A board set to "encrypted" with the plain port 1883
// (an old value left in the setup page) is corrected here, so it still reaches the cloud broker.
static void fixTlsPort(BrokerSettings& b) {
  if (b.tls && b.port == 1883) b.port = 8883;
}

void NodeSettings::begin() {
  char id[16];
  snprintf(id, sizeof(id), "esp-%06x", ESP.getChipId());
  nodeId_ = id;

  JsonDocument doc;
  if (Files::readJson(Files::SETTINGS, doc)) {
    broker_.host = doc["host"] | "";
    broker_.port = doc["port"] | MQTT_DEFAULT_PORT;
    broker_.user = doc["user"] | "node";
    broker_.password = doc["password"] | "";
    broker_.tls = doc["tls"] | false;
    ownPassword_ = doc["ownPassword"] | "";
    fixTlsPort(broker_);
  }
}

bool NodeSettings::setOwnLogin(const String& password) {
  if (password == ownPassword_) return true;
  ownPassword_ = password;
  save();
  return true;
}

void NodeSettings::save() {
  JsonDocument doc;
  doc["host"] = broker_.host;
  doc["port"] = broker_.port;
  doc["user"] = broker_.user;
  doc["password"] = broker_.password;
  doc["tls"] = broker_.tls;
  if (ownPassword_.length()) doc["ownPassword"] = ownPassword_;
  Files::writeJson(Files::SETTINGS, doc);
}

bool NodeSettings::runSetupPortal() {
  const String ap = String(SETUP_AP_PREFIX) + nodeId_.substring(4);
  LOG_INFO("Setup page: join Wi-Fi '%s' on your phone, then open http://192.168.4.1", ap.c_str());

  WiFiManager wm;
  char port[6];
  snprintf(port, sizeof(port), "%u", broker_.port);
  WiFiManagerParameter header("<p><b>Home server</b><br>Your PC's IP address while testing, or mqtt.your-domain in the cloud.</p>");
  WiFiManagerParameter host("host", "Server address", broker_.host.c_str(), 63);
  WiFiManagerParameter portField("port", "Port (1883 local, 8883 cloud TLS)", port, 5);
  WiFiManagerParameter user("user", "Board login", broker_.user.c_str(), 31);
  WiFiManagerParameter password("password", "Board password (MQTT_NODE_PASSWORD)", broker_.password.c_str(), 63);
  WiFiManagerParameter tls("tls", "Encrypted (yes for the cloud, no on your PC)", broker_.tls ? "yes" : "no", 3);
  wm.addParameter(&header);
  wm.addParameter(&host);
  wm.addParameter(&portField);
  wm.addParameter(&user);
  wm.addParameter(&password);
  wm.addParameter(&tls);

  bool saved = false;
  wm.setSaveParamsCallback([&]() { saved = true; });
  wm.setSaveConfigCallback([&]() { saved = true; });
  wm.setBreakAfterConfig(true);
  wm.setConfigPortalTimeout(SETUP_PORTAL_TIMEOUT);
  wm.setTitle("Home board setup");

  const bool connected = wm.startConfigPortal(ap.c_str());
  if (saved) {
    broker_.host = host.getValue();
    broker_.host.trim();
    broker_.port = (uint16_t)atoi(portField.getValue());
    if (broker_.port == 0) broker_.port = MQTT_DEFAULT_PORT;
    broker_.user = user.getValue();
    broker_.password = password.getValue();
    const String t = String(tls.getValue());
    broker_.tls = t.equalsIgnoreCase("yes") || t == "1" || t.equalsIgnoreCase("true");
    fixTlsPort(broker_);
    save();
    LOG_INFO("Settings saved: server %s:%u%s", broker_.host.c_str(), broker_.port, broker_.tls ? " (TLS)" : "");
  }
  if (!connected && !saved) {
    LOG_WARN("Setup page timed out, restarting");
    ESP.restart();
  }
  return saved;
}

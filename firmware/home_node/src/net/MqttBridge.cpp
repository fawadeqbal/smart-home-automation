#include "MqttBridge.h"

#include <ESP8266httpUpdate.h>

#include <ArduinoJson.h>
#include <time.h>

#include "../../config.h"
#include "../core/Log.h"
#include "CaCert.h"

static MqttBridge* activeBridge = nullptr;

void MqttBridge::publishInputEvent(uint8_t pin, const char* gesture) {
  if (!mqtt_.connected()) return;
  JsonDocument doc;
  doc["gesture"] = gesture;
  publishJson(topics_->inputEvent(pin), doc, false);
  LOG_INFO("Input on GPIO %u: %s", pin, gesture);
}

void MqttBridge::begin(const NodeSettings& settings) {
  settings_ = &settings;
  topics_ = new Topics(settings.nodeId());
  activeBridge = this;
  inputEventHandler = [](uint8_t pin, const char* gesture) {
    if (activeBridge) activeBridge->publishInputEvent(pin, gesture);
  };
  const BrokerSettings& b = settings.broker();

  if (b.tls) {
    // TLS: trust only servers whose certificate chains to Let's Encrypt's root; needs the real time.
    trustAnchor_ = new BearSSL::X509List(ISRG_ROOT_X1);
    secure_.setTrustAnchors(trustAnchor_);
    secure_.setBufferSizes(4096, 1024);   // smaller than the 16 KB default: fits next to everything else
    configTime(0, 0, "pool.ntp.org", "time.google.com");
    mqtt_.setClient(secure_);
  } else {
    mqtt_.setClient(plain_);
  }
  mqtt_.setServer(b.host.c_str(), b.port);
  mqtt_.setBufferSize(MQTT_BUFFER_BYTES);
  mqtt_.setKeepAlive(MQTT_KEEPALIVE_SEC);
  mqtt_.setSocketTimeout(5);
  mqtt_.setCallback([this](char* t, uint8_t* p, unsigned int n) { onMessage(t, p, n); });
  LOG_INFO("Node id %s, server %s:%u%s", settings.nodeId().c_str(), b.host.c_str(), b.port, b.tls ? " (TLS)" : "");
}

bool MqttBridge::clockReady() {
  return time(nullptr) > 1700000000;   // after Nov 2023: NTP has answered
}

void MqttBridge::loop() {
  if (rebootAt_ && millis() > rebootAt_) ESP.restart();
  if (reconnectAt_ && millis() > reconnectAt_) {
    reconnectAt_ = 0;
    mqtt_.disconnect();
    nextAttempt_ = 0;
  }
  wifiSwitch_.loop();
  if (wifiSwitch_.busy() || WiFi.status() != WL_CONNECTED) return;

  if (!mqtt_.connected()) {
    if (millis() < nextAttempt_) return;
    if (settings_->broker().tls && !clockReady()) {
      nextAttempt_ = millis() + 500;   // waiting for NTP
      return;
    }
    if (!connect()) {
      nextAttempt_ = millis() + backoff_;
      backoff_ = std::min<uint32_t>(backoff_ * 2, MQTT_RETRY_MAX_MS);
      return;
    }
    backoff_ = MQTT_RETRY_MIN_MS;
  }
  mqtt_.loop();
  flushLogs();
  reportNetwork();
  if (otaUrl_.length()) runOta();

  if (millis() - lastTelemetry_ >= config_.telemetrySec() * 1000UL) publishTelemetry();
}

bool MqttBridge::connect() {
  const BrokerSettings& b = settings_->broker();
  // Its own login (2.6.0+) when it has one; the shared one from the setup page when it hasn't, or when
  // its own was refused twice in a row (the server may have lost it: it then sends a new one).
  const bool own = settings_->hasOwnLogin() && ownRefused_ < 2;
  const String user = own ? settings_->nodeId() : b.user;
  const String password = own ? settings_->ownPassword() : b.password;
  JsonDocument will;
  will["online"] = false;
  String willText;
  serializeJson(will, willText);

  LOG_INFO("Connecting to the server %s:%u...", b.host.c_str(), b.port);
  // Client id = node id: the broker's access rules allow each board only its own topics.
  if (!mqtt_.connect(settings_->nodeId().c_str(), user.c_str(), password.c_str(),
                     topics_->status().c_str(), 1, true, willText.c_str())) {
    const bool refused = mqtt_.state() == 4 || mqtt_.state() == 5;
    if (refused && own) ++ownRefused_;
    else if (refused) ownRefused_ = 0;   // the shared login failed too: try its own again next time
    LOG_WARN("Server connection failed (state %d). %s", mqtt_.state(),
             refused ? (own ? "Its own login was refused." : "Check the board login and password.") : "Retrying.");
    return false;
  }
  if (own) ownRefused_ = 0;
  usingOwn_ = own;
  ++connects_;
  LOG_INFO("Connected to the server (%s login)", own ? "its own" : "shared");

  JsonDocument status;
  status["online"] = true;
  status["fw"] = FIRMWARE_VERSION;
  status["ip"] = WiFi.localIP().toString();
  publishJson(topics_->status(), status, true);

  JsonDocument announce;
  announce["board"] = BOARD_TYPE;
  announce["fw"] = FIRMWARE_VERSION;
  announce["mac"] = WiFi.macAddress();
  announce["ip"] = WiFi.localIP().toString();
  announce["login"] = own ? "own" : "shared";
  publishJson(topics_->announce(), announce, true);

  mqtt_.subscribe(topics_->config().c_str(), 1);
  mqtt_.subscribe(topics_->deviceSetFilter().c_str(), 1);
  mqtt_.subscribe(topics_->cmd().c_str(), 1);

  // Tell the server where everything stands: after power-on, or what changed while offline.
  if (!everConnected_) publishAllStates("boot");
  else if (changedWhileOffline_) publishAllStates(offlineSrc_);
  everConnected_ = true;
  changedWhileOffline_ = false;
  offlineSrc_ = "button";
  publishTelemetry();
  return true;
}

// ---------------------------------------------------------------- incoming
void MqttBridge::onMessage(char* topic, uint8_t* payload, unsigned int length) {
  if (length == 0) return;   // a cleared retained message
  JsonDocument doc;
  if (deserializeJson(doc, payload, length) || !doc.is<JsonObject>()) {
    LOG_WARN("Ignoring a message that is not a JSON object on %s", topic);
    return;
  }
  const String t(topic);
  if (t == topics_->config()) return handleConfig(doc.as<JsonObjectConst>());
  if (t == topics_->cmd()) return handleCmd(doc.as<JsonObjectConst>());
  const String key = topics_->keyFromSet(t);
  if (key.length()) handleSet(key, doc.as<JsonObjectConst>());
}

void MqttBridge::handleConfig(JsonObjectConst config) {
  const int rev = config["rev"] | 0;
  if (config_.isCurrent(config)) {   // e.g. the retained config again after a reconnect
    JsonDocument reply;
    reply["rev"] = rev;
    reply["ok"] = true;
    publishJson(topics_->configApplied(), reply, false);
    return;
  }
  String error;
  quiet_ = true;
  const bool ok = config_.apply(config, error);
  quiet_ = false;

  JsonDocument reply;
  reply["rev"] = rev;
  reply["ok"] = ok;
  if (!ok) reply["error"] = error;
  publishJson(topics_->configApplied(), reply, false);

  if (ok) {
    LOG_INFO("Configuration rev %d applied: %u devices%s", rev, (unsigned)registry_.count(),
             config_.adopted() ? "" : " (waiting to be adopted in the web app)");
    publishAllStates("boot");
    if (!config_.adopted() && local_) local_->clear();   // released from the home: no phone may switch it
  } else {
    LOG_WARN("Configuration rev %d rejected: %s", rev, error.c_str());
  }
}

void MqttBridge::handleSet(const String& key, JsonObjectConst command) {
  const char* cid = command["cid"] | (const char*)nullptr;
  LOG_INFO("Command for %s from the server", key.c_str());
  Device* device = registry_.find(key);
  if (device == nullptr) {
    JsonDocument err;
    if (cid) err["cid"] = cid;
    err["src"] = "remote";
    err["error"] = "no such device on this board";
    publishJson(topics_->deviceState(key), err, false);
    return;
  }
  quiet_ = true;
  const CommandResult result = device->apply(command);
  quiet_ = false;
  if (!result.ok) {
    JsonDocument err;
    if (cid) err["cid"] = cid;
    err["src"] = "remote";
    err["error"] = result.error;
    publishJson(topics_->deviceState(key), err, false);
    return;
  }
  publishState(*device, "remote", cid);   // the acknowledgement, even if nothing changed
}

void MqttBridge::handleCmd(JsonObjectConst cmd) {
  const String action = cmd["action"] | "";
  if (action == "reboot") {
    LOG_INFO("Restart requested by the server");
    rebootAt_ = millis() + 500;   // let the MQTT acknowledgement go out first
  } else if (action == "scan") {
    if (scanning_) return;
    scanning_ = true;
    LOG_INFO("Scanning for Wi-Fi networks...");
    WiFi.scanNetworksAsync([this](int found) {
      JsonDocument doc;
      JsonArray list = doc["scan"].to<JsonArray>();
      for (int i = 0; i < found && i < 30; ++i) {
        if (WiFi.SSID(i).length() == 0) continue;   // hidden network
        JsonObject n = list.add<JsonObject>();
        n["ssid"] = WiFi.SSID(i);
        n["rssi"] = WiFi.RSSI(i);
        n["channel"] = WiFi.channel(i);
        n["secure"] = WiFi.encryptionType(i) != ENC_TYPE_NONE;
      }
      WiFi.scanDelete();
      scanning_ = false;
      LOG_INFO("Found %d Wi-Fi networks", found);
      publishJson(topics_->network(), doc, false);
    });
  } else if (action == "wifi") {
    String why;
    const String ssid = cmd["ssid"] | "";
    if (!wifiSwitch_.start(ssid, cmd["password"] | "", why)) {
      JsonDocument doc;
      doc["result"]["ok"] = false;
      doc["result"]["ssid"] = ssid;
      doc["result"]["message"] = why;
      publishJson(topics_->network(), doc, false);
    }
  } else if (action == "ota") {
    // Firmware update over Wi-Fi: done from loop(), not inside this MQTT callback.
    otaUrl_ = cmd["url"] | "";
    otaVersion_ = cmd["version"] | "?";
    if (!otaUrl_.startsWith("http")) otaUrl_ = "";
  } else if (action == "local") {
    // local control: the key phones' passes are checked with (never retained on the broker)
    if (local_ && local_->setKey(cmd["key"] | "", cmd["epoch"] | 0L)) publishTelemetry();
  } else if (action == "login") {
    // its own MQTT login (never retained on the broker): keep it, and reconnect with it
    const String user = cmd["user"] | "";
    const String password = cmd["password"] | "";
    if (user != settings_->nodeId() || password.length() < 24) {
      LOG_WARN("Ignoring a login for another board");
      return;
    }
    if (settings_->hasOwnLogin() && settings_->ownPassword() == password && usingOwn_) return;
    if (const_cast<NodeSettings*>(settings_)->setOwnLogin(password)) {
      LOG_INFO("Got its own server login: reconnecting with it");
      ownRefused_ = 0;
      reconnectAt_ = millis() + 300;   // after this callback returns
    }
  } else if (action == "local-off") {
    if (local_) local_->clear();
    publishTelemetry();
  } else if (action == "wifi-reset") {
    LOG_WARN("Forgetting Wi-Fi: restarting into the setup hotspot");
    mqtt_.disconnect();
    WiFi.disconnect(true);   // erases the saved network, so the next start opens the setup page
    rebootAt_ = millis() + 500;
  }
}

void MqttBridge::reportNetwork() {
  bool ok;
  String ssid, message;
  if (!wifiSwitch_.takeResult(ok, ssid, message)) return;
  JsonDocument doc;
  doc["result"]["ok"] = ok;
  doc["result"]["ssid"] = ssid;
  doc["result"]["message"] = message;
  publishJson(topics_->network(), doc, false);
  publishTelemetry();   // fresh signal / network details right away
}

// ---------------------------------------------------------------- outgoing
void MqttBridge::onDeviceChanged(Device& device) {
  if (quiet_) return;
  const char* src = Device::changeSource ? Device::changeSource
                    : !device.controllable() ? "sensor" : LocalServer::applying() ? "local" : "button";
  if (!mqtt_.connected()) {
    if (device.controllable()) {
      if (!changedWhileOffline_) offlineSrc_ = src;
      else if (offlineSrc_ != src) offlineSrc_ = "button";   // both: the wall switch is the safer story
    }
    changedWhileOffline_ = true;
    return;
  }
  publishState(device, src);
}

void MqttBridge::publishState(Device& device, const char* src, const char* cid) {
  JsonDocument doc;
  JsonObject state = doc.to<JsonObject>();
  device.writeState(state);
  if (state.size() == 0) return;   // e.g. a sensor with no reading yet
  state["src"] = src;
  if (cid) state["cid"] = cid;
  publishJson(topics_->deviceState(device.key()), doc, true);
}

void MqttBridge::publishAllStates(const char* src) {
  for (size_t i = 0; i < registry_.count(); ++i) publishState(registry_.at(i), src);
}

void MqttBridge::publishTelemetry() {
  lastTelemetry_ = millis();
  JsonDocument doc;
  doc["rssi"] = WiFi.RSSI();
  doc["heap"] = ESP.getFreeHeap();
  doc["heapFrag"] = ESP.getHeapFragmentation();
  doc["maxBlock"] = ESP.getMaxFreeBlockSize();
  doc["uptime"] = millis() / 1000;
#if MEASURE_SUPPLY_VOLTAGE
  doc["vcc"] = ESP.getVcc();   // millivolts
#endif
  doc["cpuMhz"] = ESP.getCpuFreqMHz();
  doc["flashKb"] = ESP.getFlashChipRealSize() / 1024;
  doc["sketchKb"] = ESP.getSketchSize() / 1024;
  doc["freeSketchKb"] = ESP.getFreeSketchSpace() / 1024;
  doc["reset"] = ESP.getResetReason();
  doc["ssid"] = WiFi.SSID();
  doc["channel"] = WiFi.channel();
  doc["connects"] = connects_;
  doc["bssid"] = WiFi.BSSIDstr();
  doc["gateway"] = WiFi.gatewayIP().toString();
  doc["mac"] = WiFi.macAddress();
  if (local_) doc["local"] = local_->tag();
  publishJson(topics_->telemetry(), doc, false);
}

void MqttBridge::flushLogs() {
#if REMOTE_LOGS
  const uint16_t dropped = LogSink::takeDropped();
  if (dropped) {
    JsonDocument doc;
    doc["level"] = "warn";
    doc["msg"] = String(dropped) + " log lines were lost while offline";
    doc["uptime"] = millis() / 1000;
    publishJson(topics_->log(), doc, false);
  }
  LogSink::Line line;
  for (int i = 0; i < 8 && LogSink::pop(line); ++i) {   // a few per loop: never hogs the board
    JsonDocument doc;
    doc["level"] = LogSink::levelName(line.level);
    doc["msg"] = line.text;
    doc["uptime"] = line.uptimeSec;
    publishJson(topics_->log(), doc, false);
  }
#endif
}

bool MqttBridge::publishJson(const String& topic, const JsonDocument& doc, bool retained) {
  String text;
  serializeJson(doc, text);
  return mqtt_.publish(topic.c_str(), text.c_str(), retained);
}

void MqttBridge::runOta() {
  const String url = otaUrl_;
  otaUrl_ = "";
  LOG_INFO("Updating firmware %s -> %s (about 30 s, do not unplug)...", FIRMWARE_VERSION, otaVersion_.c_str());
  flushLogs();
  mqtt_.loop();
  delay(100);

  ESPhttpUpdate.rebootOnUpdate(false);   // report first, then restart
  ESPhttpUpdate.onProgress([](int done, int total) {
    static int lastPct = -1;
    const int pct = total ? done * 100 / total : 0;
    if (pct / 25 != lastPct / 25) { lastPct = pct; Serial.printf("OTA %d%%\n", pct); }
  });
  // The server sends an x-MD5 header; the core checks the image against it before switching.
  //
  // Over HTTPS the download gets its own connection with a full-size (16 KB) receive buffer: the web
  // server in front of the API sends the file in 16 KB TLS records and does not do MFLN (smaller
  // records on request), so the 4 KB buffer the MQTT link uses would fail a few KB in. The board
  // has about 40 KB of memory in all, so the MQTT link is closed first to make room (cleanly: the
  // broker doesn't announce the board offline), and reopened afterwards.
  HTTPUpdateResult r;
  String sslError;
  uint32_t blockBefore = 0;
  if (url.startsWith("https")) {
    mqtt_.disconnect();
    secure_.stop();
    blockBefore = ESP.getMaxFreeBlockSize();
    LOG_INFO("Downloading over HTTPS (free memory %u bytes, largest block %u)", ESP.getFreeHeap(), blockBefore);
    BearSSL::WiFiClientSecure download;
    download.setTrustAnchors(trustAnchor_);
    download.setBufferSizes(16384, 512);
    r = ESPhttpUpdate.update(download, url, FIRMWARE_VERSION);
    if (r == HTTP_UPDATE_FAILED) {
      char buf[96];
      if (download.getLastSSLError(buf, sizeof(buf)) != 0) sslError = buf;
    }
  } else {
    r = ESPhttpUpdate.update(plain_, url, FIRMWARE_VERSION);
  }

  JsonDocument doc;
  doc["ota"]["version"] = otaVersion_;
  if (r == HTTP_UPDATE_OK) {
    doc["ota"]["ok"] = true;
    doc["ota"]["message"] = "installed, restarting";
    LOG_INFO("Firmware %s installed: restarting", otaVersion_.c_str());
    rebootAt_ = millis() + 1500;
  } else {
    String why = r == HTTP_UPDATE_NO_UPDATES ? String("already up to date") : ESPhttpUpdate.getLastErrorString();
    if (sslError.length()) why += " (TLS: " + sslError + ")";
    if (blockBefore && blockBefore < 17000) why += " (the board was low on memory for the download: power it off and on, then try again)";
    doc["ota"]["ok"] = false;
    doc["ota"]["message"] = why.substring(0, 160);
    LOG_ERROR("Firmware update failed: %s", why.c_str());
  }
  if (!mqtt_.connected()) connect();
  publishJson(topics_->network(), doc, false);
  flushLogs();
}

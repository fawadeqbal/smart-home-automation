#include "LocalServer.h"

#include <ESP8266WiFi.h>
#include <ESP8266mDNS.h>
#include <bearssl/bearssl.h>
#include <time.h>

#include "../../config.h"
#include "../core/Log.h"
#include "../storage/Files.h"

bool LocalServer::applying_ = false;

static const char* const LOCAL_FILE = "/local.json";
static const size_t MAX_BODY = 512;

void BearSslHasher::sha256(const void* data, size_t len, uint8_t out[32]) {
  br_sha256_context ctx;
  br_sha256_init(&ctx);
  br_sha256_update(&ctx, data, len);
  br_sha256_out(&ctx, out);
}

void BearSslHasher::hmac(const void* key, size_t keyLen, const void* const* parts, const size_t* lens, size_t count,
                         uint8_t out[32]) {
  br_hmac_key_context kc;
  br_hmac_context ctx;
  br_hmac_key_init(&kc, &br_sha256_vtable, key, keyLen);
  br_hmac_init(&ctx, &kc, 0);
  for (size_t i = 0; i < count; ++i) br_hmac_update(&ctx, parts[i], lens[i]);
  br_hmac_out(&ctx, out);
}

void LocalServer::begin(const String& nodeId) {
  nodeId_ = nodeId;
  JsonDocument doc;
  if (Files::readJson(LOCAL_FILE, doc) && auth_.setKey(doc["key"] | "", doc["epoch"] | 0L)) {
    LOG_INFO("Local control ready (epoch %ld)", auth_.epoch());
  }
  server_.collectHeaders("X-Pass", "X-Nonce", "X-Sig");
  server_.on("/local/hello", HTTP_GET, [this]() { hello(); });
  server_.on("/local/state", HTTP_POST, [this]() { state(); });
  server_.on("/local/command", HTTP_POST, [this]() { command(); });
  server_.onNotFound([this]() { fail(404, "not found"); });
  server_.begin();
}

void LocalServer::loop() {
  if (WiFi.status() != WL_CONNECTED) return;
  if (!mdns_) {
    // <node id>.local, and a service the app can look for
    mdns_ = MDNS.begin(nodeId_.c_str());
    if (mdns_) MDNS.addService("switchboard", "tcp", 80);
  }
  if (mdns_) MDNS.update();
  server_.handleClient();
}

bool LocalServer::setKey(const char* key, long epoch) {
  if (!auth_.setKey(key, epoch)) return false;
  save();
  LOG_INFO("Local control key saved (epoch %ld)", epoch);
  return true;
}

void LocalServer::clear() {
  if (!auth_.hasKey()) return;
  auth_.clear();
  LittleFS.remove(LOCAL_FILE);
  LOG_INFO("Local control key forgotten");
}

String LocalServer::tag() {
  char out[24];
  auth_.tag(out, sizeof out);
  return String(out);
}

void LocalServer::save() {
  JsonDocument doc;
  doc["key"] = auth_.key();
  doc["epoch"] = auth_.epoch();
  Files::writeJson(LOCAL_FILE, doc);
}

// ---------------------------------------------------------------- requests
void LocalServer::reply(int code, const JsonDocument& doc) {
  String text;
  serializeJson(doc, text);
  server_.send(code, "application/json", text);
}

void LocalServer::fail(int code, const char* error) {
  JsonDocument doc;
  doc["error"] = error;
  reply(code, doc);
}

void LocalServer::hello() {
  JsonDocument doc;
  doc["id"] = nodeId_;
  doc["fw"] = FIRMWARE_VERSION;
  doc["local"] = auth_.hasKey();
  doc["nonce"] = nonces_.issue(millis(), RANDOM_REG32, RANDOM_REG32);
  reply(200, doc);
}

bool LocalServer::authorized(JsonDocument& pass) {
  const String& body = server_.arg("plain");
  if (body.length() > MAX_BODY) {
    fail(413, "too long");
    return false;
  }
  const String passText = server_.header("X-Pass");
  const String nonce = server_.header("X-Nonce");
  const String sig = server_.header("X-Sig");
  if (!nonces_.take(nonce.c_str(), millis())) {
    fail(401, "unknown or used nonce");
    return false;
  }
  const time_t now = time(nullptr);
  const LocalCheck result = auth_.check(nodeId_.c_str(), passText.c_str(), nonce.c_str(), sig.c_str(),
                                        server_.uri().c_str(), body.c_str(), body.length(), pass,
                                        now > 1700000000 ? (long)now : 0);   // 0 until NTP has answered
  switch (result) {
    case LocalCheck::Ok: return true;
    case LocalCheck::Expired: fail(401, "this pass has run out"); break;
    case LocalCheck::NoKey: fail(401, "no local key yet"); break;
    case LocalCheck::OldPass: fail(401, "old pass"); break;
    case LocalCheck::OtherBoard: fail(401, "pass for another board"); break;
    default: fail(401, "bad pass or signature"); break;
  }
  return false;
}

void LocalServer::state() {
  JsonDocument pass;
  if (!authorized(pass)) return;
  JsonDocument doc;
  doc["id"] = nodeId_;
  JsonArray list = doc["devices"].to<JsonArray>();
  for (size_t i = 0; i < registry_.count(); ++i) {
    Device& d = registry_.at(i);
    if (!localauth::listed(pass, "v", d.key().c_str())) continue;
    JsonObject item = list.add<JsonObject>();
    item["key"] = d.key();
    item["type"] = d.type();
    d.writeState(item["state"].to<JsonObject>());
  }
  reply(200, doc);
}

void LocalServer::command() {
  JsonDocument pass;
  if (!authorized(pass)) return;
  JsonDocument cmd;
  if (deserializeJson(cmd, server_.arg("plain"))) return fail(400, "bad JSON");
  const char* key = cmd["key"] | "";
  Device* device = registry_.find(key);
  if (!device || !localauth::listed(pass, "v", key)) return fail(404, "no such device");
  if (!localauth::listed(pass, "c", key)) return fail(403, "you may not switch this");
  if (!device->controllable()) return fail(400, "not a switch");

  applying_ = true;
  const CommandResult result = device->apply(cmd.as<JsonObjectConst>());
  applying_ = false;
  if (!result.ok) return fail(400, result.error);
  LOG_INFO("%s switched from a phone over Wi-Fi (%s)", key, pass["u"] | "?");

  JsonDocument doc;
  doc["ok"] = true;
  doc["key"] = key;
  device->writeState(doc["state"].to<JsonObject>());
  reply(200, doc);
}

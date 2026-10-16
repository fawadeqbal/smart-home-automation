// ============================================================================
//  LocalAuth  -  checks the phone app's requests when it talks to this board
//  straight over the home's Wi-Fi (local control, e.g. while the internet is down).
//
//  The server gives the board a secret key (64 hex characters) and an "epoch",
//  and gives each person a pass for this board plus a pass key made from it:
//
//    pass      base64url of {"n": board, "e": epoch, "u": person, "v": [see], "c": [switch]}
//    pass key  hex HMAC-SHA256(key = board key, "pass:" + pass)
//    request   X-Pass, X-Nonce (from GET /local/hello, used once) and
//              X-Sig = hex HMAC-SHA256(key = pass key, nonce + "\n" + path + "\n" + body)
//
//  Only the server and this board know the board key, so only they can make a
//  pass key: a pass can't be edited or made up. A new epoch retires older passes.
//  Same scheme as apps/api/src/hardware/local-pass.ts (shared test vector:
//  test/local_auth_test.cpp).
//
//  No Arduino types here, so it is tested on a PC as well; the hashing comes
//  from outside (BearSSL on the board, OpenSSL in the test).
// ============================================================================
#pragma once

#include <ArduinoJson.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

/** SHA-256 and HMAC-SHA256, from whatever crypto library is at hand. */
class Hasher {
 public:
  virtual ~Hasher() = default;
  virtual void sha256(const void* data, size_t len, uint8_t out[32]) = 0;
  /** HMAC-SHA256 over several parts, as if they were one message. */
  virtual void hmac(const void* key, size_t keyLen, const void* const* parts, const size_t* lens, size_t count,
                    uint8_t out[32]) = 0;
};

enum class LocalCheck { Ok, NoKey, BadNonce, BadPass, OtherBoard, OldPass, BadSig };

namespace localauth {

inline void toHex(const uint8_t* in, size_t n, char* out) {
  static const char digits[] = "0123456789abcdef";
  for (size_t i = 0; i < n; ++i) {
    out[2 * i] = digits[in[i] >> 4];
    out[2 * i + 1] = digits[in[i] & 15];
  }
  out[2 * n] = '\0';
}

/** Same length and same characters, taking the same time whatever differs. */
inline bool sameText(const char* a, const char* b) {
  const size_t la = strlen(a), lb = strlen(b);
  uint8_t diff = la != lb;
  for (size_t i = 0; i < la && i < lb; ++i) diff |= (uint8_t)(a[i] ^ b[i]);
  return diff == 0;
}

inline int b64Value(char c) {
  if (c >= 'A' && c <= 'Z') return c - 'A';
  if (c >= 'a' && c <= 'z') return c - 'a' + 26;
  if (c >= '0' && c <= '9') return c - '0' + 52;
  if (c == '-' || c == '+') return 62;
  if (c == '_' || c == '/') return 63;
  return -1;
}

/** base64url (padding optional) into `out`; returns the length, or -1 when it isn't base64 or doesn't fit. */
inline int b64urlDecode(const char* in, char* out, size_t cap) {
  size_t n = 0;
  uint32_t acc = 0;
  int bits = 0;
  for (const char* p = in; *p && *p != '='; ++p) {
    const int v = b64Value(*p);
    if (v < 0) return -1;
    acc = (acc << 6) | (uint32_t)v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      if (n + 1 >= cap) return -1;
      out[n++] = (char)((acc >> bits) & 0xFF);
    }
  }
  out[n] = '\0';
  return (int)n;
}

/** true when `key` is in the pass's list `field` ("v" = may see, "c" = may switch). */
inline bool listed(JsonDocument& pass, const char* field, const char* key) {
  for (JsonVariantConst k : pass[field].as<JsonArrayConst>()) {
    const char* s = k.as<const char*>();
    if (s && strcmp(s, key) == 0) return true;
  }
  return false;
}

}  // namespace localauth

/** Nonces handed out by GET /local/hello: each works once, for a minute. */
class NonceBook {
 public:
  static const size_t SLOTS = 6;
  static const uint32_t LIFE_MS = 60000;

  /** A new nonce from two random words; the oldest is dropped when all slots are taken. */
  const char* issue(uint32_t now, uint32_t r1, uint32_t r2) {
    size_t slot = 0;
    for (size_t i = 0; i < SLOTS; ++i) {
      if (!used_[i] || now - at_[i] > LIFE_MS) { slot = i; break; }
      if (at_[i] < at_[slot]) slot = i;
    }
    const uint8_t bytes[8] = {(uint8_t)(r1 >> 24), (uint8_t)(r1 >> 16), (uint8_t)(r1 >> 8), (uint8_t)r1,
                              (uint8_t)(r2 >> 24), (uint8_t)(r2 >> 16), (uint8_t)(r2 >> 8), (uint8_t)r2};
    localauth::toHex(bytes, 8, nonces_[slot]);
    at_[slot] = now;
    used_[slot] = true;
    return nonces_[slot];
  }

  /** true (and forgets it) when this nonce was handed out in the last minute. */
  bool take(const char* nonce, uint32_t now) {
    for (size_t i = 0; i < SLOTS; ++i) {
      if (used_[i] && now - at_[i] <= LIFE_MS && localauth::sameText(nonces_[i], nonce)) {
        used_[i] = false;
        return true;
      }
    }
    return false;
  }

 private:
  char nonces_[SLOTS][17] = {};
  uint32_t at_[SLOTS] = {};
  bool used_[SLOTS] = {};
};

class LocalAuth {
 public:
  explicit LocalAuth(Hasher& hasher) : hasher_(hasher) {}

  /** false when the key isn't 64 hex characters. */
  bool setKey(const char* key, long epoch) {
    if (!key || strlen(key) != 64 || epoch < 1) return false;
    for (const char* p = key; *p; ++p) {
      if (!((*p >= '0' && *p <= '9') || (*p >= 'a' && *p <= 'f'))) return false;
    }
    memcpy(key_, key, 65);
    epoch_ = epoch;
    return true;
  }
  void clear() {
    memset(key_, 0, sizeof key_);
    epoch_ = 0;
  }
  bool hasKey() const { return key_[0] != '\0'; }
  const char* key() const { return key_; }
  long epoch() const { return epoch_; }

  /** "<first 8 hex of sha256(key)>:<epoch>", what the board reports; "" without a key. */
  void tag(char* out, size_t cap) {
    if (!hasKey()) {
      if (cap) out[0] = '\0';
      return;
    }
    uint8_t digest[32];
    hasher_.sha256(key_, 64, digest);
    char hex[65];
    localauth::toHex(digest, 32, hex);
    snprintf(out, cap, "%.8s:%ld", hex, epoch_);
  }

  /**
   * Checks a request. On Ok, `pass` holds the decoded pass (who, what they may see and switch).
   * The nonce must already have been taken from the NonceBook by the caller.
   */
  LocalCheck check(const char* nodeId, const char* passText, const char* nonce, const char* sig, const char* path,
                   const char* body, size_t bodyLen, JsonDocument& pass) {
    if (!hasKey()) return LocalCheck::NoKey;
    char json[512];
    if (localauth::b64urlDecode(passText, json, sizeof json) < 0) return LocalCheck::BadPass;
    pass.clear();
    if (deserializeJson(pass, json) || !pass["n"].is<const char*>()) return LocalCheck::BadPass;
    if (strcmp(pass["n"].as<const char*>(), nodeId) != 0) return LocalCheck::OtherBoard;
    if ((long)(pass["e"] | 0L) != epoch_) return LocalCheck::OldPass;

    // the pass key, from the board key: the phone can only know it if the server made this pass
    uint8_t mac[32];
    const void* passParts[] = {"pass:", passText};
    const size_t passLens[] = {5, strlen(passText)};
    hasher_.hmac(key_, 64, passParts, passLens, 2, mac);
    char passKey[65];
    localauth::toHex(mac, 32, passKey);

    const void* parts[] = {nonce, "\n", path, "\n", body};
    const size_t lens[] = {strlen(nonce), 1, strlen(path), 1, bodyLen};
    hasher_.hmac(passKey, 64, parts, lens, 5, mac);
    char want[65];
    localauth::toHex(mac, 32, want);
    return sig && localauth::sameText(want, sig) ? LocalCheck::Ok : LocalCheck::BadSig;
  }

 private:
  Hasher& hasher_;
  char key_[65] = {};
  long epoch_ = 0;
};

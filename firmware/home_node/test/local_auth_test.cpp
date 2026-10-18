// Host test for src/net/LocalAuth.h (runs on a PC, not the board):
//
//   g++ -std=c++17 -I <ArduinoJson>/src test/local_auth_test.cpp -lcrypto -o /tmp/local_auth_test && /tmp/local_auth_test
//
// The vector is the one in apps/api/test/unit/local.test.js, so board and server agree byte for byte.
#include <openssl/evp.h>
#include <openssl/hmac.h>
#include <openssl/sha.h>

#include <cstdio>
#include <cstdlib>
#include <string>

#include "../src/net/LocalAuth.h"

class OpenSslHasher : public Hasher {
 public:
  void sha256(const void* data, size_t len, uint8_t out[32]) override { SHA256((const uint8_t*)data, len, out); }
  void hmac(const void* key, size_t keyLen, const void* const* parts, const size_t* lens, size_t count,
            uint8_t out[32]) override {
    std::string msg;
    for (size_t i = 0; i < count; ++i) msg.append((const char*)parts[i], lens[i]);
    unsigned int n = 32;
    HMAC(EVP_sha256(), key, (int)keyLen, (const uint8_t*)msg.data(), msg.size(), out, &n);
  }
};

static int failures = 0;
#define CHECK(cond)                                                     \
  do {                                                                  \
    if (!(cond)) {                                                      \
      std::printf("FAIL line %d: %s\n", __LINE__, #cond);               \
      ++failures;                                                       \
    }                                                                   \
  } while (0)

static const char* KEY = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
static const char* PASS =
    "eyJuIjoiZXNwLWFiYzEyMyIsImUiOjMsInUiOiJ1c2VyLTciLCJ2IjpbInN3MSIsInN3MiIsImRodCJdLCJjIjpbInN3MSJdfQ";
static const char* NONCE = "0123456789abcdef";
static const char* PATH = "/local/command";
static const char* BODY = "{\"key\":\"sw1\",\"on\":true}";
static const char* SIG = "f6101833442aa1b41c2e12817f35b8e8c5be35e0257cce191811c22701ca7268";

int main() {
  OpenSslHasher hasher;
  LocalAuth auth(hasher);
  JsonDocument pass;

  CHECK(auth.check("esp-abc123", PASS, NONCE, SIG, PATH, BODY, strlen(BODY), pass) == LocalCheck::NoKey);
  CHECK(!auth.setKey("abc", 3));
  CHECK(!auth.setKey("00112233445566778899AABBCCDDEEFF00112233445566778899aabbccddeeff", 3));   // lower case only
  CHECK(auth.setKey(KEY, 3));

  char tag[24];
  auth.tag(tag, sizeof tag);
  CHECK(std::string(tag) == "2a8abfa8:3");

  CHECK(auth.check("esp-abc123", PASS, NONCE, SIG, PATH, BODY, strlen(BODY), pass) == LocalCheck::Ok);
  CHECK(std::string(pass["u"].as<const char*>()) == "user-7");
  CHECK(localauth::listed(pass, "v", "dht"));
  CHECK(localauth::listed(pass, "c", "sw1"));
  CHECK(!localauth::listed(pass, "c", "sw2"));

  // anything changed: refused
  CHECK(auth.check("esp-other", PASS, NONCE, SIG, PATH, BODY, strlen(BODY), pass) == LocalCheck::OtherBoard);
  const char* other = "{\"key\":\"sw1\",\"on\":false}";
  CHECK(auth.check("esp-abc123", PASS, NONCE, SIG, PATH, other, strlen(other), pass) == LocalCheck::BadSig);
  CHECK(auth.check("esp-abc123", PASS, "0123456789abcdee", SIG, PATH, BODY, strlen(BODY), pass) == LocalCheck::BadSig);
  CHECK(auth.check("esp-abc123", PASS, NONCE, SIG, "/local/state", BODY, strlen(BODY), pass) == LocalCheck::BadSig);
  CHECK(auth.check("esp-abc123", PASS, NONCE, nullptr, PATH, BODY, strlen(BODY), pass) == LocalCheck::BadSig);
  CHECK(auth.check("esp-abc123", "not base64!", NONCE, SIG, PATH, BODY, strlen(BODY), pass) == LocalCheck::BadPass);
  CHECK(auth.setKey(KEY, 4));
  CHECK(auth.check("esp-abc123", PASS, NONCE, SIG, PATH, BODY, strlen(BODY), pass) == LocalCheck::OldPass);

  // a guest's pass that stops at 1800000000: refused once the board knows it's later; without the time
  // (0) it's taken (the server's new epoch retires it then)
  const char* GUEST = "eyJuIjoiZXNwLWFiYzEyMyIsImUiOjQsInUiOiJndWVzdC0xIiwidiI6WyJzdzEiXSwiYyI6WyJzdzEiXSwieCI6MTgwMDAwMDAwMH0";
  const char* GUEST_SIG = "214852d0a3972d29ae5da837597f05d1e7954c8c4be4fdb8aede7c86a78c0dd8";
  CHECK(auth.check("esp-abc123", GUEST, NONCE, GUEST_SIG, PATH, BODY, strlen(BODY), pass, 1799999999) == LocalCheck::Ok);
  CHECK(auth.check("esp-abc123", GUEST, NONCE, GUEST_SIG, PATH, BODY, strlen(BODY), pass, 1800000000) == LocalCheck::Expired);
  CHECK(auth.check("esp-abc123", GUEST, NONCE, GUEST_SIG, PATH, BODY, strlen(BODY), pass, 0) == LocalCheck::Ok);
  CHECK(auth.check("esp-abc123", PASS, NONCE, SIG, PATH, BODY, strlen(BODY), pass, 1900000000) == LocalCheck::OldPass);

  auth.clear();
  CHECK(!auth.hasKey());

  // base64url with and without padding, and the standard alphabet
  char out[16];
  CHECK(localauth::b64urlDecode("aGk", out, sizeof out) == 2 && std::string(out) == "hi");
  CHECK(localauth::b64urlDecode("aGk=", out, sizeof out) == 2);
  CHECK(localauth::b64urlDecode("_-8", out, sizeof out) == 2 && (uint8_t)out[0] == 0xff);
  CHECK(localauth::b64urlDecode("aGVsbG8gd29ybGQgaGVsbG8", out, sizeof out) == -1);   // doesn't fit

  // nonces: once each, for a minute
  NonceBook book;
  std::string n1 = book.issue(1000, 0x01020304, 0xa0b0c0d0);
  CHECK(n1 == "01020304a0b0c0d0");
  CHECK(book.take(n1.c_str(), 2000));
  CHECK(!book.take(n1.c_str(), 2000));
  std::string n2 = book.issue(3000, 7, 8);
  CHECK(!book.take(n2.c_str(), 3000 + 61000));
  std::string first = book.issue(10000, 1, 1);
  for (uint32_t i = 0; i < NonceBook::SLOTS; ++i) book.issue(10001 + i, 2 + i, 2);
  CHECK(!book.take(first.c_str(), 10100));   // the oldest made room

  if (failures) return 1;
  std::printf("local auth: all checks passed\n");
  return 0;
}

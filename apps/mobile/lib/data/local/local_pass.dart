import 'dart:convert';

import 'package:crypto/crypto.dart';

/// Local control: how the app signs a request to a board on the home's Wi‑Fi, with no server in
/// between. The server hands out a pass per board and the pass key made from it
/// (apps/api/src/hardware/local-pass.ts); every request carries
///
///   X-Pass   the pass
///   X-Nonce  a one-time number from the board's GET /local/hello
///   X-Sig    hex HMAC-SHA256(key = pass key, nonce + "\n" + path + "\n" + body)
///
/// The board checks all three (firmware src/net/LocalAuth.h). The test vector in
/// test/local_control_test.dart is the same one the server and the firmware are tested with.
String signLocal({required String passKey, required String nonce, required String path, required String body}) =>
    Hmac(sha256, utf8.encode(passKey)).convert(utf8.encode('$nonce\n$path\n$body')).toString();

Map<String, String> localHeaders({
  required String pass,
  required String passKey,
  required String nonce,
  required String path,
  required String body,
}) => {
  'X-Pass': pass,
  'X-Nonce': nonce,
  'X-Sig': signLocal(passKey: passKey, nonce: nonce, path: path, body: body),
};

/// What a pass says (only for showing; the board is what checks it): board, epoch, person,
/// device keys they may see (`v`) and switch (`c`).
Map<String, dynamic> readPass(String pass) {
  final padded = pass.padRight(pass.length + (4 - pass.length % 4) % 4, '=');
  return jsonDecode(utf8.decode(base64Url.decode(padded))) as Map<String, dynamic>;
}

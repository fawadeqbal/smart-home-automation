import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:switchboard_home/data/local/local_link.dart';
import 'package:switchboard_home/data/local/local_pass.dart';

// Same vector as apps/api/test/unit/local.test.js and firmware/home_node/test/local_auth_test.cpp.
const pass = 'eyJuIjoiZXNwLWFiYzEyMyIsImUiOjMsInUiOiJ1c2VyLTciLCJ2IjpbInN3MSIsInN3MiIsImRodCJdLCJjIjpbInN3MSJdfQ';
const passKey = 'c88b5b48920afff849584fb72a718bef85089ad27afced32039ea44c8db7b859';

void main() {
  test('requests are signed exactly like the server and the board expect', () {
    expect(
      signLocal(passKey: passKey, nonce: '0123456789abcdef', path: '/local/command', body: '{"key":"sw1","on":true}'),
      'f6101833442aa1b41c2e12817f35b8e8c5be35e0257cce191811c22701ca7268',
    );
    final info = readPass(pass);
    expect(info['n'], 'esp-abc123');
    expect(info['u'], 'user-7');
    expect(info['c'], ['sw1']);
  });

  test('the saved passes survive a round trip through the phone storage', () {
    final bundle = LocalBundle(
      homeId: 'h1',
      homeName: 'Test home',
      savedAt: DateTime.utc(2026, 10, 17, 9),
      boards: const [
        LocalBoard(
          nodeId: 'esp-abc123',
          name: 'Living room board',
          ip: '192.168.1.40',
          ready: true,
          pass: pass,
          passKey: passKey,
          devices: [LocalDevice(id: 'd1', key: 'sw1', name: 'Bulb', type: 'switch', roomName: 'Living room', control: true)],
        ),
      ],
    );
    final back = LocalBundle.fromJson(jsonDecode(jsonEncode(bundle.toJson())) as Map<String, dynamic>);
    expect(back.homeName, 'Test home');
    expect(back.usable, true);
    expect(back.boards.single.devices.single.control, true);
    expect(back.boards.single.passKey, passKey);
    expect(back.savedAt.toUtc(), DateTime.utc(2026, 10, 17, 9));
  });

  test('the client asks the board for a nonce, signs, and reports refusals in plain words', () async {
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    final seen = <String>[];
    var accept = true;
    server.listen((req) async {
      final body = await utf8.decodeStream(req);
      req.response.headers.contentType = ContentType.json;
      if (req.uri.path == '/local/hello') {
        req.response.write(jsonEncode({'id': 'esp-abc123', 'fw': '2.5.0', 'local': true, 'nonce': 'n${seen.length}'}));
      } else {
        final nonce = req.headers.value('X-Nonce')!;
        final want = Hmac(sha256, utf8.encode(passKey)).convert(utf8.encode('$nonce\n${req.uri.path}\n$body')).toString();
        seen.add('${req.uri.path} $body');
        if (!accept || req.headers.value('X-Sig') != want || req.headers.value('X-Pass') != pass) {
          req.response.statusCode = 401;
          req.response.write(jsonEncode({'error': 'old pass'}));
        } else if (req.uri.path == '/local/state') {
          req.response.write(jsonEncode({
            'devices': [
              {'key': 'sw1', 'state': {'on': false}},
            ],
          }));
        } else {
          req.response.write(jsonEncode({'ok': true, 'key': 'sw1', 'state': {'on': true}}));
        }
      }
      await req.response.close();
    });
    addTearDown(() => server.close(force: true));

    final board = LocalBoard(
      nodeId: 'esp-abc123',
      name: 'Living room board',
      ip: '127.0.0.1:${server.port}',
      ready: true,
      pass: pass,
      passKey: passKey,
      devices: const [],
    );
    final client = LocalClient();
    expect((await client.state(board))['sw1'], {'on': false});
    expect(await client.setOn(board, 'sw1', true), {'on': true});
    expect(seen.last, '/local/command {"key":"sw1","on":true}');

    accept = false;
    await expectLater(
      client.setOn(board, 'sw1', false),
      throwsA(isA<LocalError>().having((e) => e.passOld, 'passOld', true)),
    );
  });

  test('a board that can’t be found says so', () async {
    const board = LocalBoard(
      nodeId: 'esp-gone00',
      name: 'Garage board',
      ip: '127.0.0.1:9',
      ready: true,
      pass: pass,
      passKey: passKey,
      devices: [],
    );
    await expectLater(
      LocalClient().state(board),
      throwsA(isA<LocalError>().having((e) => e.message, 'message', contains('home’s Wi‑Fi'))),
    );
  });
}

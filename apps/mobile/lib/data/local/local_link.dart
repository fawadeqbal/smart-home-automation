import 'dart:async';
import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../models/json.dart';
import 'local_lookup_stub.dart' if (dart.library.io) 'local_lookup_io.dart';
import 'local_pass.dart';

/// One device the person may see on a board, from their pass.
@immutable
class LocalDevice {
  const LocalDevice({
    required this.id,
    required this.key,
    required this.name,
    required this.type,
    this.roomName,
    this.control = false,
  });

  factory LocalDevice.fromJson(Json j) => LocalDevice(
    id: str(j['id']),
    key: str(j['key']),
    name: str(j['name'], 'Device'),
    type: str(j['type']),
    roomName: strOrNull(j['roomName']),
    control: boolean(j['control']),
  );

  final String id, key, name, type;
  final String? roomName;

  /// they may switch it (else they may only look)
  final bool control;

  Json toJson() => {'id': id, 'key': key, 'name': name, 'type': type, 'roomName': roomName, 'control': control};
}

/// A board and this person's pass for it (`GET /local`), kept on the phone for when the internet is down.
@immutable
class LocalBoard {
  const LocalBoard({
    required this.nodeId,
    required this.name,
    required this.pass,
    required this.passKey,
    required this.devices,
    this.ip,
    this.ready = false,
    this.problem,
  });

  factory LocalBoard.fromJson(Json j) => LocalBoard(
    nodeId: str(j['nodeId']),
    name: str(j['name'], 'Board'),
    ip: strOrNull(j['ip']),
    ready: boolean(j['ready']),
    problem: strOrNull(j['problem']),
    pass: str(j['pass']),
    passKey: str(j['passKey']),
    devices: asJsonList(j['devices']).map(LocalDevice.fromJson).toList(),
  );

  final String nodeId, name, pass, passKey;
  final String? ip, problem;

  /// the board holds the current key (else it needs newer firmware, or hasn't been online yet)
  final bool ready;
  final List<LocalDevice> devices;

  Json toJson() => {
    'nodeId': nodeId,
    'name': name,
    'ip': ip,
    'ready': ready,
    'problem': problem,
    'pass': pass,
    'passKey': passKey,
    'devices': [for (final d in devices) d.toJson()],
  };
}

/// Everything the phone keeps for one home.
@immutable
class LocalBundle {
  const LocalBundle({required this.homeId, required this.homeName, required this.boards, required this.savedAt});

  factory LocalBundle.fromJson(Json j) => LocalBundle(
    homeId: str(j['homeId']),
    homeName: str(j['homeName'], 'Home'),
    savedAt: dateOrNull(j['savedAt']) ?? DateTime.fromMillisecondsSinceEpoch(0),
    boards: asJsonList(j['boards']).map(LocalBoard.fromJson).toList(),
  );

  final String homeId, homeName;
  final DateTime savedAt;
  final List<LocalBoard> boards;

  bool get usable => boards.any((b) => b.ready);

  Json toJson() => {
    'homeId': homeId,
    'homeName': homeName,
    'savedAt': savedAt.toUtc().toIso8601String(),
    'boards': [for (final b in boards) b.toJson()],
  };
}

/// Where the passes are kept on the phone (one home: the last one opened).
class LocalStore {
  LocalStore(this._prefs);
  final SharedPreferences _prefs;
  static const _key = 'local_control';

  LocalBundle? read() {
    final raw = _prefs.getString(_key);
    if (raw == null) return null;
    try {
      return LocalBundle.fromJson(asJson(jsonDecode(raw)));
    } catch (_) {
      return null;
    }
  }

  Future<void> save(LocalBundle bundle) => _prefs.setString(_key, jsonEncode(bundle.toJson()));

  /// Signed out: no passes stay on the phone.
  Future<void> clear() => _prefs.remove(_key);
}

/// Why a board didn't do what was asked, in words for the person.
class LocalError implements Exception {
  const LocalError(this.message, {this.status = 0});
  final String message;
  final int status;

  /// the pass is old (rights changed): it works again once the app has been online
  bool get passOld => status == 401;

  @override
  String toString() => message;
}

/// Talks to the boards straight over the Wi‑Fi.
class LocalClient {
  LocalClient({Dio? dio})
    : _dio =
          dio ??
          Dio(
            BaseOptions(
              connectTimeout: const Duration(seconds: 3),
              receiveTimeout: const Duration(seconds: 4),
              responseType: ResponseType.json,
              validateStatus: (_) => true,
            ),
          );

  final Dio _dio;

  /// where each board answered last (its address can change; the server's is a hint)
  final Map<String, String> _hosts = {};

  /// The board's current state for what this pass may see: device key -> state.
  Future<Map<String, Json>> state(LocalBoard board) async {
    final body = await _signed(board, '/local/state', '');
    return {for (final d in asJsonList(body['devices'])) str(d['key']): asJson(d['state'])};
  }

  /// Switches one device; returns its new state.
  Future<Json> setOn(LocalBoard board, String key, bool on) async {
    final body = await _signed(board, '/local/command', jsonEncode({'key': key, 'on': on}));
    return asJson(body['state']);
  }

  Future<Json> _signed(LocalBoard board, String path, String body) async {
    final (host, nonce) = await _find(board);
    final res = await _dio.post<Object?>(
      'http://$host$path',
      data: body,
      options: Options(
        contentType: 'application/json',
        headers: localHeaders(pass: board.pass, passKey: board.passKey, nonce: nonce, path: path, body: body),
      ),
    );
    final json = asJson(res.data);
    final code = res.statusCode ?? 0;
    if (code == 200) return json;
    final why = str(json['error']);
    throw switch (code) {
      401 => LocalError('${board.name} doesn’t accept this phone’s pass yet ($why). Open the app once with internet.', status: 401),
      403 => const LocalError('You may only look at this one.', status: 403),
      _ => LocalError(why.isEmpty ? '${board.name} said no ($code).' : why, status: code),
    };
  }

  /// The board's address and a fresh nonce from it: where it answered last, the address the server
  /// knows, then its name on the Wi‑Fi (`<node id>.local`).
  Future<(String, String)> _find(LocalBoard board) async {
    final candidates = <String>{
      if (_hosts[board.nodeId] != null) _hosts[board.nodeId]!,
      if (board.ip != null && board.ip!.isNotEmpty) board.ip!,
    };
    for (final host in candidates) {
      final nonce = await _hello(host, board.nodeId);
      if (nonce != null) return (_hosts[board.nodeId] = host, nonce);
    }
    for (final host in await lookupLocalName(board.nodeId)) {
      final nonce = await _hello(host, board.nodeId);
      if (nonce != null) return (_hosts[board.nodeId] = host, nonce);
    }
    _hosts.remove(board.nodeId);
    throw LocalError('Can’t reach ${board.name}. Is this phone on the home’s Wi‑Fi?');
  }

  /// Is one of these boards on the Wi‑Fi this phone is on? ("Who's home": a board of the home answering
  /// `/local/hello` with its own id means we're in.) Tries where each answered last, the address the
  /// server knows, then its name on the Wi‑Fi.
  Future<bool> reachesAny(List<({String nodeId, String? ip})> boards) async {
    for (final b in boards) {
      final candidates = <String>{?_hosts[b.nodeId], if (b.ip != null && b.ip!.isNotEmpty) b.ip!};
      for (final host in candidates) {
        if (await _hello(host, b.nodeId) != null) return (_hosts[b.nodeId] = host).isNotEmpty;
      }
    }
    for (final b in boards) {
      for (final host in await lookupLocalName(b.nodeId)) {
        if (await _hello(host, b.nodeId) != null) return (_hosts[b.nodeId] = host).isNotEmpty;
      }
    }
    return false;
  }

  /// A nonce when [host] is this board, else null.
  Future<String?> _hello(String host, String nodeId) async {
    try {
      final res = await _dio.get<Object?>('http://$host/local/hello');
      final json = asJson(res.data);
      return res.statusCode == 200 && str(json['id']) == nodeId ? str(json['nonce']) : null;
    } catch (_) {
      return null;
    }
  }
}

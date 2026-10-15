import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;

import '../network/api_client.dart';

/// Something the server pushed: `device.state`, `devices.changed`, `node.status`, `schedules.changed`,
/// `notification`, … (the same events the web app uses).
@immutable
class LiveEvent {
  const LiveEvent(this.name, this.data);
  final String name;
  final Object? data;

  Map<String, dynamic> get map => data is Map ? Map<String, dynamic>.from(data! as Map) : const {};
}

/// The live connection (Socket.IO at `<server>/socket.io`), signed in with the session cookies.
///
/// It joins the rooms of one home; [open] moves it to another home. When the access cookie has
/// expired it renews it and reconnects; when the server says our rights changed it reconnects too.
class LiveClient {
  LiveClient(this._api);

  final ApiClient _api;
  final _events = StreamController<LiveEvent>.broadcast();
  final connected = ValueNotifier<bool>(false);
  io.Socket? _socket;
  String? _home;
  bool _closed = false;

  Stream<LiveEvent> get events => _events.stream;

  /// Listens to one kind of event.
  Stream<LiveEvent> on(String name) => events.where((e) => e.name == name);

  Future<void> open(String? homeId) async {
    if (_closed) return;
    if (_socket != null && homeId == _home) return;
    _home = homeId;
    _disposeSocket();
    final uri = _api.socketUri;
    final builder = io.OptionBuilder()
        .setTransports(['websocket'])
        .disableAutoConnect()
        .enableReconnection()
        .setReconnectionDelay(1000)
        .setReconnectionDelayMax(8000)
        .setAuth({'home': homeId})
        .enableForceNew();
    final cookie = await _api.cookies.headerFor(
      Uri.parse('${_api.server}/api/'),
    );
    if (cookie != null) builder.setExtraHeaders({'cookie': cookie});
    if (kIsWeb) builder.enableWithCredentials();

    final socket = io.io(uri.toString(), builder.build());
    _socket = socket;
    socket.on('ready', (_) => connected.value = true);
    socket.onDisconnect((_) => connected.value = false);
    socket.on('auth.error', (data) async {
      final message = data is Map ? '${data['message'] ?? ''}' : '';
      if (RegExp('home', caseSensitive: false).hasMatch(message)) return;
      if (await _api.refresh()) await _reopen();
    });
    socket.on(
      'access.changed',
      (_) => Future<void>.delayed(const Duration(milliseconds: 500), _reopen),
    );
    socket.onAny((event, data) {
      if (!_events.isClosed) _events.add(LiveEvent(event, data));
    });
    socket.connect();
  }

  /// Reconnects with fresh cookies (after a renewal).
  Future<void> _reopen() async {
    final home = _home;
    _disposeSocket();
    await open(home);
  }

  void _disposeSocket() {
    _socket?.dispose();
    _socket = null;
    connected.value = false;
  }

  void close() {
    _closed = true;
    _disposeSocket();
    _events.close();
  }
}

final liveClientProvider = Provider<LiveClient>((ref) {
  final live = LiveClient(ref.watch(apiClientProvider));
  ref.onDispose(live.close);
  return live;
});

/// Live events of one kind, for providers that refresh or patch themselves.
final liveEventsProvider = StreamProvider.family<LiveEvent, String>(
  (ref, name) => ref.watch(liveClientProvider).on(name),
);

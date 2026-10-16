import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/config/app_settings.dart';
import '../core/network/api_client.dart';
import '../data/local/local_link.dart';
import '../data/models/json.dart';
import 'session.dart';

final localStoreProvider = Provider<LocalStore>((ref) => LocalStore(ref.watch(sharedPrefsProvider)));
final localClientProvider = Provider<LocalClient>((ref) => LocalClient());

/// The passes kept on this phone for switching the home over its Wi‑Fi without internet.
class LocalBundleController extends Notifier<LocalBundle?> {
  @override
  LocalBundle? build() {
    // signed out: the passes went with the session
    ref.listen(sessionProvider, (_, next) {
      if (next.hasValue && next.value == null) state = null;
    });
    return ref.read(localStoreProvider).read();
  }

  /// Fetches fresh passes for the open home (needs the internet) and keeps them.
  Future<void> refresh() async {
    final home = ref.read(sessionProvider).value?.home;
    if (home == null) return;
    final json = asJson(await ref.read(apiClientProvider).get<Object?>('/local'));
    final bundle = LocalBundle(
      homeId: str(json['homeId'], home.id),
      homeName: home.name,
      savedAt: DateTime.now(),
      boards: asJsonList(json['boards']).map(LocalBoard.fromJson).toList(),
    );
    await ref.read(localStoreProvider).save(bundle);
    state = bundle;
  }

  Future<void> clear() async {
    await ref.read(localStoreProvider).clear();
    state = null;
  }
}

final localBundleProvider = NotifierProvider<LocalBundleController, LocalBundle?>(LocalBundleController.new);

/// Keeps the passes fresh while the app is online: on start, when the open home changes, and every
/// few minutes (someone's rights may have changed, which retires older passes).
final localSyncProvider = Provider<void>((ref) {
  final homeId = ref.watch(currentHomeIdProvider);
  if (homeId == null) return;
  Future<void> sync() async {
    try {
      await ref.read(localBundleProvider.notifier).refresh();
    } catch (_) {
      // offline, or an older server: keep what the phone has
    }
  }

  unawaited(sync());
  final timer = Timer.periodic(const Duration(minutes: 5), (_) => sync());
  ref.onDispose(timer.cancel);
});

/// What the Wi‑Fi control screen shows: each device's state as its board reports it, and why a
/// board couldn't be reached.
@immutable
class LocalView {
  const LocalView({this.states = const {}, this.problems = const {}, this.busy = const {}});

  /// `<node id>/<device key>` -> state
  final Map<String, Json> states;

  /// node id -> what went wrong
  final Map<String, String> problems;

  /// `<node id>/<device key>` being switched
  final Set<String> busy;

  LocalView copyWith({Map<String, Json>? states, Map<String, String>? problems, Set<String>? busy}) =>
      LocalView(states: states ?? this.states, problems: problems ?? this.problems, busy: busy ?? this.busy);
}

String localId(LocalBoard b, LocalDevice d) => '${b.nodeId}/${d.key}';

class LocalControlController extends AsyncNotifier<LocalView> {
  @override
  Future<LocalView> build() async {
    final bundle = ref.watch(localBundleProvider);
    if (bundle == null) return const LocalView();
    final client = ref.read(localClientProvider);
    final states = <String, Json>{};
    final problems = <String, String>{};
    await Future.wait([
      for (final board in bundle.boards)
        if (!board.ready)
          Future.sync(() => problems[board.nodeId] = 'Can’t be switched over Wi‑Fi: ${board.problem ?? 'not set up yet'}.')
        else
          client
              .state(board)
              .then((s) {
                for (final e in s.entries) {
                  states['${board.nodeId}/${e.key}'] = e.value;
                }
              })
              .catchError((Object e) {
                problems[board.nodeId] = e.toString();
              }),
    ]);
    return LocalView(states: states, problems: problems);
  }

  /// Switches one device on its board: shown at once, put back if the board says no (then rethrows).
  Future<void> setOn(LocalBoard board, LocalDevice device, bool on) async {
    final view = state.value ?? const LocalView();
    final id = localId(board, device);
    final before = view.states[id] ?? const <String, dynamic>{};
    state = AsyncData(view.copyWith(states: {...view.states, id: {...before, 'on': on}}, busy: {...view.busy, id}));
    try {
      final now = await ref.read(localClientProvider).setOn(board, device.key, on);
      final v = state.value!;
      state = AsyncData(v.copyWith(states: {...v.states, id: now}, busy: {...v.busy}..remove(id)));
    } catch (_) {
      final v = state.value!;
      state = AsyncData(v.copyWith(states: {...v.states, id: before}, busy: {...v.busy}..remove(id)));
      rethrow;
    }
  }
}

final localControlProvider = AsyncNotifierProvider.autoDispose<LocalControlController, LocalView>(
  LocalControlController.new,
);

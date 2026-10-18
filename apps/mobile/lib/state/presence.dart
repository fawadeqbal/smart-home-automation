import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/realtime/live_client.dart';
import '../data/models/presence.dart';
import '../data/repositories/notices_repository.dart';
import 'local_control.dart';
import 'session.dart';

/// "Share when I'm home" for me in the open home (off until I turn it on), with the home's boards.
class SharingController extends AsyncNotifier<MySharing> {
  @override
  Future<MySharing> build() async {
    final home = ref.watch(currentHomeIdProvider);
    final blocked = ref.watch(sessionProvider.select((s) => s.value?.home?.blocked != null));
    if (home == null || blocked) return const MySharing();
    return ref.read(noticesRepositoryProvider).sharing();
  }

  Future<void> set(bool on) async {
    final before = state.value ?? const MySharing();
    state = AsyncData(MySharing(sharing: on, canShare: before.canShare, boards: before.boards));
    try {
      state = AsyncData(await ref.read(noticesRepositoryProvider).setSharing(on));
      ref.invalidate(whoIsHomeProvider);
      if (on) unawaited(ref.read(presenceReporterProvider).reportNow());
    } catch (_) {
      state = AsyncData(before);
      rethrow;
    }
  }
}

final sharingProvider = AsyncNotifierProvider<SharingController, MySharing>(SharingController.new);

/// Who's home (owners and admins, and the people who share it themselves), kept live.
final whoIsHomeProvider = FutureProvider<WhoIsHome>((ref) async {
  final home = ref.watch(sessionProvider.select((s) => s.value?.home));
  if (home == null || home.blocked != null) return const WhoIsHome();
  final sub = ref.watch(liveClientProvider).on('presence.changed').listen((_) => ref.invalidateSelf());
  ref.onDispose(sub.cancel);
  try {
    return await ref.read(noticesRepositoryProvider).whoIsHome();
  } catch (_) {
    return const WhoIsHome(); // an older server: no card
  }
});

/// Decides "at home" and tells the server: on start and resume, when the phone changes network, and
/// every few minutes while the app is open. "At home" = a board of this home answers on the Wi‑Fi (no
/// location permission needed). Only while I share; nothing is sent otherwise.
class PresenceReporter {
  PresenceReporter(this._ref);
  final Ref _ref;
  static const every = Duration(minutes: 4);

  Timer? _timer;
  StreamSubscription<List<ConnectivityResult>>? _net;
  AppLifecycleListener? _life;
  bool _busy = false;

  void start() {
    if (kIsWeb || _timer != null) return; // a browser can't reach the boards over plain http
    _timer = Timer.periodic(every, (_) => reportNow());
    try {
      _net = Connectivity().onConnectivityChanged.listen((_) {
        // give the new network a moment to come up
        Future<void>.delayed(const Duration(seconds: 4), reportNow);
      });
    } catch (_) {
      // no connectivity plugin (tests): the timer still runs
    }
    _life = AppLifecycleListener(onResume: reportNow);
    unawaited(reportNow());
  }

  Future<void> reportNow() async {
    if (_busy) return;
    _busy = true;
    try {
      final MySharing sharing = _ref.read(sharingProvider).value ?? await _ref.read(sharingProvider.future);
      if (!sharing.sharing || sharing.boards.isEmpty) return;
      final atHome = await _ref.read(localClientProvider).reachesAny(sharing.boards);
      final still = await _ref.read(noticesRepositoryProvider).report(atHome);
      if (!still) _ref.invalidate(sharingProvider); // turned off elsewhere
    } catch (_) {
      // offline, or an older server: try again next time
    } finally {
      _busy = false;
    }
  }

  void stop() {
    _timer?.cancel();
    _timer = null;
    unawaited(_net?.cancel());
    _net = null;
    _life?.dispose();
    _life = null;
  }
}

/// Runs while signed in with a home open (the app shell watches it).
final presenceReporterProvider = Provider<PresenceReporter>((ref) {
  final reporter = PresenceReporter(ref);
  ref.onDispose(reporter.stop);
  return reporter;
});

final presenceSyncProvider = Provider<void>((ref) {
  final home = ref.watch(currentHomeIdProvider);
  final sharing = ref.watch(sharingProvider.select((s) => s.value?.sharing ?? false));
  if (home == null || !sharing) return;
  final reporter = ref.watch(presenceReporterProvider)..start();
  ref.onDispose(reporter.stop);
});

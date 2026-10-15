import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/realtime/live_client.dart';
import '../data/models/activity.dart';
import '../data/repositories/activity_repository.dart';
import '../data/repositories/devices_repository.dart';
import 'devices.dart';
import 'session.dart';

/// Who switched what, newest first. Refreshes shortly after anything changes (several changes
/// at once — a scene, All off — become one reload), and pages back with [loadMore].
class ActivityController extends AsyncNotifier<List<ActivityEvent>> {
  static const pageSize = 40;
  Timer? _debounce;
  bool _exhausted = false;

  bool get exhausted => _exhausted;

  @override
  Future<List<ActivityEvent>> build() async {
    if (ref.watch(currentHomeIdProvider) == null) return const [];
    _exhausted = false;
    final sub = ref.watch(liveClientProvider).on('device.state').listen((_) {
      _debounce?.cancel();
      _debounce = Timer(
        const Duration(milliseconds: 700),
        () => unawaited(refresh()),
      );
    });
    ref.onDispose(() {
      sub.cancel();
      _debounce?.cancel();
    });
    final first = await ref.read(activityRepositoryProvider).events(limit: pageSize);
    _exhausted = first.length < pageSize;
    return first;
  }

  Future<void> refresh() async {
    try {
      final latest = await ref.read(activityRepositoryProvider).events(limit: pageSize);
      final older = (state.value ?? const []).where(
        (e) => latest.isEmpty || e.at.isBefore(latest.last.at),
      );
      state = AsyncData([...latest, ...older]);
    } catch (_) {
      // keep what we have
    }
  }

  Future<void> loadMore() async {
    final list = state.value;
    if (list == null || list.isEmpty || _exhausted) return;
    final more = await ref.read(activityRepositoryProvider).events(limit: pageSize, before: list.last.at);
    _exhausted = more.length < pageSize;
    state = AsyncData([...list, ...more]);
  }
}

final activityProvider = AsyncNotifierProvider<ActivityController, List<ActivityEvent>>(
  ActivityController.new,
);

/// A device's recent changes, for its sheet.
final deviceHistoryProvider = FutureProvider.autoDispose.family<List<ActivityEvent>, String>((ref, deviceId) async {
  final device = ref.read(deviceProvider(deviceId));
  if (device == null) return const [];
  // refresh when this device changes
  final sub = ref
      .watch(liveClientProvider)
      .on('device.state')
      .where((e) => e.map['id'] == deviceId)
      .listen((_) => ref.invalidateSelf());
  ref.onDispose(sub.cancel);
  return ref.read(devicesRepositoryProvider).history(device, limit: 12);
});

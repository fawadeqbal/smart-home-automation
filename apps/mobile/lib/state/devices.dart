import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/realtime/live_client.dart';
import '../data/models/device.dart';
import '../data/models/json.dart';
import '../data/repositories/devices_repository.dart';
import 'session.dart';

/// The devices this person can see in the open home, kept live:
/// * `device.state` patches one device (from the app, voice, a wall switch or a schedule);
/// * `node.status` marks a board's devices online/offline;
/// * `devices.changed` (renamed, moved, added) reloads the list.
class DevicesController extends AsyncNotifier<List<Device>> {
  @override
  Future<List<Device>> build() async {
    if (ref.watch(currentHomeIdProvider) == null) return const [];
    final live = ref.watch(liveClientProvider);
    final sub = live.events.listen(_onLive);
    ref.onDispose(sub.cancel);
    return ref.read(devicesRepositoryProvider).devices();
  }

  void _onLive(LiveEvent e) {
    final list = state.value;
    if (list == null) return;
    switch (e.name) {
      case 'device.state':
        final id = str(e.map['id']);
        final fields = asJson(e.map['state']);
        if (fields.isEmpty) return;
        state = AsyncData([
          for (final d in list)
            if (d.id == id)
              d.copyWith(
                state: {...d.state, ...fields},
                source: strOrNull(e.map['source']),
                updatedAt: DateTime.now(),
              )
            else
              d,
        ]);
      case 'node.status':
        final nodeId = str(e.map['nodeId']);
        final online = boolean(e.map['online']);
        state = AsyncData([
          for (final d in list)
            if (d.nodeId == nodeId) d.copyWith(online: online) else d,
        ]);
      case 'devices.changed':
        unawaited(refresh());
    }
  }

  Future<void> refresh() async {
    try {
      state = AsyncData(await ref.read(devicesRepositoryProvider).devices());
    } catch (e, st) {
      if (state.value == null) state = AsyncError(e, st);
    }
  }

  void _put(Device device) {
    final list = state.value;
    if (list == null) return;
    state = AsyncData([
      for (final d in list)
        if (d.id == device.id) device else d,
    ]);
  }

  /// Switches one device: shown at once, confirmed by the board, put back if it fails (then rethrows).
  Future<void> setOn(String id, bool on) async {
    final before = state.value?.where((d) => d.id == id).firstOrNull;
    if (before == null) return;
    ref.read(pendingDevicesProvider.notifier).add(id);
    _put(before.copyWith(state: {...before.state, 'on': on}));
    try {
      final confirmed = await ref.read(devicesRepositoryProvider).setOn(id, on);
      _put(confirmed);
    } catch (_) {
      _put(before);
      rethrow;
    } finally {
      ref.read(pendingDevicesProvider.notifier).remove(id);
    }
  }

  /// A fan's speed (it goes on at that speed): shown at once, confirmed by the board.
  Future<void> setSpeed(String id, int speed) async {
    final before = state.value?.where((d) => d.id == id).firstOrNull;
    if (before == null) return;
    ref.read(pendingDevicesProvider.notifier).add(id);
    _put(before.copyWith(state: {...before.state, 'on': speed > 0, if (speed > 0) 'speed': speed}));
    try {
      _put(await ref.read(devicesRepositoryProvider).command(id, {'speed': speed}));
    } catch (_) {
      _put(before);
      rethrow;
    } finally {
      ref.read(pendingDevicesProvider.notifier).remove(id);
    }
  }

  Future<void> toggle(String id) async {
    final d = state.value?.where((x) => x.id == id).firstOrNull;
    if (d != null) await setOn(id, !d.isOn);
  }

  /// Switches many devices together (All off, room all on, undo). Skips devices already there and
  /// devices that aren't responding. Returns what changed and what failed.
  Future<BatchResult> setMany(Map<String, bool> wanted) async {
    final list = state.value ?? const [];
    final todo = <String, bool>{
      for (final d in list)
        if (wanted.containsKey(d.id) && d.canControl && d.responding && d.isOn != wanted[d.id]) d.id: wanted[d.id]!,
    };
    final previous = {for (final id in todo.keys) id: !todo[id]!};
    final failed = <String>[];
    await Future.wait(
      todo.entries.map((e) async {
        try {
          await setOn(e.key, e.value);
        } catch (_) {
          failed.add(e.key);
        }
      }),
    );
    return BatchResult(
      changed: todo.length - failed.length,
      failed: failed,
      previous: {
        for (final e in previous.entries)
          if (!failed.contains(e.key)) e.key: e.value,
      },
    );
  }
}

class BatchResult {
  const BatchResult({
    required this.changed,
    required this.failed,
    required this.previous,
  });
  final int changed;
  final List<String> failed;

  /// How the changed devices were before — what Undo puts back.
  final Map<String, bool> previous;
}

final devicesProvider = AsyncNotifierProvider<DevicesController, List<Device>>(
  DevicesController.new,
);

/// Devices with a command on its way (their tile says "Turning on…").
class PendingDevices extends Notifier<Set<String>> {
  @override
  Set<String> build() => const {};
  void add(String id) => state = {...state, id};
  void remove(String id) => state = {...state}..remove(id);
}

final pendingDevicesProvider = NotifierProvider<PendingDevices, Set<String>>(
  PendingDevices.new,
);

/// The rooms of the open home this person can see, in the home's order.
final roomsProvider = FutureProvider<List<Room>>((ref) async {
  if (ref.watch(currentHomeIdProvider) == null) return const [];
  // rooms are renamed/added with the devices
  final sub = ref.watch(liveClientProvider).on('devices.changed').listen((_) => ref.invalidateSelf());
  ref.onDispose(sub.cancel);
  return ref.read(devicesRepositoryProvider).rooms();
});

/// One device, kept live (null when it's gone).
final deviceProvider = Provider.family<Device?, String>(
  (ref, id) => ref.watch(devicesProvider).value?.where((d) => d.id == id).firstOrNull,
);

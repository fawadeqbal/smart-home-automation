import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/realtime/live_client.dart';
import '../data/models/automation.dart';
import '../data/repositories/automation_repository.dart';
import 'session.dart';

/// Reloads a provider when any of [events] arrives.
void reloadOnLive(Ref ref, List<String> events) {
  final sub = ref
      .watch(liveClientProvider)
      .events
      .where((e) => events.contains(e.name))
      .listen((_) => ref.invalidateSelf());
  ref.onDispose(sub.cancel);
}

final scenesProvider = FutureProvider<List<Scene>>((ref) async {
  if (ref.watch(currentHomeIdProvider) == null) return const [];
  reloadOnLive(ref, const ['schedules.changed', 'devices.changed']);
  return ref.read(automationRepositoryProvider).scenes();
});

/// Schedules and timers, kept live (`schedules.changed`, `schedule.ran`).
class SchedulesController extends AsyncNotifier<List<Schedule>> {
  @override
  Future<List<Schedule>> build() async {
    if (ref.watch(currentHomeIdProvider) == null) return const [];
    reloadOnLive(ref, const ['schedules.changed', 'schedule.ran']);
    return ref.read(automationRepositoryProvider).schedules();
  }

  Future<Schedule> create(NewSchedule s) async {
    final created = await ref.read(automationRepositoryProvider).createSchedule(s);
    state = AsyncData([
      created,
      ...?state.value?.where((x) => x.id != created.id),
    ]);
    return created;
  }

  Future<void> setEnabled(String id, bool enabled) async {
    final before = state.value;
    state = AsyncData([
      for (final s in before ?? const <Schedule>[])
        if (s.id == id) s.copyWith(enabled: enabled) else s,
    ]);
    try {
      await ref.read(automationRepositoryProvider).setEnabled(id, enabled);
    } catch (_) {
      if (before != null) state = AsyncData(before);
      rethrow;
    }
  }

  Future<void> remove(String id) async {
    final before = state.value;
    state = AsyncData([...?before?.where((s) => s.id != id)]);
    try {
      await ref.read(automationRepositoryProvider).deleteSchedule(id);
    } catch (_) {
      if (before != null) state = AsyncData(before);
      rethrow;
    }
  }
}

final schedulesProvider = AsyncNotifierProvider<SchedulesController, List<Schedule>>(
  SchedulesController.new,
);

/// The "turn off in…" timer running on a device, if any.
final deviceTimerProvider = Provider.family<Schedule?, String>((ref, deviceId) {
  final list = ref.watch(schedulesProvider).value ?? const [];
  final timers =
      list
          .where(
            (s) => s.isTimerFor(deviceId) && s.nextRunAt!.isAfter(DateTime.now()),
          )
          .toList()
        ..sort((a, b) => a.nextRunAt!.compareTo(b.nextRunAt!));
  return timers.firstOrNull;
});

/// Rules, kept live.
class RulesController extends AsyncNotifier<List<Rule>> {
  @override
  Future<List<Rule>> build() async {
    if (ref.watch(currentHomeIdProvider) == null) return const [];
    reloadOnLive(ref, const ['schedules.changed']);
    return ref.read(automationRepositoryProvider).rules();
  }

  Future<void> setEnabled(String id, bool enabled) async {
    final before = state.value;
    state = AsyncData([
      for (final r in before ?? const <Rule>[])
        if (r.id == id) r.copyWith(enabled: enabled) else r,
    ]);
    try {
      await ref.read(automationRepositoryProvider).setRuleEnabled(id, enabled);
    } catch (_) {
      if (before != null) state = AsyncData(before);
      rethrow;
    }
  }

  Future<void> remove(String id) async {
    final before = state.value;
    state = AsyncData([...?before?.where((r) => r.id != id)]);
    try {
      await ref.read(automationRepositoryProvider).deleteRule(id);
    } catch (_) {
      if (before != null) state = AsyncData(before);
      rethrow;
    }
  }
}

final rulesProvider = AsyncNotifierProvider<RulesController, List<Rule>>(RulesController.new);

/// Away mode (off and not loaded when it can't be read).
class AwayController extends AsyncNotifier<AwayState> {
  @override
  Future<AwayState> build() async {
    if (ref.watch(currentHomeIdProvider) == null) return const AwayState();
    reloadOnLive(ref, const ['devices.changed']);
    try {
      return await ref.read(automationRepositoryProvider).away();
    } catch (_) {
      return const AwayState();
    }
  }

  Future<void> set(bool on) async {
    state = AsyncData(await ref.read(automationRepositoryProvider).setAway(on));
  }
}

final awayProvider = AsyncNotifierProvider<AwayController, AwayState>(AwayController.new);

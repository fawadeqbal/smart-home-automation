import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/realtime/live_client.dart';
import '../data/models/energy.dart';
import '../data/models/outages.dart';
import '../data/models/people.dart';
import '../data/models/power.dart';
import '../data/models/ticket.dart';
import '../data/repositories/home_repository.dart';
import '../data/repositories/people_repository.dart';
import 'session.dart';

/// The people of the open home (owners and admins only — others get an empty list).
final membersProvider = FutureProvider<List<Member>>((ref) async {
  final home = ref.watch(sessionProvider.select((s) => s.value?.home));
  if (home == null || !home.role.manages) return const [];
  return ref.read(peopleRepositoryProvider).members();
});

/// Notification settings, saved as they change.
class PrefsController extends AsyncNotifier<List<NotificationPref>> {
  @override
  Future<List<NotificationPref>> build() async {
    if (ref.watch(currentHomeIdProvider) == null) return const [];
    return ref.read(peopleRepositoryProvider).prefs();
  }

  Future<void> set(Map<String, bool> changes) async {
    final before = state.value ?? const [];
    state = AsyncData([
      for (final p in before) NotificationPref(p.key, p.label, changes[p.key] ?? p.enabled),
    ]);
    try {
      state = AsyncData(
        await ref.read(peopleRepositoryProvider).setPrefs(changes),
      );
    } catch (_) {
      state = AsyncData(before);
      rethrow;
    }
  }
}

final prefsProvider = AsyncNotifierProvider<PrefsController, List<NotificationPref>>(
  PrefsController.new,
);

/// This week's power cuts and internet outages (empty when they can't be loaded).
final homeOutagesProvider = FutureProvider<HomeOutages>((ref) async {
  if (ref.watch(currentHomeIdProvider) == null) return const HomeOutages();
  try {
    return await ref.read(homeRepositoryProvider).outages(days: 7);
  } catch (_) {
    return const HomeOutages();
  }
});

/// This week's electricity estimate (not loaded when it can't be read).
final homeEnergyProvider = FutureProvider<Energy>((ref) async {
  if (ref.watch(currentHomeIdProvider) == null) return const Energy();
  try {
    return await ref.read(homeRepositoryProvider).energy(days: 7);
  } catch (_) {
    return const Energy();
  }
});

final homeSummaryProvider = FutureProvider<HomeSummary>((ref) async {
  if (ref.watch(currentHomeIdProvider) == null) return const HomeSummary();
  try {
    return await ref.read(homeRepositoryProvider).summary();
  } catch (_) {
    return const HomeSummary();
  }
});

/// This person's help requests (all the home's for owners and admins).
final ticketsProvider = FutureProvider<List<Ticket>>((ref) async {
  if (ref.watch(currentHomeIdProvider) == null) return const [];
  return ref.read(homeRepositoryProvider).tickets();
});

final homeWelcomeProvider = FutureProvider<HomeWelcome>((ref) async {
  if (ref.watch(currentHomeIdProvider) == null) return const HomeWelcome();
  try {
    return await ref.read(homeRepositoryProvider).welcome();
  } catch (_) {
    return const HomeWelcome();
  }
});

/// On UPS or not, and the next expected cut (not loaded when it can't be read). Reloads on `power.changed`.
final powerStatusProvider = FutureProvider<PowerStatus>((ref) async {
  if (ref.watch(currentHomeIdProvider) == null) return const PowerStatus();
  final sub = ref.watch(liveClientProvider).on('power.changed').listen((_) => ref.invalidateSelf());
  ref.onDispose(sub.cancel);
  try {
    return await ref.read(homeRepositoryProvider).power();
  } catch (_) {
    return const PowerStatus();
  }
});

final sheddingProvider = FutureProvider<Shedding>((ref) async {
  if (ref.watch(currentHomeIdProvider) == null) return const Shedding();
  return ref.read(homeRepositoryProvider).shedding();
});

/// This billing month from the meter readings (owners and admins; not loaded for anyone else).
final billProvider = FutureProvider<Bill>((ref) async {
  final home = ref.watch(sessionProvider.select((s) => s.value?.home));
  if (home == null || !home.role.manages) return const Bill();
  return ref.read(homeRepositoryProvider).bill();
});

final readingsProvider = FutureProvider<List<MeterReading>>((ref) async {
  final home = ref.watch(sessionProvider.select((s) => s.value?.home));
  if (home == null || !home.role.manages) return const [];
  return ref.read(homeRepositoryProvider).readings();
});

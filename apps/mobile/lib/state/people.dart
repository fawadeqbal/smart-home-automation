import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/models/energy.dart';
import '../data/models/outages.dart';
import '../data/models/people.dart';
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

final homeWelcomeProvider = FutureProvider<HomeWelcome>((ref) async {
  if (ref.watch(currentHomeIdProvider) == null) return const HomeWelcome();
  try {
    return await ref.read(homeRepositoryProvider).welcome();
  } catch (_) {
    return const HomeWelcome();
  }
});

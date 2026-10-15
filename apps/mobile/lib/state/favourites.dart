import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/config/app_settings.dart';
import '../data/models/device.dart';
import 'devices.dart';
import 'session.dart';

/// The devices on the Home tab, chosen per home and kept on this phone. Until someone picks their
/// own, the first switches of the home show (in room order).
class FavouritesController extends Notifier<List<String>?> {
  static const max = 6;
  String _key(String home) => 'favourites_$home';

  @override
  List<String>? build() {
    final home = ref.watch(currentHomeIdProvider);
    if (home == null) return null;
    return ref.read(sharedPrefsProvider).getStringList(_key(home));
  }

  Future<void> toggle(String deviceId, List<String> current) async {
    final home = ref.read(currentHomeIdProvider);
    if (home == null) return;
    final next = current.contains(deviceId) ? (current.toList()..remove(deviceId)) : [...current, deviceId];
    state = next;
    await ref.read(sharedPrefsProvider).setStringList(_key(home), next);
  }
}

final favouritesSettingProvider = NotifierProvider<FavouritesController, List<String>?>(
  FavouritesController.new,
);

/// The favourite devices to show (at most six), live.
final favouriteDevicesProvider = Provider<List<Device>>((ref) {
  final devices = ref.watch(devicesProvider).value ?? const [];
  final chosen = ref.watch(favouritesSettingProvider);
  final switches = devices.where((d) => d.controllable).toList();
  if (chosen == null) return switches.take(FavouritesController.max).toList();
  final byId = {for (final d in switches) d.id: d};
  return [
    for (final id in chosen)
      if (byId[id] != null) byId[id]!,
  ].take(FavouritesController.max).toList();
});

/// The ids currently shown as favourites (what the star in a device's sheet compares with).
final favouriteIdsProvider = Provider<List<String>>(
  (ref) => ref.watch(favouriteDevicesProvider).map((d) => d.id).toList(),
);

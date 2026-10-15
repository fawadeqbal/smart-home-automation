import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/models/device.dart';
import '../data/models/session.dart';
import 'devices.dart';

/// A room with its devices and how it's doing — what the room cards, the room page and home
/// health show.
@immutable
class RoomSummary {
  const RoomSummary({
    required this.room,
    required this.index,
    required this.devices,
  });

  final Room room;

  /// Its position in the home (picks its colours).
  final int index;
  final List<Device> devices;

  List<Device> get switches => devices.where((d) => d.controllable).toList();
  int get onCount => switches.where((d) => d.isOn).length;

  /// Some of its devices are on a board that isn't answering.
  bool get notResponding => devices.isNotEmpty && devices.any((d) => !d.online);
  bool get allDown => devices.isNotEmpty && devices.every((d) => !d.online);

  String get status => allDown
      ? 'Not responding'
      : switches.isEmpty
      ? (devices.isEmpty ? 'Nothing here yet' : '${devices.length} sensor${devices.length == 1 ? '' : 's'}')
      : onCount == 0
      ? 'All off'
      : '$onCount of ${switches.length} on';
}

/// Every room this person can see, with its devices. Devices without a room come last as "Other".
final roomSummariesProvider = Provider<List<RoomSummary>>((ref) {
  final rooms = ref.watch(roomsProvider).value ?? const [];
  final devices = ref.watch(devicesProvider).value ?? const [];
  final out = <RoomSummary>[];
  for (final (i, r) in rooms.indexed) {
    out.add(
      RoomSummary(
        room: r,
        index: i,
        devices: devices.where((d) => d.roomId == r.id).toList(),
      ),
    );
  }
  final loose = devices.where((d) => d.roomId == null || !rooms.any((r) => r.id == d.roomId)).toList();
  if (loose.isNotEmpty) {
    out.add(
      RoomSummary(
        room: const Room(
          id: '_other',
          name: 'Other',
          order: 999,
          access: Access.view,
        ),
        index: rooms.length,
        devices: loose,
      ),
    );
  }
  return out;
});

final roomSummaryProvider = Provider.family<RoomSummary?, String>(
  (ref, roomId) => ref.watch(roomSummariesProvider).where((r) => r.room.id == roomId).firstOrNull,
);

/// The open home at a glance: what's on, and which rooms aren't answering.
@immutable
class HomeHealth {
  const HomeHealth({required this.rooms, required this.down, required this.on});
  final List<RoomSummary> rooms;
  final List<RoomSummary> down;
  final List<Device> on;
  bool get ok => down.isEmpty;
}

final homeHealthProvider = Provider<HomeHealth>((ref) {
  final rooms = ref.watch(roomSummariesProvider).where((r) => r.devices.isNotEmpty).toList();
  final devices = ref.watch(devicesProvider).value ?? const [];
  return HomeHealth(
    rooms: rooms,
    down: rooms.where((r) => r.notResponding).toList(),
    on: devices.where((d) => d.controllable && d.isOn).toList(),
  );
});

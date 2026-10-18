import 'package:flutter/foundation.dart';

import 'json.dart';
import 'session.dart';

/// A room of the open home this person can see (`/rooms`), with their access in it.
@immutable
class Room {
  const Room({
    required this.id,
    required this.name,
    this.order = 0,
    this.access = Access.view,
  });

  factory Room.fromJson(Json json) => Room(
    id: str(json['id']),
    name: str(json['name'], 'Room'),
    order: integer(json['order']),
    access: Access.fromJson(json['access']),
  );

  final String id;
  final String name;

  /// Its place in the home (lower first).
  final int order;
  final Access access;
}

/// A device on one of the home's boards: a switch (light, fan, socket…) or a sensor (`/devices`).
///
/// [state] is what the board last reported — `{on}` for switches, `{temperature, humidity}`,
/// `{active}`, `{level}` for sensors; `features/devices/device_kinds.dart` knows how to show each.
@immutable
class Device {
  const Device({
    required this.id,
    required this.key,
    required this.name,
    required this.type,
    this.typeLabel = '',
    this.controllable = false,
    this.online = false,
    this.enabled = true,
    this.state = const {},
    this.aliases = const [],
    this.settings = const {},
    this.access = Access.view,
    this.nodeId = '',
    this.nodeName = '',
    this.roomId,
    this.roomName,
    this.source,
    this.updatedAt,
    this.childLock = false,
    this.speeds = 0,
    this.restoreOff = false,
    this.waiting = false,
  });

  factory Device.fromJson(Json json) => Device(
    id: str(json['id']),
    key: str(json['key']),
    name: str(json['name'], 'Device'),
    type: str(json['type']),
    typeLabel: str(json['typeLabel']),
    controllable: boolean(json['controllable']),
    online: boolean(json['online']),
    enabled: boolean(json['enabled'], true),
    state: asJson(json['state']),
    aliases: strList(json['aliases']),
    settings: asJson(json['settings']),
    access: Access.fromJson(json['access']),
    nodeId: str(json['nodeId']),
    nodeName: str(json['nodeName']),
    roomId: strOrNull(json['roomId']),
    roomName: strOrNull(json['roomName']),
    source: strOrNull(json['source']),
    updatedAt: dateOrNull(json['updatedAt']),
    childLock: boolean(json['childLock']),
    speeds: integer(json['speeds']),
    restoreOff: boolean(json['restoreOff']),
    waiting: boolean(json['waiting']),
  );

  final String id;

  /// Its name on the board (stable, unlike [name]).
  final String key;
  final String name;

  /// `switch`, `dht`, `contact`, `analog`… — new types may arrive before the app knows them.
  final String type;
  final String typeLabel;

  /// Can be switched on and off (the type says so, not the person's rights — see [canControl]).
  final bool controllable;

  /// Its board is connected.
  final bool online;
  final bool enabled;
  final Map<String, dynamic> state;

  /// Other names people call it ("pankha"), for the assistant.
  final List<String> aliases;

  /// Type-specific settings (e.g. a contact sensor's `kind`: door, window, motion, leak).
  final Map<String, dynamic> settings;

  /// This person's access to it (from its room).
  final Access access;
  final String nodeId;
  final String nodeName;
  final String? roomId;
  final String? roomName;

  /// What made the last change: `app`, `button` (wall switch), `automation`, `boot`…
  final String? source;
  final DateTime? updatedAt;

  /// Only the owner and admins may switch it (the server enforces it).
  final bool childLock;

  /// A fan's number of speeds (0 for anything else).
  final int speeds;

  /// It stays off after a power cut instead of coming back the way it was.
  final bool restoreOff;
  /// Its board is broken and was taken out of service: the device is kept (with its timers and scenes),
  /// waiting for the installer to put in a replacement board.
  final bool waiting;

  bool get isOn => state['on'] == true;

  /// A fan's speed (1..[speeds]); kept while it is off. Null for anything else.
  int? get speed => state['speed'] is num ? (state['speed'] as num).toInt() : null;

  /// This person may switch it (a switch, enabled, in a room they control).
  bool get canControl => controllable && enabled && access.canControl;

  /// Its board answers — a command would reach it.
  bool get responding => online && !waiting;

  Device copyWith({
    String? name,
    bool? online,
    bool? enabled,
    Map<String, dynamic>? state,
    String? source,
    DateTime? updatedAt,
  }) => Device(
    id: id,
    key: key,
    name: name ?? this.name,
    type: type,
    typeLabel: typeLabel,
    controllable: controllable,
    online: online ?? this.online,
    enabled: enabled ?? this.enabled,
    state: state ?? this.state,
    aliases: aliases,
    settings: settings,
    access: access,
    nodeId: nodeId,
    nodeName: nodeName,
    roomId: roomId,
    roomName: roomName,
    source: source ?? this.source,
    updatedAt: updatedAt ?? this.updatedAt,
    childLock: childLock,
    speeds: speeds,
    restoreOff: restoreOff,
    waiting: waiting,
  );
}

import 'package:flutter/foundation.dart';

import 'json.dart';

/// How a change happened, as the API tells it (`via`).
enum EventVia {
  app('app'),
  voice('voice'),
  wall('wall switch'),
  schedule('schedule'),
  board('board'),
  sensor('sensor');

  const EventVia(this.label);

  /// In words, lower case ("Zara · voice").
  final String label;

  /// Something this app doesn't know yet counts as the app — someone did it.
  static EventVia fromJson(Object? value) => enumOf(values, value, app);
}

/// One change to a device: "Bedroom fan turned off · Zara · voice" (`/events`, `/devices/:id/history`).
@immutable
class ActivityEvent {
  const ActivityEvent({
    required this.id,
    required this.at,
    required this.deviceId,
    required this.deviceName,
    this.deviceType = '',
    this.roomId,
    this.roomName,
    this.state = const {},
    this.via = EventVia.app,
    this.by,
  });

  factory ActivityEvent.fromJson(Json json) => ActivityEvent(
    id: str(json['id']),
    at: dateOrNull(json['at']) ?? DateTime.fromMillisecondsSinceEpoch(0),
    deviceId: str(json['deviceId']),
    deviceName: str(json['deviceName'], 'A device'),
    deviceType: str(json['deviceType']),
    roomId: strOrNull(json['roomId']),
    roomName: strOrNull(json['roomName']),
    state: asJson(json['state']),
    via: EventVia.fromJson(json['via']),
    by: strOrNull(json['by']),
  );

  final String id;
  final DateTime at;
  final String deviceId;
  final String deviceName;
  final String deviceType;
  final String? roomId;
  final String? roomName;

  /// The device's state after the change.
  final Map<String, dynamic> state;
  final EventVia via;

  /// The person who did it (or whose schedule it was); null for wall switches and sensors.
  final String? by;

  /// A switch turned on/off — null when this wasn't a switch.
  bool? get on => boolOrNull(state['on']);

  /// A sensor triggered/back to normal — null when this wasn't a contact sensor.
  bool? get active => boolOrNull(state['active']);
}

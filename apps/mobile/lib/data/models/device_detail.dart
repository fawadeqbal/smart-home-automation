import 'package:flutter/foundation.dart';

import 'device.dart';
import 'json.dart';

/// A reading a sensor reports ("temperature", "°C"), from `stateFields`.
@immutable
class StateField {
  const StateField({required this.key, required this.label, this.unit = ''});

  factory StateField.fromJson(Json j) => StateField(key: str(j['key']), label: str(j['label'], str(j['key'])), unit: str(j['unit']));

  final String key, label, unit;
}

/// One device with what its own page shows (`/devices/:id`): its safety settings, power and readings.
@immutable
class DeviceDetail {
  const DeviceDetail({
    required this.device,
    this.typeLabel = '',
    this.pinLabel = '',
    this.stateFields = const [],
    this.autoOffMinutes,
    this.autoOffAt,
    this.watts,
  });

  factory DeviceDetail.fromJson(Json j) => DeviceDetail(
        device: Device.fromJson(j),
        typeLabel: str(j['typeLabel']),
        pinLabel: str(j['pinLabel']),
        stateFields: asJsonList(j['stateFields']).map(StateField.fromJson).toList(),
        autoOffMinutes: j['autoOffMinutes'] is num ? integer(j['autoOffMinutes']) : null,
        autoOffAt: dateOrNull(j['autoOffAt']),
        watts: j['watts'] is num ? integer(j['watts']) : null,
      );

  final Device device;
  final String typeLabel, pinLabel;
  final List<StateField> stateFields;

  /// Switches itself off this long after it was turned on (null: never).
  final int? autoOffMinutes;
  final DateTime? autoOffAt;

  /// Its power as the owner set it (null: guessed from its name).
  final int? watts;

  /// The safety auto-off choices the web offers (0 = never), plus the current one if it's another.
  List<int> get autoOffChoices {
    const base = [0, 15, 30, 60, 90, 120, 180, 240];
    final m = autoOffMinutes ?? 0;
    return base.contains(m) ? base : ([...base, m]..sort());
  }

  /// "Never", "After 30 min", "After 1 hour", "After 2 hours", "After 1 h 30 min".
  static String autoOffText(int m) => m == 0
      ? 'Never'
      : m < 60
          ? 'After $m min'
          : m == 60
              ? 'After 1 hour'
              : m % 60 == 0
                  ? 'After ${m ~/ 60} hours'
                  : 'After ${m ~/ 60} h ${m % 60} min';
}

/// One point of a sensor's history, for the chart.
typedef Reading = ({DateTime at, double value});

/// The [field] readings in [history] (newest first, as the server sends them), oldest first.
List<Reading> readingsOf(List<Json> history, String field) {
  final out = <Reading>[];
  for (final h in history.reversed) {
    final v = asJson(h['state'])[field];
    final at = dateOrNull(h['at']);
    if (v is num && at != null) out.add((at: at, value: v.toDouble()));
  }
  return out;
}

import 'json.dart';

double _num(Object? v) => v is num ? v.toDouble() : double.tryParse('$v') ?? 0;
double? _numOrNull(Object? v) => v is num ? v.toDouble() : null;

/// A daily load-shedding window, "14:00" to "15:00" in the home's time zone (some only on certain weekdays).
class CutWindow {
  const CutWindow({required this.from, required this.to, this.days = const [], this.seen, this.of});

  factory CutWindow.fromJson(Json j) => CutWindow(
        from: str(j['from']),
        to: str(j['to']),
        days: intList(j['days']),
        seen: j['seen'] is num ? integer(j['seen']) : null,
        of: j['of'] is num ? integer(j['of']) : null,
      );

  final String from, to;
  final List<int> days;
  final int? seen, of;

  static const _dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  /// "14:00" -> "2:00 pm"
  static String ampm(String hhmm) {
    final parts = hhmm.split(':');
    final h = int.tryParse(parts.first) ?? 0;
    final m = parts.length > 1 ? parts[1] : '00';
    return '${h % 12 == 0 ? 12 : h % 12}:$m ${h < 12 ? 'am' : 'pm'}';
  }

  /// "2:00 pm – 3:00 pm · Mon, Wed · 9 of 14 days"
  String get text => [
        '${ampm(from)} – ${ampm(to)}',
        if (days.isNotEmpty) days.map((d) => _dayNames[d % 7]).join(', '),
        if (seen != null) '$seen of ${of ?? 14} days',
      ].join(' · ');

  Json toJson() => {'from': from, 'to': to, if (days.isNotEmpty) 'days': days};
}

/// The next expected cut: "today around 2:00 pm" (or one going on now).
class NextCut {
  const NextCut({required this.text, required this.now});

  static NextCut? fromJson(Object? v) {
    final j = asJson(v);
    if (j.isEmpty) return null;
    return NextCut(text: str(j['text']), now: boolean(j['now']));
  }

  final String text;
  final bool now;
}

/// The home page's power line (`/power`): on UPS or not, and the next expected cut.
class PowerStatus {
  const PowerStatus({
    this.sensor = false,
    this.gridOff = false,
    this.sinceText,
    this.switchedOff = const [],
    this.next,
    this.source = 'none',
    this.loaded = false,
  });

  factory PowerStatus.fromJson(Json j) {
    final g = asJson(j['grid']);
    return PowerStatus(
      sensor: boolean(g['sensor']),
      gridOff: boolean(g['off']),
      sinceText: strOrNull(g['sinceText']),
      switchedOff: strList(g['switchedOff']),
      next: NextCut.fromJson(j['next']),
      source: str(j['source'], 'none'),
      loaded: true,
    );
  }

  final bool sensor, gridOff;
  final String? sinceText;
  final List<String> switchedOff;
  final NextCut? next;

  /// typed (the area's schedule), learned (the home's cuts), area (other homes nearby) or none
  final String source;
  final bool loaded;

  /// "On UPS/solar since 2:03 pm" / "Next expected cut: today around 2:00 pm" / null (nothing to say)
  String? get headline => gridOff
      ? 'On UPS/solar since ${sinceText ?? 'a while'}'
      : next == null
          ? null
          : next!.now
              ? 'Load-shedding time: ${next!.text}'
              : 'Next expected cut: ${next!.text}';

  String get detail => gridOff
      ? (switchedOff.isEmpty ? 'The grid power is off. Go easy on the AC, iron and geyser.' : 'Switched off to save the battery: ${switchedOff.join(', ')}.')
      : source == 'typed'
          ? 'From your area’s schedule'
          : 'From the power cuts of the last two weeks — usually, not always';
}

/// Load-shedding (`/power/shedding`): the windows in use, and the learned ones with the day strip.
class Shedding {
  const Shedding({
    this.source = 'none',
    this.windows = const [],
    this.typed = const [],
    this.learned = const [],
    this.slots = const [],
    this.observedDays = 14,
    this.needed = 5,
    this.place,
    this.next,
    this.loaded = false,
  });

  factory Shedding.fromJson(Json j) {
    final l = asJson(j['learned']);
    return Shedding(
      source: str(j['source'], 'none'),
      windows: asJsonList(j['windows']).map(CutWindow.fromJson).toList(),
      typed: asJsonList(j['typed']).map(CutWindow.fromJson).toList(),
      learned: asJsonList(l['windows']).map(CutWindow.fromJson).toList(),
      slots: intList(l['slots']),
      observedDays: integer(l['observedDays'], 14),
      needed: integer(l['needed'], 5),
      place: strOrNull(l['place']),
      next: NextCut.fromJson(j['next']),
      loaded: true,
    );
  }

  final String source;
  final List<CutWindow> windows, typed, learned;

  /// in how many of the last 14 days each half hour (48 of them, from midnight) had a cut
  final List<int> slots;
  final int observedDays, needed;
  final String? place;
  final NextCut? next;
  final bool loaded;

  String get how => switch (source) {
        'typed' => 'From the schedule you typed in (used instead of the learned one).',
        'area' => 'Learned from other homes in ${place ?? 'your area'}: this home has too few days of its own yet.',
        'learned' => 'Learned from the power cuts of the last $observedDays days: a time counts when the power went then on at least $needed of them.',
        _ => 'A time shows up here once the power goes at about the same time on $needed or more of the last $observedDays days.',
      };
}

/// One meter reading the owner typed.
class MeterReading {
  const MeterReading({required this.id, required this.kwh, required this.readAt, this.newMeter = false, this.by});

  factory MeterReading.fromJson(Json j) => MeterReading(
        id: str(j['id']),
        kwh: _num(j['kwh']),
        readAt: dateOrNull(j['readAt']) ?? DateTime.now(),
        newMeter: boolean(j['newMeter']),
        by: strOrNull(j['by']),
      );

  final String id;
  final double kwh;
  final DateTime readAt;
  final bool newMeter;
  final String? by;
}

/// This billing month from the meter readings (`/power/bill`).
class Bill {
  const Bill({
    this.units = 0,
    this.projected,
    this.source = 'none',
    this.estimated = 0,
    this.costSoFar = 0,
    this.costProjected,
    this.protectedLimit,
    this.over = false,
    this.heading = false,
    this.message = '',
    this.billingDay = 1,
    this.billingDayText = '1st',
    this.daysLeft = 0,
    this.topDevices = const [],
    this.lastMonth,
    this.latestKwh,
    this.loaded = false,
  });

  factory Bill.fromJson(Json j) {
    final cost = asJson(j['cost']);
    final cycle = asJson(j['cycle']);
    final latest = asJson(j['latest']);
    return Bill(
      units: _num(j['units']),
      projected: _numOrNull(j['projected']),
      source: str(j['source'], 'none'),
      estimated: _num(j['estimated']),
      costSoFar: integer(cost['soFar']),
      costProjected: cost['projected'] is num ? integer(cost['projected']) : null,
      protectedLimit: j['protectedLimit'] is num ? integer(j['protectedLimit']) : null,
      over: boolean(j['over']),
      heading: boolean(j['heading']),
      message: str(j['message']),
      billingDay: integer(j['billingDay'], 1),
      billingDayText: str(j['billingDayText'], '1st'),
      daysLeft: integer(cycle['daysLeft']),
      topDevices: [for (final d in asJsonList(j['topDevices'])) (str(d['name']), _num(d['kwh']))],
      lastMonth: _numOrNull(j['lastMonth']),
      latestKwh: _numOrNull(latest['kwh']),
      loaded: true,
    );
  }

  final double units;
  final double? projected;

  /// readings, readings+estimate, estimate or none
  final String source;
  final double estimated;
  final int costSoFar;
  final int? costProjected;
  final int? protectedLimit;
  final bool over, heading;
  final String message;
  final int billingDay;
  final String billingDayText;
  final int daysLeft;
  final List<(String, double)> topDevices;
  final double? lastMonth, latestKwh;
  final bool loaded;

  bool get warn => over || heading;

  /// how far through the protected limit (0..1), now and at this pace
  double get limitShare => protectedLimit == null ? 0 : (units / protectedLimit!).clamp(0, 1).toDouble();
  double get limitShareEnd => protectedLimit == null || projected == null ? 0 : (projected! / protectedLimit!).clamp(0, 1).toDouble();

  String get unitsNote => switch (source) {
        'readings' => 'from your meter readings',
        'readings+estimate' => '${estimated.round()} of them estimated (no reading from the billing day)',
        'estimate' => 'an estimate from the switches — add a meter reading',
        _ => 'no reading yet',
      };
}

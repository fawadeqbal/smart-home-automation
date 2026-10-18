import 'json.dart';

double _num(Object? v) => v is num ? v.toDouble() : double.tryParse('$v') ?? 0;

/// One switch's share of the electricity (an estimate from its on-time and power).
class EnergyDevice {
  const EnergyDevice({
    this.id = '',
    required this.name,
    this.room,
    this.watts = 0,
    this.wattsSource = 'unknown',
    this.hours = 0,
    this.kwh = 0,
    this.cost = 0,
    this.onNow = false,
  });

  factory EnergyDevice.fromJson(Json j) => EnergyDevice(
        id: str(j['id']),
        onNow: boolean(j['onNow']),
        name: str(j['name'], 'Device'),
        room: strOrNull(j['room']),
        watts: integer(j['watts']),
        wattsSource: str(j['wattsSource'], 'unknown'),
        hours: _num(j['hours']),
        kwh: _num(j['kwh']),
        cost: integer(j['cost']),
      );

  final String id;
  final String name;
  final String? room;
  final int watts;

  /// `set` by the owner, `guessed` from its name, or `unknown` (counts as 0).
  final String wattsSource;
  final double hours, kwh;
  final int cost;

  /// Switched on right now.
  final bool onNow;

  /// Its share of [total] units (0..1).
  double shareOf(double total) => total <= 0 ? 0 : (kwh / total).clamp(0, 1).toDouble();

  /// "1500 W", "15 W (guessed)", "power not set".
  String get wattsText => wattsSource == 'unknown' ? 'power not set' : '$watts W${wattsSource == 'guessed' ? ' (guessed)' : ''}';
}

/// One day's estimated units (`perDay`), in the home's calendar.
class EnergyDay {
  const EnergyDay({required this.day, this.kwh = 0, this.cost = 0});

  factory EnergyDay.fromJson(Json j) => EnergyDay(day: str(j['day']), kwh: _num(j['kwh']), cost: integer(j['cost']));

  /// "2026-10-19"
  final String day;
  final double kwh;
  final int cost;

  DateTime? get date => DateTime.tryParse('${day}T12:00:00');

  /// "Mon" for a week, "19" for a month.
  String label({required bool short}) {
    final d = date;
    if (d == null) return '';
    return short ? const ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][d.weekday - 1] : '${d.day}';
  }
}

/// Electricity for a number of days (`/energy`): units, rupees, a month at this pace, by device.
class Energy {
  const Energy({
    this.days = 7,
    this.kwh = 0,
    this.cost = 0,
    this.hours = 0,
    this.tariff = 0,
    this.tariffSet = false,
    this.monthKwh = 0,
    this.monthCost = 0,
    this.devices = const [],
    this.perDay = const [],
    this.unknown = 0,
    this.powerCuts = 0,
    this.loaded = false,
  });

  factory Energy.fromJson(Json j) {
    final total = asJson(j['total']);
    final month = asJson(j['month']);
    return Energy(
      days: integer(j['days'], 7),
      kwh: _num(total['kwh']),
      cost: integer(total['cost']),
      hours: _num(total['hours']),
      tariff: _num(j['tariff']),
      tariffSet: boolean(j['tariffSet']),
      monthKwh: integer(month['kwh']),
      monthCost: integer(month['cost']),
      devices: asJsonList(j['devices']).map(EnergyDevice.fromJson).toList(),
      perDay: asJsonList(j['perDay']).map(EnergyDay.fromJson).toList(),
      unknown: integer(j['unknown']),
      powerCuts: integer(j['powerCuts']),
      loaded: true,
    );
  }

  final int days;
  final double kwh;
  final int cost;

  /// Hours of switches on, added up.
  final double hours;

  /// Rupees per unit, and whether the owner set it (else a typical rate).
  final double tariff;
  final bool tariffSet;
  final int monthKwh, monthCost;
  final List<EnergyDevice> devices;
  final List<EnergyDay> perDay;

  /// Switches without a power rating (they count as 0).
  final int unknown;

  /// Power cuts in this time (left out: nothing runs without power).
  final int powerCuts;
  final bool loaded;

  /// The busiest day's units (at least a little, so bars never divide by 0).
  double get maxDay => perDay.fold<double>(.01, (m, d) => d.kwh > m ? d.kwh : m);

  /// "4 h 30 min", "45 min".
  static String hoursText(double h) {
    if (h < 1) return '${(h * 60).round()} min';
    return h < 10 ? '${h.toStringAsFixed(1)} h' : '${h.round()} h';
  }

  /// "Rs 48" or "Rs 47.5" for a rate.
  static String rate(double r) => 'Rs ${r == r.roundToDouble() ? r.round() : r.toStringAsFixed(1)}';

  /// The WhatsApp text the web shares: the estimate and the five biggest users.
  String shareText(String home, String period) => [
        '*$home — electricity, $period* (estimate)',
        'About ${units(kwh)} units, ${rupees(cost)} at ${rate(tariff)} a unit.',
        'A month at this pace: ~$monthKwh units, ${rupees(monthCost)}.',
        for (final d in devices.where((d) => d.kwh > 0).take(5)) '• ${d.name}: ${units(d.kwh)} units, ${rupees(d.cost)}',
      ].join('\n');

  /// "12.5" under 10 units, whole numbers above ("12,151").
  static String units(double kwh) => kwh < 10 ? kwh.toStringAsFixed(1) : _grouped(kwh.round());

  static String _grouped(int n) {
    final s = n.abs().toString();
    final out = StringBuffer();
    for (var i = 0; i < s.length; i++) {
      if (i > 0 && (s.length - i) % 3 == 0) out.write(',');
      out.write(s[i]);
    }
    return '${n < 0 ? '-' : ''}$out';
  }

  /// "Rs 1,240".
  static String rupees(int n) => 'Rs ${n < 0 ? '-' : ''}${_grouped(n.abs())}';
}

/// How the home did today or this week, in a few lines, and as text to share (`/home/summary`).
class HomeSummary {
  const HomeSummary({this.home = '', this.period = 'week', this.range = '', this.lines = const [], this.text = '', this.mail = false, this.loaded = false});

  factory HomeSummary.fromJson(Json j) => HomeSummary(
        home: str(j['home']),
        period: str(j['period'], 'week'),
        range: str(j['range']),
        lines: strList(j['lines']),
        text: str(j['text']),
        mail: boolean(j['mail']),
        loaded: true,
      );

  final String home;

  /// `day` or `week`.
  final String period;
  final String range;
  final List<String> lines;
  final String text;

  /// The server can email it.
  final bool mail;
  final bool loaded;

  /// "Power: 2 cuts" -> ("Power", "2 cuts"); a line without a heading has an empty one.
  static (String, String) split(String line) {
    final at = line.indexOf(': ');
    return at < 0 ? ('', line) : (line.substring(0, at), line.substring(at + 2));
  }
}

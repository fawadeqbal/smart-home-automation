import 'json.dart';

double _num(Object? v) => v is num ? v.toDouble() : double.tryParse('$v') ?? 0;

/// One switch's share of the electricity (an estimate from its on-time and power).
class EnergyDevice {
  const EnergyDevice({required this.name, this.room, this.watts = 0, this.wattsSource = 'unknown', this.hours = 0, this.kwh = 0, this.cost = 0});

  factory EnergyDevice.fromJson(Json j) => EnergyDevice(
        name: str(j['name'], 'Device'),
        room: strOrNull(j['room']),
        watts: integer(j['watts']),
        wattsSource: str(j['wattsSource'], 'unknown'),
        hours: _num(j['hours']),
        kwh: _num(j['kwh']),
        cost: integer(j['cost']),
      );

  final String name;
  final String? room;
  final int watts;

  /// `set` by the owner, `guessed` from its name, or `unknown` (counts as 0).
  final String wattsSource;
  final double hours, kwh;
  final int cost;
}

/// Electricity for a number of days (`/energy`): units, rupees, a month at this pace, by device.
class Energy {
  const Energy({this.days = 7, this.kwh = 0, this.cost = 0, this.tariff = 0, this.monthKwh = 0, this.monthCost = 0, this.devices = const [], this.loaded = false});

  factory Energy.fromJson(Json j) {
    final total = asJson(j['total']);
    final month = asJson(j['month']);
    return Energy(
      days: integer(j['days'], 7),
      kwh: _num(total['kwh']),
      cost: integer(total['cost']),
      tariff: _num(j['tariff']),
      monthKwh: integer(month['kwh']),
      monthCost: integer(month['cost']),
      devices: asJsonList(j['devices']).map(EnergyDevice.fromJson).toList(),
      loaded: true,
    );
  }

  final int days;
  final double kwh;
  final int cost;
  final double tariff;
  final int monthKwh, monthCost;
  final List<EnergyDevice> devices;
  final bool loaded;

  /// "12.5" under 10 units, whole numbers above.
  static String units(double kwh) => kwh < 10 ? kwh.toStringAsFixed(1) : kwh.round().toString();

  /// "Rs 1,240".
  static String rupees(int n) {
    final s = n.abs().toString();
    final out = StringBuffer();
    for (var i = 0; i < s.length; i++) {
      if (i > 0 && (s.length - i) % 3 == 0) out.write(',');
      out.write(s[i]);
    }
    return 'Rs ${n < 0 ? '-' : ''}$out';
  }
}

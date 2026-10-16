import 'json.dart';

/// A power cut, a Wi-Fi / internet outage or a board restart (worked out by the server).
class Outage {
  const Outage({required this.kind, required this.board, required this.startedAt, required this.endedAt, required this.seconds});

  factory Outage.fromJson(Json j) => Outage(
        kind: str(j['kind'], 'UNKNOWN'),
        board: str(j['board']),
        startedAt: dateOrNull(j['startedAt']) ?? DateTime.now(),
        endedAt: dateOrNull(j['endedAt']) ?? DateTime.now(),
        seconds: integer(j['seconds']),
      );

  final String kind;
  final String board;
  final DateTime startedAt, endedAt;
  final int seconds;

  bool get isPower => kind == 'POWER';
  bool get isNetwork => kind == 'NETWORK';
  bool get counts => isPower || isNetwork;

  String get label => switch (kind) {
        'POWER' => 'Power cut',
        'NETWORK' => 'Wi‑Fi or internet down',
        'CRASH' => 'Board restarted after a fault',
        'RESTART' => 'Board restarted',
        'RESET' => 'Board reset',
        _ => 'Board was offline',
      };
}

class HomeOutages {
  const HomeOutages({this.powerCuts = 0, this.powerSeconds = 0, this.networkOuts = 0, this.networkSeconds = 0, this.outages = const []});

  factory HomeOutages.fromJson(Json j) {
    final s = asJson(j['summary']);
    return HomeOutages(
      powerCuts: integer(s['powerCuts']),
      powerSeconds: integer(s['powerSeconds']),
      networkOuts: integer(s['networkOuts']),
      networkSeconds: integer(s['networkSeconds']),
      outages: asJsonList(j['outages']).map(Outage.fromJson).toList(),
    );
  }

  final int powerCuts, powerSeconds, networkOuts, networkSeconds;
  final List<Outage> outages;
}

/// "55 min", "2 h 10 min".
String outageDuration(int seconds) {
  final m = (seconds / 60).round();
  if (m < 1) return '${seconds < 1 ? 1 : seconds} s';
  if (m < 60) return '$m min';
  final h = m ~/ 60;
  return '$h h${m % 60 > 0 ? ' ${m % 60} min' : ''}';
}

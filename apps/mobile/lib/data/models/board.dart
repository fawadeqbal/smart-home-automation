import 'package:flutter/foundation.dart';

import 'json.dart';

/// How one board behind a switchboard is doing (`/nodes`, owners and admins), like the web's Diagnostics.
@immutable
class BoardInfo {
  const BoardInfo({
    required this.id,
    required this.name,
    this.status = 'ADOPTED',
    this.online = false,
    this.waiting = false,
    this.firmware,
    this.lastSeenAt,
    this.configError,
    this.configRev = 0,
    this.appliedRev = 0,
    this.rssi,
    this.vcc,
    this.heap,
    this.uptime,
    this.connects,
    this.devices = 0,
  });

  factory BoardInfo.fromJson(Json j) {
    final h = asJson(j['health']);
    int? n(Object? v) => v is num ? v.round() : null;
    return BoardInfo(
      id: str(j['id']),
      name: str(j['name'], str(j['id'])),
      status: str(j['status'], 'ADOPTED'),
      online: boolean(j['online']),
      waiting: boolean(j['waiting']),
      firmware: strOrNull(j['firmware']),
      lastSeenAt: dateOrNull(j['lastSeenAt']),
      configError: strOrNull(j['configError']),
      configRev: integer(j['configRev']),
      appliedRev: integer(j['appliedRev']),
      rssi: n(h['rssi']) ?? n(j['rssi']),
      vcc: n(h['vcc']),
      heap: n(h['heap']),
      uptime: n(h['uptime']),
      connects: n(h['connects']),
      devices: j['devices'] is List ? (j['devices'] as List).length : integer(j['devices']),
    );
  }

  final String id, name, status;
  final bool online, waiting;
  final String? firmware;
  final DateTime? lastSeenAt;
  final String? configError;
  final int configRev, appliedRev;

  /// Wi‑Fi signal (dBm), supply (mV), free memory (bytes), seconds since it started, connections since then.
  final int? rssi, vcc, heap, uptime, connects;
  final int devices;

  /// Installed in the home (and boards out of service that still hold its devices).
  bool get installed => status == 'ADOPTED' || status == 'FAULTY';

  /// (tone ok/warn/bad, label) — the web's `boardCondition`.
  (String, String) get condition {
    if (waiting) return ('bad', 'Waiting for a replacement board');
    if (!online) return ('bad', 'Disconnected');
    if (configError != null) return ('bad', 'Setup rejected');
    if (appliedRev != configRev) return ('warn', 'Applying setup');
    if (vcc != null && vcc! < 3000) return ('warn', 'Low supply voltage');
    if (rssi != null && rssi! < -80) return ('warn', 'Weak Wi‑Fi');
    if (heap != null && heap! < 8000) return ('warn', 'Low memory');
    if (connects != null && connects! > 3) return ('warn', 'Unstable connection');
    return ('ok', 'Healthy');
  }

  /// "Good (-60 dBm)".
  String get signalText {
    if (rssi == null) return '—';
    final bars = rssi! > -55 ? 4 : rssi! > -67 ? 3 : rssi! > -75 ? 2 : rssi! > -85 ? 1 : 0;
    return '${const ['Very weak', 'Weak', 'Fair', 'Good', 'Excellent'][bars]} ($rssi dBm)';
  }

  String get supplyText => vcc == null ? '—' : '${(vcc! / 1000).toStringAsFixed(2)} V';
  String get memoryText => heap == null ? '—' : '${(heap! / 1024).round()} KB free';

  String get uptimeText {
    final s = uptime;
    if (s == null) return '—';
    final d = s ~/ 86400, h = (s % 86400) ~/ 3600, m = (s % 3600) ~/ 60;
    return d > 0 ? '$d d $h h' : h > 0 ? '$h h $m min' : '$m min';
  }

  /// What to try, in plain words (the web's `advice`); empty when it's fine.
  List<String> get advice {
    final where = name.toLowerCase().replaceAll(RegExp(r'\s*board$'), '');
    if (!online) {
      return [
        'Check the breaker (MCB) for the $where in your main panel is switched up.',
        'Look at the board: a steady blue light means power but no Wi‑Fi; no light means no power.',
        'Restart your Wi‑Fi router — the board rejoins by itself within a minute.',
      ];
    }
    if (configError != null) return ['The board refused its settings: $configError', 'Your installer can fix this from the board’s pins page.'];
    if (vcc != null && vcc! < 3000) {
      return ['The supply is low ($supplyText; boards need 3.0 V or more).', 'Ask the installer to replace the power adapter behind the $where switchboard.'];
    }
    if (rssi != null && rssi! < -75) {
      return ['The board hears your Wi‑Fi weakly ($rssi dBm), so switching can feel slow.', 'A Wi‑Fi extender near the $where switchboard usually fixes this.'];
    }
    return const [];
  }
}

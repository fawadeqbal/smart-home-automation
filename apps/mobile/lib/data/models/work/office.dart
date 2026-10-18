import 'package:flutter/foundation.dart';

import '../json.dart';
import 'homes.dart';

/// A board in the company's inventory (`/platform/inventory`).
@immutable
class StockBoard {
  const StockBoard({
    required this.id,
    this.model = '',
    this.status = 'STOCK',
    this.homeId,
    this.homeName,
    this.location,
    this.installer,
    this.firmware,
    this.online = false,
    this.tone = Tone.mute,
    this.condText = '',
    this.note,
    this.devices = 0,
    this.addedAt,
  });

  factory StockBoard.fromJson(Json json) => StockBoard(
    id: str(json['id']),
    model: str(json['model']),
    status: str(json['status'], 'STOCK'),
    homeId: strOrNull(json['homeId']),
    homeName: strOrNull(json['homeName']),
    location: strOrNull(json['location']),
    installer: strOrNull(json['installer']),
    firmware: strOrNull(json['firmware']),
    online: boolean(json['online']),
    tone: toneOf(json['cond']),
    condText: str(json['condText']),
    note: strOrNull(json['note']),
    devices: integer(json['devices']),
    addedAt: dateOrNull(json['addedAt']),
  );

  final String id;
  final String model;

  /// `STOCK`, `ASSIGNED`, `ADOPTED`, `FAULTY`.
  final String status;
  final String? homeId, homeName, location, installer, firmware;
  final bool online;
  final Tone tone;
  final String condText;
  final String? note;
  final int devices;
  final DateTime? addedAt;
}

@immutable
class Inventory {
  const Inventory({this.boards = const [], this.homes = const [], this.inStock = 0, this.min = 0, this.low = false});

  factory Inventory.fromJson(Json json) {
    final stock = asJson(json['stock']);
    final boards = asJsonList(json['boards']).map(StockBoard.fromJson).toList();
    return Inventory(
      boards: boards,
      homes: [for (final h in asJsonList(json['homes'])) (id: str(h['id']), name: str(h['name'], 'Home'))],
      inStock: stock.isEmpty ? boards.where((b) => b.status == 'STOCK').length : integer(stock['inStock']),
      min: integer(stock['min']),
      low: boolean(stock['low']),
    );
  }

  final List<StockBoard> boards;
  final List<({String id, String name})> homes;
  final int inStock, min;

  /// Fewer boards in stock than the company's warning level.
  final bool low;
}

/// Someone who asked for a home visit on the website (`/platform/visit-requests`).
@immutable
class VisitRequest {
  const VisitRequest({
    required this.id,
    required this.name,
    this.phone = '',
    this.whatsapp,
    this.city = '',
    this.homeSize = '',
    this.status = 'NEW',
    this.statusLabel = '',
    this.note = '',
    this.createdAt,
    this.visitAt,
    this.assignee,
    this.homeName,
  });

  factory VisitRequest.fromJson(Json json) => VisitRequest(
    id: str(json['id']),
    name: str(json['name'], 'Someone'),
    phone: str(json['phone']),
    whatsapp: strOrNull(json['whatsapp']),
    city: str(json['city']),
    homeSize: str(json['homeSize']),
    status: str(json['status'], 'NEW'),
    statusLabel: str(json['statusLabel']),
    note: str(json['note']),
    createdAt: dateOrNull(json['createdAt']),
    visitAt: dateOrNull(json['visitAt']),
    assignee: strOrNull(json['assignee']),
    homeName: strOrNull(asJson(json['home'])['name']),
  );

  final String id, name, phone;
  final String? whatsapp;
  final String city, homeSize;

  /// `NEW`, `CONTACTED`, `SCHEDULED`, `CUSTOMER`, `CLOSED`.
  final String status;
  final String statusLabel, note;
  final DateTime? createdAt, visitAt;
  final String? assignee, homeName;

  Tone get tone => switch (status) {
    'NEW' => Tone.warn,
    'SCHEDULED' => Tone.info,
    'CUSTOMER' => Tone.ok,
    _ => Tone.mute,
  };
}

/// A quote for a customer (`/platform/quotes`).
@immutable
class QuoteRow {
  const QuoteRow({
    required this.id,
    required this.ref,
    this.status = 'DRAFT',
    this.customerName = '',
    this.city = '',
    this.total = 0,
    this.items = const [],
    this.whatsapp,
    this.homeName,
    this.validUntil,
    this.createdAt,
  });

  factory QuoteRow.fromJson(Json json) => QuoteRow(
    id: str(json['id']),
    ref: str(json['ref'], '#${str(json['number'])}'),
    status: str(json['status'], 'DRAFT'),
    customerName: str(json['customerName']),
    city: str(json['city']),
    total: json['total'] is num ? (json['total'] as num).round() : 0,
    items: [
      for (final i in asJsonList(json['items']))
        (name: str(i['name']), qty: str(i['qty'], '1'), unit: str(i['unit'], 'each')),
    ],
    whatsapp: strOrNull(json['whatsapp']),
    homeName: strOrNull(asJson(json['home'])['name']),
    validUntil: strOrNull(json['validUntil']),
    createdAt: dateOrNull(json['createdAt']),
  );

  final String id, ref, status, customerName, city;

  /// In rupees.
  final int total;
  final List<({String name, String qty, String unit})> items;
  final String? whatsapp, homeName;

  /// "2026-11-02".
  final String? validUntil;
  final DateTime? createdAt;

  String get statusLabel => switch (status) {
    'DRAFT' => 'Draft',
    'SENT' => 'Sent',
    'ACCEPTED' => 'Accepted',
    'DECLINED' => 'Declined',
    _ => status,
  };

  Tone get tone => switch (status) {
    'ACCEPTED' => Tone.ok,
    'SENT' => Tone.info,
    'DECLINED' => Tone.bad,
    _ => Tone.mute,
  };
}

/// "Rs 12,500".
String rupees(int n) {
  final s = n.abs().toString();
  final out = StringBuffer();
  for (var i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 == 0) out.write(',');
    out.write(s[i]);
  }
  return 'Rs ${n < 0 ? '-' : ''}$out';
}

/// Power cuts and internet outages in the homes the staff member looks after (`/platform/outages`).
@immutable
class StaffOutages {
  const StaffOutages({this.days = 7, this.homes = const [], this.areas = const [], this.down = const []});

  factory StaffOutages.fromJson(Json json) => StaffOutages(
    days: integer(json['days'], 7),
    homes: [
      for (final h in asJsonList(json['homes']))
        (
          homeId: str(h['homeId']),
          home: str(h['home'], 'Home'),
          power: integer(h['power']),
          powerSeconds: integer(h['powerSeconds']),
          network: integer(h['network']),
          networkSeconds: integer(h['networkSeconds']),
        ),
    ],
    areas: [
      for (final a in asJsonList(json['areas']))
        (
          place: str(a['place']),
          startedAt: dateOrNull(a['startedAt']),
          seconds: integer(a['seconds']),
          homes: strList(a['homes']),
        ),
    ],
    down: [
      for (final d in asJsonList(json['down']))
        (
          board: str(d['board']),
          home: str(d['home']),
          homeId: str(d['homeId']),
          place: strOrNull(d['place']),
          since: dateOrNull(d['since']),
        ),
    ],
  );

  final int days;
  final List<({String homeId, String home, int power, int powerSeconds, int network, int networkSeconds})> homes;

  /// Several homes in one area went down together: probably the area's electricity.
  final List<({String place, DateTime? startedAt, int seconds, List<String> homes})> areas;

  /// Boards that are offline now.
  final List<({String board, String home, String homeId, String? place, DateTime? since})> down;
}

/// "1 h 20 min", "45 min", "30 s".
String durationText(int seconds) {
  if (seconds < 60) return '$seconds s';
  final m = seconds ~/ 60;
  if (m < 60) return '$m min';
  final h = m ~/ 60, r = m % 60;
  return r == 0 ? '$h h' : '$h h $r min';
}

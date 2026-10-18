import 'package:flutter/foundation.dart';

import '../json.dart';
import 'num.dart';
import 'rights.dart';

/// One thing to do at a stop: a booked home visit, an installation, or an open ticket.
enum DayJobType { visit, install, ticket }

@immutable
class DayJob {
  const DayJob({required this.type, required this.title, this.detail = '', this.at, this.link = '', this.priority});

  factory DayJob.fromJson(Json json) => DayJob(
    type: enumOf(DayJobType.values, json['type'], DayJobType.ticket),
    title: str(json['title']),
    detail: str(json['detail']),
    at: dateOrNull(json['at']),
    link: str(json['link']),
    priority: strOrNull(json['priority']),
  );

  final DayJobType type;
  final String title;
  final String detail;

  /// A booked visit's time.
  final DateTime? at;

  /// Where the web console opens it (`/console/tickets/<id>`); the phone reads the ticket's id from it.
  final String link;
  final String? priority;

  /// The ticket this job is about (from its link), or null.
  String? get ticketId {
    final m = RegExp(r'/tickets/([^/?#]+)').firstMatch(link);
    return m?.group(1);
  }
}

/// A place to go today: a customer's home, or a new customer's visit (no home yet).
@immutable
class DayStop {
  const DayStop({
    required this.key,
    required this.n,
    required this.name,
    this.isVisit = false,
    this.city = '',
    this.lat,
    this.lng,
    this.homeId,
    this.phone,
    this.whatsapp,
    this.legKm,
    this.directions,
    this.jobs = const [],
  });

  factory DayStop.fromJson(Json json) => DayStop(
    key: str(json['key']),
    n: integer(json['n'], 1),
    name: str(json['name'], 'Stop'),
    isVisit: str(json['kind']) == 'visit',
    city: str(json['city']),
    lat: dblOrNull(json['lat']),
    lng: dblOrNull(json['lng']),
    homeId: strOrNull(json['homeId']),
    phone: strOrNull(json['phone']),
    whatsapp: strOrNull(json['whatsapp']),
    legKm: dblOrNull(json['legKm']),
    directions: strOrNull(json['directions']),
    jobs: asJsonList(json['jobs']).map(DayJob.fromJson).toList(),
  );

  final String key;

  /// Its place in the driving order (1 = first).
  final int n;
  final String name;

  /// A new customer's home visit (no home in the app yet).
  final bool isVisit;
  final String city;
  final double? lat, lng;
  final String? homeId;
  final String? phone;

  /// International digits for WhatsApp ("923001234567").
  final String? whatsapp;

  /// Distance from the stop before (from the base for the first), straight line.
  final double? legKm;

  /// Google Maps directions to it (its location, or its city).
  final String? directions;
  final List<DayJob> jobs;

  bool get located => lat != null && lng != null;
  bool get installing => jobs.any((j) => j.type == DayJobType.install);

  /// The booked visit's time, for sorting and the clock on the card.
  DateTime? get visitAt => jobs.where((j) => j.type == DayJobType.visit && j.at != null).firstOrNull?.at;
}

/// Someone whose day can be looked at (super admins and support pick one).
@immutable
class TeamMember {
  const TeamMember({required this.id, required this.name, this.role = StaffRole.installer});

  factory TeamMember.fromJson(Json json) =>
      TeamMember(id: str(json['id']), name: str(json['name'], 'Someone'), role: StaffRole.fromJson(json['staffRole']));

  final String id;
  final String name;
  final StaffRole role;
}

/// An installer's day (`/platform/day`): stops in a suggested driving order.
@immutable
class InstallerDay {
  const InstallerDay({
    required this.date,
    this.installer,
    this.installers = const [],
    this.baseSet = false,
    this.totalKm = 0,
    this.mapsUrl,
    this.stops = const [],
  });

  factory InstallerDay.fromJson(Json json) {
    final who = asJson(json['installer']);
    return InstallerDay(
      date: str(json['date']),
      installer: who.isEmpty ? null : TeamMember.fromJson(who),
      installers: asJsonList(json['installers']).map(TeamMember.fromJson).toList(),
      baseSet: boolean(json['baseSet']),
      totalKm: dblOrNull(json['totalKm']) ?? 0,
      mapsUrl: strOrNull(json['mapsUrl']),
      stops: asJsonList(json['stops']).map(DayStop.fromJson).toList(),
    );
  }

  /// "2026-10-20" (the company's calendar day, in Pakistan).
  final String date;
  final TeamMember? installer;

  /// The team (for super admins and support); empty for an installer.
  final List<TeamMember> installers;
  final bool baseSet;
  final double totalKm;

  /// The whole day in Google Maps; null when no stop has a location.
  final String? mapsUrl;
  final List<DayStop> stops;
}

/// Calendar days as the API wants them ("2026-10-20"), in Pakistan's time zone (UTC+5, no summer time).
abstract final class WorkDays {
  static const _pk = Duration(hours: 5);

  static String today([DateTime? now]) => format((now ?? DateTime.now()).toUtc().add(_pk));

  /// The clock in Pakistan at [t] (visits are booked in Pakistan's time, whatever the phone's zone).
  static DateTime inPakistan(DateTime t) => t.toUtc().add(_pk);

  static String format(DateTime d) =>
      '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

  static DateTime parse(String day) {
    final p = day.split('-').map(int.tryParse).toList();
    if (p.length != 3 || p.any((x) => x == null)) return DateTime.now();
    return DateTime(p[0]!, p[1]!, p[2]!);
  }

  /// The day before or after ("2026-10-20", -1 → "2026-10-19").
  static String shift(String day, int by) {
    final d = parse(day);
    return format(DateTime(d.year, d.month, d.day + by));
  }
}

import 'package:flutter/foundation.dart';

import 'json.dart';
import 'session.dart';

/// One of the home's people (`/users`, owners and admins only).
@immutable
class Member {
  const Member({
    required this.id,
    required this.name,
    this.email = '',
    this.role = HomeRole.guest,
    this.disabled = false,
    this.joinedAt,
    this.rooms = const {},
    this.access,
  });

  factory Member.fromJson(Json json) => Member(
    access: json['access'] is Map ? AccessLimits.fromJson(asJson(json['access'])) : null,
    id: str(json['id']),
    name: str(json['name']),
    email: str(json['email']),
    role: HomeRole.fromJson(json['role']),
    disabled: boolean(json['disabled']),
    joinedAt: dateOrNull(json['joinedAt']),
    rooms: {
      for (final r in asJsonList(json['rooms']))
        if (strOrNull(r['roomId']) != null) str(r['roomId']): Access.fromJson(r['access']),
    },
  );

  final String id;
  final String name;
  final String email;
  final HomeRole role;

  /// Their account is switched off (they can't sign in).
  final bool disabled;
  final DateTime? joinedAt;

  /// Rooms shared with them (owners and admins have every room).
  final Map<String, Access> rooms;

  /// Time-limited access (members and guests); null: none.
  final AccessLimits? access;

  String get initials => initialsOf(name);
}

/// Where a time-limited person stands right now.
enum AccessStatus {
  active,
  outside,
  expired;

  static AccessStatus fromJson(Object? v) => enumOf(values, v, active);
}

/// A member's or guest's limits: an end, and hours on some days (in the home's time zone).
@immutable
class AccessLimits {
  const AccessLimits({this.until, this.from, this.to, this.days = const [], this.summary, this.status = AccessStatus.active});

  factory AccessLimits.fromJson(Json json) => AccessLimits(
    until: dateOrNull(json['accessUntil']),
    from: strOrNull(json['accessFrom']),
    to: strOrNull(json['accessTo']),
    days: intList(json['accessDays']),
    summary: strOrNull(json['summary']),
    status: AccessStatus.fromJson(json['status']),
  );

  final DateTime? until;

  /// "09:00" (both or neither)
  final String? from, to;

  /// 0 = Sunday … 6 = Saturday; empty = every day
  final List<int> days;

  /// "9:00–17:00 Mon–Sat · until Sun 25 Oct, 20:00"
  final String? summary;
  final AccessStatus status;

  bool get hasHours => from != null && to != null;

  /// What the API takes. [untilLocal] is "YYYY-MM-DDTHH:MM" on the home's clock (no zone).
  static Json body({String? untilLocal, String? from, String? to, List<int> days = const []}) => {
    'accessUntil': untilLocal,
    'accessFrom': from,
    'accessTo': to,
    'accessDays': days,
  };
}

/// A link that lets someone join the home (`POST /invites`). [path] goes after the server address.
@immutable
class InviteLink {
  const InviteLink({
    required this.path,
    this.expiresInDays = 7,
    this.existingAccount = false,
    this.access,
  });

  factory InviteLink.fromJson(Json json) => InviteLink(
    path: str(json['path']),
    expiresInDays: integer(json['expiresInDays'], 7),
    existingAccount: boolean(json['existingAccount']),
    access: strOrNull(json['access']),
  );

  final String path;
  final int expiresInDays;

  /// Their limits in words, when the invite has some.
  final String? access;

  /// They already have an account (they'll sign in with it rather than choose a password).
  final bool existingAccount;
}

/// One notification setting ("A board stops answering"), on or off (`/notifications/prefs`).
@immutable
class NotificationPref {
  const NotificationPref(this.key, this.label, this.enabled);

  factory NotificationPref.fromJson(Json json) =>
      NotificationPref(str(json['key']), str(json['label']), boolean(json['enabled']));

  final String key;
  final String label;
  final bool enabled;
}

/// Who looks after the home (`/home/welcome`). Empty when the server doesn't say.
@immutable
class HomeWelcome {
  const HomeWelcome({this.installer, this.orgName});

  factory HomeWelcome.fromJson(Json json) => HomeWelcome(
    installer: strOrNull(json['installer']),
    orgName: strOrNull(asJson(json['org'])['name']),
  );

  /// The installer's name — "your home expert".
  final String? installer;

  /// Their company.
  final String? orgName;
}

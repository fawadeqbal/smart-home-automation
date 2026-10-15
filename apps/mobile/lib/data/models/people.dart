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
  });

  factory Member.fromJson(Json json) => Member(
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

  String get initials => initialsOf(name);
}

/// A link that lets someone join the home (`POST /invites`). [path] goes after the server address.
@immutable
class InviteLink {
  const InviteLink({
    required this.path,
    this.expiresInDays = 7,
    this.existingAccount = false,
  });

  factory InviteLink.fromJson(Json json) => InviteLink(
    path: str(json['path']),
    expiresInDays: integer(json['expiresInDays'], 7),
    existingAccount: boolean(json['existingAccount']),
  );

  final String path;
  final int expiresInDays;

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

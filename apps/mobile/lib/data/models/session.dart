import 'package:flutter/foundation.dart';

import 'json.dart';

/// Someone's role in a home. Owners and admins look after it (people, health, everyone's routines).
enum HomeRole {
  owner('Home owner'),
  admin('Home admin'),
  member('Member'),
  guest('Guest');

  const HomeRole(this.label);

  /// The same words the web app uses.
  final String label;

  bool get manages => this == owner || this == admin;

  /// As the API writes it (`MEMBER`).
  String get json => name.toUpperCase();

  /// An unknown role gets the fewest rights.
  static HomeRole fromJson(Object? value) => enumOf(values, value, guest);
}

/// What someone may do in a room: see it, switch its devices, or also change its setup.
enum Access {
  view,
  control,
  manage;

  bool get canControl => this != view;

  String get json => name.toUpperCase();

  static Access fromJson(Object? value) => enumOf(values, value, view);
}

/// "Zara Khan" → "ZK" (one letter for one name, "?" for none).
String initialsOf(String name) {
  final parts = name.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty).toList();
  if (parts.isEmpty) return '?';
  final letters = parts.length == 1 ? parts.first[0] : parts.first[0] + parts.last[0];
  return letters.toUpperCase();
}

/// The signed-in person (`/auth/me`): their homes, and the home the app has open.
@immutable
class Me {
  const Me({
    required this.id,
    required this.name,
    required this.email,
    this.staff,
    this.homes = const [],
    this.home,
    this.rooms = const {},
  });

  factory Me.fromJson(Json json) => Me(
    id: str(json['id']),
    name: str(json['name']),
    email: str(json['email']),
    staff: json['staff'] is Map ? Staff.fromJson(asJson(json['staff'])) : null,
    homes: asJsonList(json['homes']).map(HomeSummary.fromJson).toList(),
    home: json['home'] is Map ? CurrentHome.fromJson(asJson(json['home'])) : null,
    rooms: {
      for (final r in asJsonList(json['rooms']))
        if (strOrNull(r['roomId']) != null) str(r['roomId']): Access.fromJson(r['access']),
    },
  );

  final String id;
  final String name;
  final String email;

  /// Set for someone on an installer's team (they may look into customers' homes).
  final Staff? staff;

  /// Every home they belong to.
  final List<HomeSummary> homes;

  /// The home the app shows; null when they have none.
  final CurrentHome? home;

  /// Their access per room of [home] (members and guests; owners and admins have every room).
  final Map<String, Access> rooms;

  String get firstName => name.trim().split(RegExp(r'\s+')).first;
  String get initials => initialsOf(name);
}

/// Someone who works for the company that installs and looks after homes.
@immutable
class Staff {
  const Staff({required this.role, required this.orgName});

  factory Staff.fromJson(Json json) => Staff(
    role: switch (str(json['role'])) {
      'SUPERADMIN' => 'Super admin',
      'INSTALLER' => 'Installer',
      'SUPPORT' => 'Support',
      final other => other.isEmpty ? 'Staff' : other,
    },
    orgName: str(asJson(json['org'])['name'], 'your company'),
  );

  /// In words: "Installer", "Support", "Super admin".
  final String role;
  final String orgName;
}

/// One of my homes, for the home picker.
@immutable
class HomeSummary {
  const HomeSummary({
    required this.id,
    required this.name,
    this.city = '',
    this.role = HomeRole.guest,
  });

  factory HomeSummary.fromJson(Json json) => HomeSummary(
    id: str(json['id']),
    name: str(json['name'], 'Home'),
    city: str(json['city']),
    role: HomeRole.fromJson(json['role']),
  );

  final String id;
  final String name;
  final String city;
  final HomeRole role;
}

/// The open home, with my role in it.
@immutable
class CurrentHome {
  const CurrentHome({
    required this.id,
    required this.name,
    this.city = '',
    this.timezone = '',
    this.role = HomeRole.guest,
    this.viaStaff = false,
    this.readOnly = false,
    this.canSetup = false,
    this.onboarded = true,
  });

  factory CurrentHome.fromJson(Json json) => CurrentHome(
    id: str(json['id']),
    name: str(json['name'], 'Home'),
    city: str(json['city']),
    timezone: str(json['timezone']),
    role: HomeRole.fromJson(json['role']),
    viaStaff: boolean(json['viaStaff']),
    readOnly: boolean(json['readOnly']),
    canSetup: boolean(json['canSetup']),
    onboarded: boolean(json['onboarded'], true),
  );

  final String id;
  final String name;
  final String city;
  final String timezone;
  final HomeRole role;

  /// Looking in through a staff role, not as one of the home's people.
  final bool viaStaff;

  /// Support staff: may look at everything, change nothing.
  final bool readOnly;

  /// May set up boards and wiring (installers; done on the web).
  final bool canSetup;

  /// Has seen the first-visit tour.
  final bool onboarded;

  /// Looks after the home: people, invites, health, everyone's routines. Read-only support
  /// staff have an admin role but may not change anything, so they don't.
  bool get manages => role.manages && !readOnly;
}

import 'package:flutter/foundation.dart';

import '../json.dart';
import 'num.dart';

/// How a home or a board is doing, in the console's colours.
enum Tone { ok, info, warn, bad, mute }

Tone toneOf(Object? v) => switch (str(v)) {
  'ok' => Tone.ok,
  'info' => Tone.info,
  'warn' => Tone.warn,
  'bad' || 'off' => Tone.bad,
  _ => Tone.mute,
};

/// A home in the list of homes a staff member looks after (`/platform/homes`).
@immutable
class HomeRow {
  const HomeRow({
    required this.id,
    required this.name,
    this.city = '',
    this.owner,
    this.ownerPending = false,
    this.installer,
    this.installerId,
    this.status = 'setup',
    this.statusLabel = '',
    this.tone = Tone.info,
    this.steps = 0,
    this.boardsOnline = 0,
    this.boardsTotal = 0,
    this.boardsInstalled = 0,
    this.people = 0,
    this.lastActivity,
  });

  factory HomeRow.fromJson(Json json) => HomeRow(
    id: str(json['id']),
    name: str(json['name'], 'Home'),
    city: str(json['city']),
    owner: strOrNull(json['owner']),
    ownerPending: boolean(json['ownerPending']),
    installer: strOrNull(json['installer']),
    installerId: strOrNull(json['installerId']),
    status: str(json['status'], 'setup'),
    statusLabel: str(json['statusLabel']),
    tone: toneOf(json['tone']),
    steps: integer(json['steps']),
    boardsOnline: integer(json['boardsOnline']),
    boardsTotal: integer(json['boardsTotal']),
    boardsInstalled: integer(json['boardsInstalled']),
    people: integer(json['people']),
    lastActivity: dateOrNull(json['lastActivity']),
  );

  final String id;
  final String name;
  final String city;
  final String? owner;

  /// The owner is invited but hasn't joined yet.
  final bool ownerPending;
  final String? installer, installerId;

  /// `setup` (being installed), `live`, `attention` (a board offline or unwell), `archived`.
  final String status;
  final String statusLabel;
  final Tone tone;

  /// Setup steps done, of 6.
  final int steps;
  final int boardsOnline, boardsTotal, boardsInstalled;
  final int people;
  final DateTime? lastActivity;

  /// Boards given to the home that aren't installed yet.
  int get boardsWaiting => (boardsTotal - boardsInstalled).clamp(0, 99);

  /// The words on its badge: "Installing", "Live", "Board offline"…
  String get badge => switch (status) {
    'setup' => 'Installing',
    'live' => 'Live',
    'archived' => 'Archived',
    _ => statusLabel.isEmpty ? 'Needs a look' : statusLabel,
  };

  bool matches(String term) {
    final t = term.trim().toLowerCase();
    if (t.isEmpty) return true;
    return [name, city, owner ?? '', installer ?? ''].any((v) => v.toLowerCase().contains(t));
  }
}

/// A person of the home, in the staff view.
@immutable
class HomeOwner {
  const HomeOwner({required this.id, required this.name, this.email = '', this.phone});

  factory HomeOwner.fromJson(Json json) => HomeOwner(
    id: str(json['id']),
    name: str(json['name'], 'Owner'),
    email: str(json['email']),
    phone: strOrNull(json['phone']),
  );

  final String id;
  final String name;
  final String email;
  final String? phone;
}

/// One board of the home in the staff view (`/platform/homes/:id` → boards).
@immutable
class WorkspaceBoard {
  const WorkspaceBoard({
    required this.id,
    required this.name,
    this.board = '',
    this.model = '',
    this.status = 'ASSIGNED',
    this.online = false,
    this.tone = Tone.mute,
    this.condText = '',
    this.firmware,
    this.firmwareOld = false,
    this.devices = 0,
    this.rssi,
    this.lastSeenAt,
    this.note,
  });

  factory WorkspaceBoard.fromJson(Json json) => WorkspaceBoard(
    id: str(json['id']),
    name: str(json['name'], str(json['id'])),
    board: str(json['board']),
    model: str(json['model']),
    status: str(json['status'], 'ASSIGNED'),
    online: boolean(json['online']),
    tone: toneOf(json['cond']),
    condText: str(json['condText']),
    firmware: strOrNull(json['firmware']),
    firmwareOld: boolean(json['firmwareOld']),
    devices: integer(json['devices']),
    rssi: intOrNull(json['rssi']),
    lastSeenAt: dateOrNull(json['lastSeenAt']),
    note: strOrNull(json['note']),
  );

  final String id;
  final String name;
  final String board;
  final String model;

  /// `ASSIGNED` (waiting to be installed), `ADOPTED` (installed), `FAULTY`.
  final String status;
  final bool online;
  final Tone tone;
  final String condText;
  final String? firmware;
  final bool firmwareOld;
  final int devices;
  final int? rssi;
  final DateTime? lastSeenAt;
  final String? note;

  bool get waiting => status == 'ASSIGNED';
  bool get installed => status == 'ADOPTED' || status == 'FAULTY';
}

/// A setup step of the home (1 home created … 6 handed over).
@immutable
class SetupStep {
  const SetupStep({required this.n, required this.title, this.detail = '', this.done = false, this.current = false});

  factory SetupStep.fromJson(Json json) => SetupStep(
    n: integer(json['n']),
    title: str(json['title']),
    detail: str(json['detail']),
    done: boolean(json['done']),
    current: boolean(json['current']),
  );

  final int n;
  final String title, detail;
  final bool done, current;
}

/// The staff view of one home (`/platform/homes/:id`).
@immutable
class Workspace {
  const Workspace({
    required this.id,
    required this.name,
    this.city = '',
    this.timezone = 'Asia/Karachi',
    this.owner,
    this.ownerInvite,
    this.installerId,
    this.installer,
    this.status = 'setup',
    this.statusLabel = '',
    this.tone = Tone.info,
    this.steps = const [],
    this.stepsDone = 0,
    this.boards = const [],
    this.devices = 0,
    this.currentFirmware,
  });

  factory Workspace.fromJson(Json json) {
    final h = asJson(json['home']);
    final owner = asJson(h['owner']);
    final invite = asJson(h['ownerInvite']);
    final installer = asJson(h['installer']);
    return Workspace(
      id: str(h['id']),
      name: str(h['name'], 'Home'),
      city: str(h['city']),
      timezone: str(h['timezone'], 'Asia/Karachi'),
      owner: owner.isEmpty ? null : HomeOwner.fromJson(owner),
      ownerInvite: invite.isEmpty ? null : str(invite['name'], str(invite['email'])),
      installerId: strOrNull(installer['id']),
      installer: strOrNull(installer['name']),
      status: str(h['status'], 'setup'),
      statusLabel: str(h['statusLabel']),
      tone: toneOf(h['tone']),
      steps: asJsonList(json['steps']).map(SetupStep.fromJson).toList(),
      stepsDone: integer(json['stepsDone']),
      boards: asJsonList(json['boards']).map(WorkspaceBoard.fromJson).toList(),
      devices: integer(asJson(json['stats'])['devices']),
      currentFirmware: strOrNull(json['currentFirmware']),
    );
  }

  final String id;
  final String name;
  final String city;
  final String timezone;
  final HomeOwner? owner;

  /// Who was invited to own it, while they haven't joined.
  final String? ownerInvite;
  final String? installerId, installer;
  final String status, statusLabel;
  final Tone tone;
  final List<SetupStep> steps;
  final int stepsDone;
  final List<WorkspaceBoard> boards;
  final int devices;

  /// The newest firmware build of the company (to show "update available").
  final String? currentFirmware;

  /// Boards assigned to the home that are powered and online: ready to be installed (adopted).
  List<WorkspaceBoard> get readyToInstall => boards.where((b) => b.waiting && b.online).toList();

  /// Assigned boards that haven't come online yet.
  List<WorkspaceBoard> get waitingForPower => boards.where((b) => b.waiting && !b.online).toList();
  List<WorkspaceBoard> get installed => boards.where((b) => b.installed).toList();
}

/// "0300-1234567", "+92 300 1234567" → "923001234567" (the digits WhatsApp wants). Numbers without a
/// country code are Pakistani. The same rule as the API's `normalisePhone`.
String? whatsappDigits(String? raw) {
  if (raw == null) return null;
  final text = raw.trim();
  if (!RegExp(r'^[+0-9 ()./-]{7,24}$').hasMatch(text)) return null;
  var digits = text.replaceAll(RegExp(r'\D'), '');
  if (text.startsWith('+')) {
    // already international
  } else if (digits.startsWith('00')) {
    digits = digits.substring(2);
  } else if (digits.startsWith('0')) {
    digits = '92${digits.substring(1)}';
  } else if (RegExp(r'^3\d{9}$').hasMatch(digits)) {
    digits = '92$digits';
  }
  if (digits.startsWith('92')) return digits.length == 12 || digits.length == 11 ? digits : null;
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

/// "923001234567" → "+92 300 1234567".
String displayPhone(String digits) {
  final m = RegExp(r'^92(3\d{2})(\d{7})$').firstMatch(digits);
  return m != null ? '+92 ${m.group(1)} ${m.group(2)}' : '+$digits';
}

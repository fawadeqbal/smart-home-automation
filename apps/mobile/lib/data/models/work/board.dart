import 'package:flutter/foundation.dart';

import '../json.dart';
import 'homes.dart';
import 'num.dart';

/// A pin of a board model that may be used, and for what (`packages/contracts/src/boards.ts`).
@immutable
class BoardPin {
  const BoardPin({required this.gpio, required this.label, this.uses = const [], this.note});

  factory BoardPin.fromJson(Json json) => BoardPin(
    gpio: integer(json['gpio'], -1),
    label: str(json['label']),
    uses: strList(json['uses']),
    note: strOrNull(json['note']),
  );

  final int gpio;

  /// What's printed next to it on the board: "D1".
  final String label;

  /// `output`, `input`, `sensor`, `analog`.
  final List<String> uses;
  final String? note;
}

@immutable
class BoardModel {
  const BoardModel({required this.type, required this.name, this.pins = const []});

  factory BoardModel.fromJson(Json json) => BoardModel(
    type: str(json['type']),
    name: str(json['name'], str(json['type'])),
    pins: asJsonList(json['pins']).map(BoardPin.fromJson).toList(),
  );

  final String type;
  final String name;
  final List<BoardPin> pins;
}

@immutable
class DeviceTypeDef {
  const DeviceTypeDef({
    required this.type,
    required this.label,
    this.pinUse = 'output',
    this.controllable = false,
    this.hasActiveLow = false,
  });

  factory DeviceTypeDef.fromJson(Json json) => DeviceTypeDef(
    type: str(json['type']),
    label: str(json['label'], str(json['type'])),
    pinUse: str(json['pinUse'], 'output'),
    controllable: boolean(json['controllable']),
    hasActiveLow: boolean(json['hasActiveLow']),
  );

  final String type;
  final String label;

  /// The use its main pin needs (`output` for a relay or a tank's TRIG, `input`, `sensor`, `analog`).
  final String pinUse;

  /// People can switch it (a relay, a fan).
  final bool controllable;
  final bool hasActiveLow;
}

/// Board models and device types, for the forms (`/catalog`).
@immutable
class Catalog {
  const Catalog({this.boards = const [], this.deviceTypes = const []});

  factory Catalog.fromJson(Json json) => Catalog(
    boards: asJsonList(json['boards']).map(BoardModel.fromJson).toList(),
    deviceTypes: asJsonList(json['deviceTypes']).map(DeviceTypeDef.fromJson).toList(),
  );

  final List<BoardModel> boards;
  final List<DeviceTypeDef> deviceTypes;

  BoardModel? board(String type) => boards.where((b) => b.type == type).firstOrNull ?? boards.firstOrNull;
  DeviceTypeDef? type(String type) => deviceTypes.where((t) => t.type == type).firstOrNull;
  String modelName(String type) => boards.where((b) => b.type == type).firstOrNull?.name ?? type;
}

/// A device wired to a board (in `/nodes`).
@immutable
class NodeDevice {
  const NodeDevice({
    required this.id,
    required this.name,
    required this.type,
    required this.pin,
    this.key = '',
    this.activeLow = false,
    this.roomId,
    this.settings = const {},
    this.aliases = const [],
    this.state,
    this.restoreOff = false,
  });

  factory NodeDevice.fromJson(Json json) => NodeDevice(
    id: str(json['id']),
    key: str(json['key']),
    name: str(json['name'], 'Device'),
    type: str(json['type'], 'switch'),
    pin: integer(json['pin'], -1),
    activeLow: boolean(json['activeLow']),
    roomId: strOrNull(json['roomId']),
    settings: asJson(json['settings']),
    aliases: strList(json['aliases']),
    state: json['state'] is Map ? asJson(json['state']) : null,
    restoreOff: boolean(json['restoreOff']),
  );

  final String id;
  final String key;
  final String name;
  final String type;

  /// Its main pin (relay 1 of a fan, a tank's TRIG).
  final int pin;
  final bool activeLow;
  final String? roomId;
  final Json settings;
  final List<String> aliases;
  final Json? state;
  final bool restoreOff;

  /// The same device with what the board just reported merged in.
  NodeDevice withState(Json fields) => NodeDevice(
    id: id,
    key: key,
    name: name,
    type: type,
    pin: pin,
    activeLow: activeLow,
    roomId: roomId,
    settings: settings,
    aliases: aliases,
    state: {...?state, ...fields},
    restoreOff: restoreOff,
  );
}

/// What a wall switch's flip or a button's press does through the server.
@immutable
class InputAction {
  const InputAction.scene(this.id) : kind = 'scene', on = null;
  const InputAction.device(this.id, {this.on}) : kind = 'device';
  const InputAction.allOff([this.id]) : kind = 'allOff', on = null;

  static InputAction? fromJson(Object? value) {
    final j = asJson(value);
    return switch (str(j['type'])) {
      'scene' => InputAction.scene(str(j['sceneId'])),
      'device' => InputAction.device(str(j['deviceId']), on: boolOrNull(j['on'])),
      'allOff' => InputAction.allOff(strOrNull(j['roomId'])),
      _ => null,
    };
  }

  /// `scene`, `device` or `allOff`.
  final String kind;

  /// The scene, the device, or the room (null with allOff: the whole home).
  final String? id;
  final bool? on;

  Json toJson() => switch (kind) {
    'scene' => {'type': 'scene', 'sceneId': id},
    'device' => {'type': 'device', 'deviceId': id, 'on': ?on},
    _ => {'type': 'allOff', 'roomId': id},
  };

  /// A short key for pickers ("scene:abc", "device:abc:t", "off:").
  String get pick => switch (kind) {
    'scene' => 'scene:$id',
    'device' =>
      'device:$id:${on == null
          ? 't'
          : on!
          ? '1'
          : '0'}',
    _ => 'off:${id ?? ''}',
  };

  @override
  bool operator ==(Object other) => other is InputAction && other.pick == pick;
  @override
  int get hashCode => pick.hashCode;
}

/// A wall switch or a push-button wired to a board.
@immutable
class BoardInput {
  const BoardInput({
    required this.id,
    required this.type,
    required this.pin,
    this.name = '',
    this.targetId,
    this.targetName,
    this.settings = const {},
    this.actions = const {},
    this.lastEventAt,
  });

  factory BoardInput.fromJson(Json json) {
    final actions = <String, InputAction>{};
    asJson(json['actions']).forEach((k, v) {
      final a = InputAction.fromJson(v);
      if (a != null) actions[k] = a;
    });
    return BoardInput(
      id: str(json['id']),
      type: str(json['type'], 'toggle_button'),
      pin: integer(json['pin'], -1),
      name: str(json['name']),
      targetId: strOrNull(json['targetId']),
      targetName: strOrNull(json['targetName']),
      settings: asJson(json['settings']),
      actions: actions,
      lastEventAt: dateOrNull(json['lastEventAt']),
    );
  }

  final String id;

  /// `wall_switch` or `toggle_button`.
  final String type;
  final int pin;
  final String name;
  final String? targetId, targetName;
  final Json settings;

  /// Per gesture (`single`, `double`, `long`, `flip`).
  final Map<String, InputAction> actions;
  final DateTime? lastEventAt;

  bool get isWallSwitch => type == 'wall_switch';
  bool get gestures => boolean(settings['gestures']);
  String get kindLabel => isWallSwitch ? 'Wall switch' : 'Push-button';
  String get title => name.isNotEmpty ? name : kindLabel;
}

/// The board's last health report.
@immutable
class BoardHealth {
  const BoardHealth({
    this.at,
    this.rssi,
    this.heap,
    this.uptime,
    this.vcc,
    this.cpuMhz,
    this.flashKb,
    this.sketchKb,
    this.freeSketchKb,
    this.reset,
    this.ssid,
    this.connects,
  });

  factory BoardHealth.fromJson(Json json) => BoardHealth(
    at: dateOrNull(json['at']),
    rssi: intOrNull(json['rssi']),
    heap: intOrNull(json['heap']),
    uptime: intOrNull(json['uptime']),
    vcc: intOrNull(json['vcc']),
    cpuMhz: intOrNull(json['cpuMhz']),
    flashKb: intOrNull(json['flashKb']),
    sketchKb: intOrNull(json['sketchKb']),
    freeSketchKb: intOrNull(json['freeSketchKb']),
    reset: strOrNull(json['reset']),
    ssid: strOrNull(json['ssid']),
    connects: intOrNull(json['connects']),
  );

  final DateTime? at;
  final int? rssi, heap, uptime;

  /// Supply voltage in millivolts.
  final int? vcc;
  final int? cpuMhz, flashKb, sketchKb, freeSketchKb;
  final String? reset, ssid;
  final int? connects;

  BoardHealth copyWithJson(Json json) => BoardHealth.fromJson({...toJson(), ...json});

  Json toJson() => {
    if (at != null) 'at': at!.toUtc().toIso8601String(),
    'rssi': ?rssi,
    'heap': ?heap,
    'uptime': ?uptime,
    'vcc': ?vcc,
    'cpuMhz': ?cpuMhz,
    'flashKb': ?flashKb,
    'sketchKb': ?sketchKb,
    'freeSketchKb': ?freeSketchKb,
    'reset': ?reset,
    'ssid': ?ssid,
    'connects': ?connects,
  };
}

/// A board of the home, with its devices and wall buttons (`/nodes`, as staff with X-Home-Id).
@immutable
class BoardNode {
  const BoardNode({
    required this.id,
    required this.name,
    this.board = 'NODEMCU_V2',
    this.boardName = '',
    this.status = 'ADOPTED',
    this.online = false,
    this.firmware,
    this.ip,
    this.mac,
    this.note,
    this.waiting = false,
    this.rssi,
    this.lastSeenAt,
    this.configRev = 0,
    this.appliedRev = 0,
    this.configError,
    this.mqttLogin,
    this.mqttLoginSince,
    this.mqttLoginProblem = false,
    this.health,
    this.devices = const [],
    this.inputs = const [],
  });

  factory BoardNode.fromJson(Json json) => BoardNode(
    id: str(json['id']),
    name: str(json['name'], str(json['id'])),
    board: str(json['board'], 'NODEMCU_V2'),
    boardName: str(json['boardName']),
    status: str(json['status'], 'ADOPTED'),
    online: boolean(json['online']),
    firmware: strOrNull(json['firmware']),
    ip: strOrNull(json['ip']),
    mac: strOrNull(json['mac']),
    note: strOrNull(json['note']),
    waiting: boolean(json['waiting']),
    rssi: intOrNull(json['rssi']),
    lastSeenAt: dateOrNull(json['lastSeenAt']),
    configRev: integer(json['configRev']),
    appliedRev: integer(json['appliedRev']),
    configError: strOrNull(json['configError']),
    mqttLogin: strOrNull(json['mqttLogin']),
    mqttLoginSince: dateOrNull(json['mqttLoginSince']),
    mqttLoginProblem: boolean(json['mqttLoginProblem']),
    health: json['health'] is Map ? BoardHealth.fromJson(asJson(json['health'])) : null,
    devices: asJsonList(json['devices']).map(NodeDevice.fromJson).toList(),
    inputs: asJsonList(json['inputs']).map(BoardInput.fromJson).toList(),
  );

  final String id;
  final String name;

  /// The model's type (`NODEMCU_V3`) and name.
  final String board, boardName;

  /// `ASSIGNED`, `ADOPTED`, `FAULTY`.
  final String status;
  final bool online;
  final String? firmware, ip, mac;

  /// Why it was marked faulty.
  final String? note;

  /// Marked faulty: out of service, its devices wait for a replacement board.
  final bool waiting;
  final int? rssi;
  final DateTime? lastSeenAt;

  /// The settings version sent, and the one the board says it runs.
  final int configRev, appliedRev;

  /// The board refused its settings, and why.
  final String? configError;

  /// Its server login (firmware 2.6.0+): `own` or `shared`; a problem when it came back without its own.
  final String? mqttLogin;
  final DateTime? mqttLoginSince;
  final bool mqttLoginProblem;
  final BoardHealth? health;
  final List<NodeDevice> devices;
  final List<BoardInput> inputs;

  bool get installed => status == 'ADOPTED' || status == 'FAULTY';

  /// Settings saved / saving / refused.
  SettingsSync get sync => configError != null
      ? SettingsSync.refused
      : appliedRev == configRev
      ? SettingsSync.saved
      : SettingsSync.saving;

  int? get signal => health?.rssi ?? rssi;

  BoardNode copyWith({bool? online, BoardHealth? health, DateTime? lastSeenAt, List<NodeDevice>? devices}) => BoardNode(
    id: id,
    name: name,
    board: board,
    boardName: boardName,
    status: status,
    online: online ?? this.online,
    firmware: firmware,
    ip: ip,
    mac: mac,
    note: note,
    waiting: waiting,
    rssi: rssi,
    lastSeenAt: lastSeenAt ?? this.lastSeenAt,
    configRev: configRev,
    appliedRev: appliedRev,
    configError: configError,
    mqttLogin: mqttLogin,
    mqttLoginSince: mqttLoginSince,
    mqttLoginProblem: mqttLoginProblem,
    health: health ?? this.health,
    devices: devices ?? this.devices,
    inputs: inputs,
  );
}

enum SettingsSync { saved, saving, refused }

/// A board's condition, in words and colour (the same rules as the web's `boardCondition`).
@immutable
class BoardCondition {
  const BoardCondition(this.tone, this.label, this.detail);
  final Tone tone;
  final String label, detail;

  factory BoardCondition.of(BoardNode node) {
    final h = node.health;
    if (node.waiting) {
      return BoardCondition(Tone.bad, 'Faulty · waiting for a replacement', node.note ?? 'Marked faulty.');
    }
    if (!node.online) {
      return const BoardCondition(
        Tone.bad,
        'Offline',
        'The server lost contact with the board. On the board: fast blink = no Wi-Fi, slow blink = Wi-Fi OK but no server, dark = no power.',
      );
    }
    if (node.configError != null) return BoardCondition(Tone.bad, 'Settings refused', node.configError!);
    if (node.appliedRev != node.configRev) {
      return const BoardCondition(Tone.warn, 'Saving settings', 'Sending the latest devices and pins to the board…');
    }
    if (h?.vcc != null && h!.vcc! < 3000) {
      return BoardCondition(
        Tone.warn,
        'Low supply voltage',
        '${(h.vcc! / 1000).toStringAsFixed(2)} V — below 3.0 V the board can reset. Use a better USB cable or 5 V supply.',
      );
    }
    if (h?.rssi != null && h!.rssi! < -80) {
      return BoardCondition(Tone.warn, 'Weak Wi-Fi', '${h.rssi} dBm — move the board or the router closer.');
    }
    if (h?.heap != null && h!.heap! < 8000) {
      return BoardCondition(
        Tone.warn,
        'Low memory',
        '${(h.heap! / 1024).round()} KB free — remove a device or restart the board.',
      );
    }
    if (h?.connects != null && h!.connects! > 3) {
      return BoardCondition(Tone.warn, 'Unstable connection', 'Reconnected ${h.connects! - 1} times since it started.');
    }
    return const BoardCondition(Tone.ok, 'Healthy', 'Connected, powered and responding normally.');
  }
}

/// "Good (-64 dBm)" and 0–4 bars.
({String text, int bars}) signalOf(int? rssi) {
  if (rssi == null) return (text: '—', bars: 0);
  final bars = rssi > -55
      ? 4
      : rssi > -67
      ? 3
      : rssi > -75
      ? 2
      : rssi > -85
      ? 1
      : 0;
  return (text: '${const ['Very weak', 'Weak', 'Fair', 'Good', 'Excellent'][bars]} ($rssi dBm)', bars: bars);
}

/// "3 h 12 min", "2 d 4 h".
String uptimeText(int? sec) {
  if (sec == null) return '—';
  final d = sec ~/ 86400, h = (sec % 86400) ~/ 3600, m = (sec % 3600) ~/ 60;
  return d > 0
      ? '$d d $h h'
      : h > 0
      ? '$h h $m min'
      : '$m min ${sec % 60} s';
}

/// Compares firmware versions like "2.5.0" (missing parts count as 0; "2.6.3-fake" reads as 2.6.3).
int compareVersions(String a, String b) {
  List<int> parts(String v) => v.split(RegExp(r'[.\-+]')).map((x) => int.tryParse(x) ?? 0).toList();
  final x = parts(a), y = parts(b);
  for (var i = 0; i < (x.length > y.length ? x.length : y.length); i++) {
    final p = i < x.length ? x[i] : 0, q = i < y.length ? y[i] : 0;
    if (p != q) return p.compareTo(q);
  }
  return 0;
}

bool isBehind(String? running, String? latest) =>
    running != null && latest != null && compareVersions(running, latest) < 0;

/// One line of a board's live log.
@immutable
class LogLine {
  const LogLine({required this.at, required this.msg, this.level = 'info', this.source = 'board'});

  factory LogLine.fromJson(Json json) => LogLine(
    at: dateOrNull(json['at']) ?? DateTime.now(),
    msg: str(json['msg']),
    level: str(json['level'], 'info'),
    source: str(json['source'], 'board'),
  );

  final DateTime at;
  final String msg;

  /// `debug`, `info`, `warn`, `error`.
  final String level;

  /// `board` or `server`.
  final String source;

  static const levels = ['debug', 'info', 'warn', 'error'];
  bool atLeast(String min) => levels.indexOf(level) >= levels.indexOf(min);
}

/// A firmware build in the company's library (`/firmware`).
@immutable
class FirmwareImage {
  const FirmwareImage({required this.id, required this.version, this.notes = '', this.size = 0, this.createdAt});

  factory FirmwareImage.fromJson(Json json) => FirmwareImage(
    id: str(json['id']),
    version: str(json['version'], '?'),
    notes: str(json['notes']),
    size: integer(json['size']),
    createdAt: dateOrNull(json['createdAt']),
  );

  final String id;
  final String version;
  final String notes;
  final int size;
  final DateTime? createdAt;

  int get kb => (size / 1024).round();
}

/// One wire of a board swap: the same pin number on the new board, and whether it can be used that way.
@immutable
class SwapPlanRow {
  const SwapPlanRow({required this.name, this.what = '', this.from = '', this.to = '', this.problem});

  factory SwapPlanRow.fromJson(Json json) => SwapPlanRow(
    name: str(json['name']),
    what: str(json['what']),
    from: str(json['from']),
    to: str(json['to']),
    problem: strOrNull(json['problem']),
  );

  final String name, what, from, to;
  final String? problem;
}

/// A board that could take over from a dead one.
@immutable
class SwapCandidate {
  const SwapCandidate({
    required this.id,
    this.boardName = '',
    this.status = 'STOCK',
    this.online = false,
    this.lastSeenAt,
    this.firmware,
    this.plan = const [],
    this.problems = const [],
    this.warnings = const [],
  });

  factory SwapCandidate.fromJson(Json json) => SwapCandidate(
    id: str(json['id']),
    boardName: str(json['boardName']),
    status: str(json['status'], 'STOCK'),
    online: boolean(json['online']),
    lastSeenAt: dateOrNull(json['lastSeenAt']),
    firmware: strOrNull(json['firmware']),
    plan: asJsonList(json['plan']).map(SwapPlanRow.fromJson).toList(),
    problems: strList(json['problems']),
    warnings: strList(json['warnings']),
  );

  final String id;
  final String boardName;

  /// `STOCK`, or `ASSIGNED` to this home.
  final String status;
  final bool online;
  final DateTime? lastSeenAt;
  final String? firmware;
  final List<SwapPlanRow> plan;
  final List<String> problems, warnings;

  bool get fits => problems.isEmpty;
}

/// The result of replacing a board.
@immutable
class SwapResult {
  const SwapResult({
    required this.newId,
    required this.oldId,
    this.oldStatus = 'FAULTY',
    this.devices = 0,
    this.inputs = 0,
    this.warnings = const [],
  });

  factory SwapResult.fromJson(Json json) => SwapResult(
    newId: str(json['newId']),
    oldId: str(json['oldId']),
    oldStatus: str(json['oldStatus'], 'FAULTY'),
    devices: integer(json['devices']),
    inputs: integer(json['inputs']),
    warnings: strList(json['warnings']),
  );

  final String newId, oldId, oldStatus;
  final int devices, inputs;
  final List<String> warnings;
}

/// A scene of the home (for wall button gestures).
@immutable
class SceneRef {
  const SceneRef(this.id, this.name);
  factory SceneRef.fromJson(Json json) => SceneRef(str(json['id']), str(json['name'], 'Scene'));
  final String id, name;
}

/// What a device is doing now, in a few words.
String deviceNow(NodeDevice d, {DeviceTypeDef? def}) {
  final s = d.state;
  if (s == null) return '—';
  if (d.type == 'fan') return s['on'] == true ? 'On · speed ${s['speed'] ?? '?'}' : 'Off';
  if (def?.controllable ?? d.type == 'switch') return s['on'] == true ? 'On' : 'Off';
  if (d.type == 'tank') {
    final level = intOrNull(s['level']);
    if (level == null) return '—';
    final alarm = switch (str(s['alarm'])) {
      'dry' => ' · motor stopped: water not rising',
      'long' => ' · motor stopped: ran too long',
      'sensor' => ' · motor stopped: no sensor reading',
      _ => '',
    };
    return '$level% full$alarm';
  }
  if (d.type == 'contact') return contactText(str(d.settings['kind'], 'door'), s['active'] == true);
  if (d.type == 'analog') {
    final level = intOrNull(s['level']);
    return level == null ? '—' : '$level% ${analogKindLabel(str(d.settings['kind'], 'light')).toLowerCase()}';
  }
  if (d.type == 'dht') {
    final t = dblOrNull(s['temperature']), h = dblOrNull(s['humidity']);
    return [if (t != null) '${t.toStringAsFixed(1)}°C', if (h != null) '${h.round()}%'].join(' · ').ifEmpty('—');
  }
  return '—';
}

String contactText(String kind, bool active) => switch (kind) {
  'door' || 'window' => active ? 'Open' : 'Closed',
  'motion' => active ? 'Movement' : 'Still',
  'leak' => active ? 'Water found!' : 'Dry',
  'mains' => active ? 'Grid on' : 'Grid off (on UPS)',
  _ => active ? 'Active' : 'Not active',
};

String analogKindLabel(String kind) => switch (kind) {
  'gas' => 'Gas / smoke',
  'moisture' => 'Soil moisture',
  'water' => 'Water level',
  'generic' => 'Level',
  _ => 'Light level',
};

/// "Switch · active low · stays off after a power cut".
String deviceTypeText(NodeDevice d) => switch (d.type) {
  'switch' => 'Switch${d.activeLow ? ' · active low' : ''}${d.restoreOff ? ' · stays off after a power cut' : ''}',
  'fan' => 'Fan with speeds${d.restoreOff ? ' · stays off after a power cut' : ''}',
  'tank' => 'Water tank${str(d.settings['motorDeviceId']).isNotEmpty ? ' · fills by itself' : ''}',
  'dht' => 'Temperature sensor · ${str(d.settings['model'], 'dht22').toUpperCase()}',
  'contact' =>
    'Contact sensor · ${switch (str(d.settings['kind'], 'door')) {
      'mains' => 'grid power',
      final k => k,
    }}',
  'analog' => 'Analog · ${analogKindLabel(str(d.settings['kind'], 'light')).toLowerCase()}',
  _ => d.type,
};

extension on String {
  String ifEmpty(String other) => isEmpty ? other : this;
}

/// The tone of a board condition's dot, for the [Tone] colours.
Tone boardTone(BoardNode n) => BoardCondition.of(n).tone;

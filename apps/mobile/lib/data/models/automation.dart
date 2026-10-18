import 'package:flutter/foundation.dart';

import 'json.dart';

/// Switch one device on or off — what scenes and schedules are made of.
@immutable
class DeviceAction {
  const DeviceAction({
    required this.deviceId,
    required this.on,
    this.deviceName = '',
    this.waiting = false,
  });

  factory DeviceAction.fromJson(Json json) => DeviceAction(
    deviceId: str(json['deviceId']),
    on: boolean(json['on']),
    deviceName: str(json['deviceName']),
    waiting: boolean(json['waiting']),
  );

  final String deviceId;
  final bool on;

  /// Filled in by the server when reading ("Removed device" for one that's gone); never sent.
  final String deviceName;

  /// Its board is broken: it can't run until the installer puts in a replacement board.
  final bool waiting;

  Json toJson() => {'deviceId': deviceId, 'on': on};
}

/// Many devices at once, in one tap ("Good night").
@immutable
class Scene {
  const Scene({
    required this.id,
    required this.name,
    this.icon,
    this.canRun = false,
    this.createdBy,
    this.actions = const [],
  });

  factory Scene.fromJson(Json json) => Scene(
    id: str(json['id']),
    name: str(json['name'], 'Scene'),
    icon: strOrNull(json['icon']),
    canRun: boolean(json['canRun']),
    createdBy: strOrNull(json['createdBy']),
    actions: asJsonList(json['actions']).map(DeviceAction.fromJson).toList(),
  );

  final String id;
  final String name;

  /// The web app's icon name ("moon", "sun"…) — it picks the scene's look.
  final String? icon;

  /// This person may switch every device in it.
  final bool canRun;
  final String? createdBy;
  final List<DeviceAction> actions;
}

/// What running a scene did: "Fan off" in [done], "Lamp: did not respond" in [failed].
@immutable
class SceneRun {
  const SceneRun({
    required this.ok,
    this.done = const [],
    this.failed = const [],
    this.summary = '',
  });

  factory SceneRun.fromJson(Json json) => SceneRun(
    ok: boolean(json['ok']),
    done: strList(json['done']),
    failed: strList(json['failed']),
    summary: str(json['summary']),
  );

  final bool ok;
  final List<String> done;
  final List<String> failed;
  final String summary;
}

/// How a schedule's last run went.
enum RunStatus {
  ok,

  /// A board was offline or didn't answer: it tries those devices again in a few minutes.
  retrying,
  failed,

  /// It didn't run (e.g. the server was down at its time).
  skipped;

  static RunStatus? fromJson(Object? value) => value == null ? null : enumOf(values, value, ok);

  /// Older runs have no status: worked out from the words.
  static RunStatus guess(String result) => result.startsWith('Skipped')
      ? skipped
      : result.contains('Failed')
      ? failed
      : ok;
}

enum ScheduleKind {
  /// Once, at a time ("turn off in 30 min" is one of these).
  once,

  /// Every day, or on chosen weekdays, at a time.
  daily,

  /// Every day (or chosen weekdays) at sunrise or sunset, give or take some minutes.
  sun;

  String get json => name.toUpperCase();

  static ScheduleKind fromJson(Object? value) => enumOf(values, value, once);
}

/// Something that happens on its own: a timer or a daily schedule (`/schedules`).
@immutable
class Schedule {
  const Schedule({
    required this.id,
    required this.name,
    this.kind = ScheduleKind.once,
    this.runAt,
    this.time,
    this.days = const [],
    this.enabled = false,
    this.nextRunAt,
    this.lastRunAt,
    this.lastResult,
    this.sceneId,
    this.sceneName,
    this.actions = const [],
    this.createdBy,
    this.createdById,
    this.sunEvent,
    this.offsetMin = 0,
    this.lastStatus,
    this.problems = const [],
  });

  factory Schedule.fromJson(Json json) => Schedule(
    lastStatus: RunStatus.fromJson(json['lastStatus']),
    problems: strList(json['problems']),
    sunEvent: strOrNull(json['sunEvent']),
    offsetMin: json['offsetMin'] is num ? (json['offsetMin'] as num).toInt() : 0,
    id: str(json['id']),
    name: str(json['name'], 'Schedule'),
    kind: ScheduleKind.fromJson(json['kind']),
    runAt: dateOrNull(json['runAt']),
    time: strOrNull(json['time']),
    days: intList(json['days']),
    enabled: boolean(json['enabled']),
    nextRunAt: dateOrNull(json['nextRunAt']),
    lastRunAt: dateOrNull(json['lastRunAt']),
    lastResult: strOrNull(json['lastResult']),
    sceneId: strOrNull(json['sceneId']),
    sceneName: strOrNull(json['sceneName']),
    actions: asJsonList(json['actions']).map(DeviceAction.fromJson).toList(),
    createdBy: strOrNull(json['createdBy']),
    createdById: strOrNull(json['createdById']),
  );

  final String id;
  final String name;
  final ScheduleKind kind;

  /// [ScheduleKind.once]: when.
  final DateTime? runAt;

  /// [ScheduleKind.daily]: "05:00" in the home's time zone, on [days] (0 = Sunday; none = every day).
  final String? time;
  final List<int> days;
  final bool enabled;

  /// Null once a timer has run.
  final DateTime? nextRunAt;
  final DateTime? lastRunAt;
  final String? lastResult;

  /// How the last run went (null: it hasn't run yet).
  final RunStatus? lastStatus;

  /// What can't run now: "Lamp: waiting for a replacement board".
  final List<String> problems;

  /// [lastStatus], or worked out from [lastResult] for runs from before it was kept.
  RunStatus? get status => lastStatus ?? (lastResult == null ? null : RunStatus.guess(lastResult!));

  /// Runs a scene instead of [actions].
  final String? sceneId;
  final String? sceneName;
  final List<DeviceAction> actions;
  final String? createdBy;
  final String? createdById;

  /// [ScheduleKind.sun]: `SUNRISE` or `SUNSET`, and minutes after it (negative = before).
  final String? sunEvent;
  final int offsetMin;

  /// "15 min after sunset" / "at sunrise".
  String get sunText {
    final ev = sunEvent == 'SUNRISE' ? 'sunrise' : 'sunset';
    if (offsetMin == 0) return 'at $ev';
    return '${offsetMin.abs()} min ${offsetMin < 0 ? 'before' : 'after'} $ev';
  }

  /// A waiting one-off that switches just [deviceId] off — the device sheet's "Turn off automatically".
  bool isTimerFor(String deviceId) =>
      kind == ScheduleKind.once &&
      enabled &&
      nextRunAt != null &&
      sceneId == null &&
      actions.length == 1 &&
      actions.single.deviceId == deviceId &&
      !actions.single.on;

  Schedule copyWith({bool? enabled, DateTime? nextRunAt}) => Schedule(
    id: id,
    name: name,
    kind: kind,
    runAt: runAt,
    time: time,
    days: days,
    enabled: enabled ?? this.enabled,
    nextRunAt: nextRunAt ?? this.nextRunAt,
    lastRunAt: lastRunAt,
    lastResult: lastResult,
    sceneId: sceneId,
    sceneName: sceneName,
    actions: actions,
    createdBy: createdBy,
    createdById: createdById,
    sunEvent: sunEvent,
    offsetMin: offsetMin,
    lastStatus: lastStatus,
    problems: problems,
  );
}

/// A schedule to create, in one of the three ways the app offers. Without a [name] the server
/// names it after its devices ("Fan off").
@immutable
class NewSchedule {
  /// Once, [minutes] from now.
  const NewSchedule.inMinutes(int minutes, this.actions, {this.name})
    : kind = ScheduleKind.once,
      inMinutes = minutes,
      runAt = null,
      time = null,
      days = const [],
      sunEvent = null,
      offsetMin = 0;

  /// Once, at [at].
  const NewSchedule.at(DateTime at, this.actions, {this.name})
    : kind = ScheduleKind.once,
      inMinutes = null,
      runAt = at,
      time = null,
      days = const [],
      sunEvent = null,
      offsetMin = 0;

  /// At [time] ("05:00") on [days] (0 = Sunday; empty = every day).
  const NewSchedule.daily(String this.time, this.days, this.actions, {this.name})
    : kind = ScheduleKind.daily,
      inMinutes = null,
      runAt = null,
      sunEvent = null,
      offsetMin = 0;

  /// At sunrise or sunset (`SUNRISE` / `SUNSET`), [offsetMin] minutes after it (negative: before), on [days].
  const NewSchedule.sun(String this.sunEvent, this.offsetMin, this.days, this.actions, {this.name})
    : kind = ScheduleKind.sun,
      inMinutes = null,
      runAt = null,
      time = null;

  final String? sunEvent;
  final int offsetMin;

  final ScheduleKind kind;
  final String? name;
  final int? inMinutes;
  final DateTime? runAt;
  final String? time;
  final List<int> days;
  final List<DeviceAction> actions;

  /// The body of `POST /schedules`.
  Json toJson() => {
    'kind': kind.json,
    'name': ?name,
    'inMinutes': ?inMinutes,
    if (runAt != null) 'runAt': runAt!.toUtc().toIso8601String(),
    if (kind == ScheduleKind.daily) ...{'time': time, 'days': days},
    if (kind == ScheduleKind.sun) ...{'sunEvent': sunEvent, 'offsetMin': offsetMin, 'days': days},
    'actions': [for (final a in actions) a.toJson()],
  };
}

/// What starts a rule: a device doing something ("opens", "goes above" 32 °C…).
@immutable
class RuleTrigger {
  const RuleTrigger({required this.deviceId, required this.event, this.value, this.field, this.deviceName = ''});

  factory RuleTrigger.fromJson(Json j) => RuleTrigger(
        deviceId: str(j['deviceId']),
        event: str(j['event'], 'on'),
        value: j['value'] is num ? (j['value'] as num).toDouble() : null,
        field: strOrNull(j['field']),
        deviceName: str(j['deviceName']),
      );

  final String deviceId;

  /// on, off, opens, closes, above, below, gridOff, gridOn
  final String event;
  final double? value;

  /// temperature, humidity or level (for above/below)
  final String? field;
  final String deviceName;

  bool get reading => event == 'above' || event == 'below';

  Json toJson() => {'deviceId': deviceId, 'event': event, if (reading) 'value': value ?? 0, if (reading && field != null) 'field': field};
}

/// Only then: between two times (overnight works), on some days, only in away mode.
@immutable
class RuleConditions {
  const RuleConditions({this.from, this.to, this.days = const [], this.away = false});

  factory RuleConditions.fromJson(Json j) =>
      RuleConditions(from: strOrNull(j['from']), to: strOrNull(j['to']), days: intList(j['days']), away: boolean(j['away']));

  final String? from, to;
  final List<int> days;
  final bool away;

  Json toJson() => {
        if (from != null && to != null) ...{'from': from, 'to': to},
        if (days.isNotEmpty && days.length < 7) 'days': days,
        if (away) 'away': true,
      };
}

/// One thing a rule does: switch a device (maybe only for a while), run a scene, or tell people.
@immutable
class RuleAction {
  const RuleAction.device(String this.deviceId, {required bool this.on, this.forMinutes, this.name = ''})
      : type = 'device',
        sceneId = null,
        to = null,
        message = null;
  const RuleAction.scene(String this.sceneId, {this.name = ''})
      : type = 'scene',
        deviceId = null,
        on = null,
        forMinutes = null,
        to = null,
        message = null;
  const RuleAction.notify(String this.to, {this.message})
      : type = 'notify',
        deviceId = null,
        on = null,
        forMinutes = null,
        sceneId = null,
        name = '';

  factory RuleAction.fromJson(Json j) => switch (str(j['type'])) {
        'scene' => RuleAction.scene(str(j['sceneId']), name: str(j['sceneName'])),
        'notify' => RuleAction.notify(str(j['to'], 'me'), message: strOrNull(j['message'])),
        _ => RuleAction.device(str(j['deviceId']), on: boolean(j['on']), forMinutes: j['forMinutes'] is num ? integer(j['forMinutes']) : null, name: str(j['deviceName'])),
      };

  final String type;
  final String? deviceId;
  final bool? on;
  final int? forMinutes;
  final String? sceneId;

  /// me, admins or everyone
  final String? to;
  final String? message;

  /// The device's or scene's name, as the server sent it.
  final String name;

  Json toJson() => switch (type) {
        'scene' => {'type': 'scene', 'sceneId': sceneId},
        'notify' => {'type': 'notify', 'to': to, if (message != null && message!.trim().isNotEmpty) 'message': message!.trim()},
        _ => {'type': 'device', 'deviceId': deviceId, 'on': on, if (on == true && forMinutes != null && forMinutes! > 0) 'forMinutes': forMinutes},
      };
}

/// What a device can start a rule with, in words that fit it (like the web's `eventsOf`).
List<(String, String)> ruleEventsFor(String type, Map<String, dynamic> settings) {
  final kind = settings['kind'];
  return switch (type) {
    'switch' => const [('on', 'Turns on'), ('off', 'Turns off')],
    'contact' => switch (kind) {
        'mains' => const [('gridOff', 'The grid goes (on UPS)'), ('gridOn', 'The grid comes back')],
        'motion' => const [('opens', 'Sees movement'), ('closes', 'Movement stops')],
        'leak' => const [('opens', 'Finds water'), ('closes', 'Is dry again')],
        _ => const [('opens', 'Opens'), ('closes', 'Closes')],
      },
    'dht' || 'analog' => const [('above', 'Goes above'), ('below', 'Goes below')],
    _ => const [],
  };
}

/// A rule to save (`POST /rules`, or `PATCH /rules/:id` for an edit).
@immutable
class RuleInput {
  const RuleInput({this.name, required this.trigger, this.conditions = const RuleConditions(), required this.actions});

  final String? name;
  final RuleTrigger trigger;
  final RuleConditions conditions;
  final List<RuleAction> actions;

  /// What's missing before it can be saved (null: ready).
  String? get problem => actions.isEmpty
      ? 'Say what to do: switch something, run a scene or send a notice.'
      : trigger.reading && trigger.value == null
          ? 'Say the value, e.g. above 30.'
          : (conditions.from == null) != (conditions.to == null)
              ? 'A time window needs a start and an end.'
              : null;

  Json toJson() => {
        if (name != null && name!.trim().isNotEmpty) 'name': name!.trim(),
        'trigger': trigger.toJson(),
        'conditions': conditions.toJson(),
        'actions': [for (final a in actions) a.toJson()],
      };
}

/// "When this happens, do that" (`/rules`): made here, on the web or by asking the assistant.
@immutable
class Rule {
  const Rule({
    required this.id,
    required this.name,
    this.enabled = true,
    this.summary = '',
    this.lastFiredAt,
    this.lastResult,
    this.createdBy,
    this.createdById,
    this.trigger,
    this.conditions = const RuleConditions(),
    this.actions = const [],
    this.problems = const [],
  });

  factory Rule.fromJson(Json json) => Rule(
    id: str(json['id']),
    name: str(json['name'], 'Rule'),
    enabled: boolean(json['enabled'], true),
    summary: str(json['summary']),
    lastFiredAt: dateOrNull(json['lastFiredAt']),
    lastResult: strOrNull(json['lastResult']),
    createdBy: strOrNull(json['createdBy']),
    createdById: strOrNull(json['createdById']),
    trigger: json['trigger'] is Map ? RuleTrigger.fromJson(asJson(json['trigger'])) : null,
    conditions: RuleConditions.fromJson(asJson(json['conditions'])),
    actions: asJsonList(json['actions']).map(RuleAction.fromJson).toList(),
    problems: strList(json['problems']),
  );

  /// What starts it, what limits it and what it does (to edit it); null trigger from an older server.
  final RuleTrigger? trigger;
  final RuleConditions conditions;
  final List<RuleAction> actions;

  /// "Gate: waiting for a replacement board".
  final List<String> problems;

  final String id;
  final String name;
  final bool enabled;

  /// In plain words: "When Main door opens between 22:00 and 06:00: Hall light on for 5 min, tell me".
  final String summary;
  final DateTime? lastFiredAt;
  final String? lastResult;
  final String? createdBy;
  final String? createdById;

  Rule copyWith({bool? enabled}) => Rule(
    id: id,
    name: name,
    enabled: enabled ?? this.enabled,
    summary: summary,
    lastFiredAt: lastFiredAt,
    lastResult: lastResult,
    createdBy: createdBy,
    createdById: createdById,
    trigger: trigger,
    conditions: conditions,
    actions: actions,
    problems: problems,
  );
}

/// Away mode: door and motion alerts at any hour, and (if picked) lights that make the home look lived-in.
@immutable
class AwayState {
  const AwayState({this.on = false, this.since, this.by, this.lights = const [], this.loaded = false});

  factory AwayState.fromJson(Json json) => AwayState(
    on: boolean(json['on']),
    since: dateOrNull(json['since']),
    by: strOrNull(json['by']),
    lights: [
      for (final id in strList(json['lights']))
        for (final s in asJsonList(json['switches']))
          if (str(s['id']) == id) str(s['name']),
    ],
    loaded: true,
  );

  final bool on;
  final DateTime? since;
  final String? by;

  /// Names of the lights that go on and off in the evening while away.
  final List<String> lights;
  final bool loaded;
}

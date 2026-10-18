import 'package:flutter/foundation.dart';

import 'json.dart';

enum PresenceStatus {
  home,
  away,
  unknown;

  static PresenceStatus fromJson(Object? v) => enumOf(values, v, unknown);

  String get label => switch (this) {
    home => 'Home',
    away => 'Out',
    unknown => 'Not known',
  };
}

/// Someone who shares when they're home.
@immutable
class PresencePerson {
  const PresencePerson({required this.id, required this.name, this.status = PresenceStatus.unknown, this.since, this.me = false});

  factory PresencePerson.fromJson(Json j) => PresencePerson(
    id: str(j['id']),
    name: str(j['name']),
    status: PresenceStatus.fromJson(j['status']),
    since: dateOrNull(j['since']),
    me: boolean(j['me']),
  );

  final String id, name;
  final PresenceStatus status;
  final DateTime? since;
  final bool me;
}

/// `GET /presence/me`: do I share when I'm home here, and the home's boards to look for on the Wi‑Fi.
@immutable
class MySharing {
  const MySharing({this.sharing = false, this.canShare = false, this.boards = const []});

  factory MySharing.fromJson(Json j) => MySharing(
    sharing: boolean(j['sharing']),
    canShare: boolean(j['canShare']),
    boards: [
      for (final b in asJsonList(j['boards']))
        if (str(b['nodeId']).isNotEmpty) (nodeId: str(b['nodeId']), ip: strOrNull(b['ip'])),
    ],
  );

  final bool sharing;

  /// only the home's own people can (staff looking in can't)
  final bool canShare;
  final List<({String nodeId, String? ip})> boards;
}

/// `GET /presence`: who's home (owners and admins, and the people who share it themselves).
@immutable
class WhoIsHome {
  const WhoIsHome({this.sharing = false, this.people = const [], this.line, this.lastResult});

  factory WhoIsHome.fromJson(Json j) => WhoIsHome(
    sharing: boolean(j['sharing']),
    people: asJsonList(j['people']).map(PresencePerson.fromJson).toList(),
    line: strOrNull(j['line']),
    lastResult: strOrNull(asJson(j['rule'])['lastResult']),
  );

  /// I share it in this home.
  final bool sharing;
  final List<PresencePerson> people;

  /// "Ali and Sara are home."
  final String? line;

  /// What the last-one-out rule did last ("Switched off Hall light. Away mode on.").
  final String? lastResult;
}

/// The home's "when everyone leaves" rule (owners and admins), and what it can use.
@immutable
class PresenceRuleState {
  const PresenceRuleState({this.rule, this.scenes = const [], this.sharers = 0, this.lightsAndFans = const []});

  factory PresenceRuleState.fromJson(Json j) {
    final r = j['rule'] is Map ? asJson(j['rule']) : null;
    return PresenceRuleState(
      rule: r == null
          ? null
          : PresenceRule(
              enabled: boolean(r['enabled'], true),
              switchOff: str(r['switchOff'], 'lights'),
              awayMode: boolean(r['awayMode']),
              notify: boolean(r['notify'], true),
              arriveSceneId: strOrNull(r['arriveSceneId']),
              lastResult: strOrNull(r['lastResult']),
              lastEventAt: dateOrNull(r['lastEventAt']),
            ),
      scenes: [for (final s in asJsonList(j['scenes'])) (id: str(s['id']), name: str(s['name']))],
      sharers: integer(j['sharers']),
      lightsAndFans: [
        for (final d in asJsonList(j['devices']))
          if (boolean(d['lightOrFan'])) str(d['name']),
      ],
    );
  }

  final PresenceRule? rule;
  final List<({String id, String name})> scenes;

  /// how many people share when they're home
  final int sharers;

  /// what "lights and fans" switches off now
  final List<String> lightsAndFans;
}

@immutable
class PresenceRule {
  const PresenceRule({
    this.enabled = true,
    this.switchOff = 'lights',
    this.awayMode = false,
    this.notify = true,
    this.arriveSceneId,
    this.lastResult,
    this.lastEventAt,
  });

  final bool enabled;

  /// "lights" | "chosen" | "none" (chosen devices are set on the web)
  final String switchOff;
  final bool awayMode, notify;
  final String? arriveSceneId;
  final String? lastResult;
  final DateTime? lastEventAt;
}

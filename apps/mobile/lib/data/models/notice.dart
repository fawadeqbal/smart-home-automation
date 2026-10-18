import 'package:flutter/foundation.dart';

import 'json.dart';

/// How serious a notice is: alerts (a leak) ring loudest.
enum NoticeSeverity {
  info,
  warn,
  alert;

  static NoticeSeverity fromJson(Object? v) => enumOf(values, v, info);
}

/// One notice for this person (`/notifications`): a water leak, a board offline, a guest's access ended…
@immutable
class Notice {
  const Notice({
    required this.id,
    required this.kind,
    required this.title,
    this.body = '',
    this.severity = NoticeSeverity.info,
    this.link,
    this.homeId,
    this.readAt,
    this.createdAt,
  });

  factory Notice.fromJson(Json j) => Notice(
    id: str(j['id']),
    kind: str(j['kind']),
    title: str(j['title']),
    body: str(j['body']),
    severity: NoticeSeverity.fromJson(j['severity']),
    link: strOrNull(j['link']),
    homeId: strOrNull(j['homeId']),
    readAt: dateOrNull(j['readAt']),
    createdAt: dateOrNull(j['createdAt']),
  );

  final String id, kind, title, body;
  final NoticeSeverity severity;

  /// Where it points in the web app (`/devices/<id>?home=<home>`); [NoticeTarget] turns it into a screen.
  final String? link;
  final String? homeId;
  final DateTime? readAt, createdAt;

  bool get unread => readAt == null;

  Notice markRead() => Notice(
    id: id,
    kind: kind,
    title: title,
    body: body,
    severity: severity,
    link: link,
    homeId: homeId,
    readAt: readAt ?? DateTime.now(),
    createdAt: createdAt,
  );
}

/// My notices, newest first, and how many are unread.
@immutable
class NoticeList {
  const NoticeList({this.items = const [], this.unread = 0});

  factory NoticeList.fromJson(Json j) => NoticeList(
    items: asJsonList(j['items']).map(Notice.fromJson).toList(),
    unread: integer(j['unread']),
  );

  final List<Notice> items;
  final int unread;
}

/// Where a tap on a notice goes in the app. The server writes web paths; the app has fewer screens, so
/// each maps to the nearest one (and which home to open first).
@immutable
class NoticeTarget {
  const NoticeTarget({required this.route, this.homeId, this.deviceId});

  /// a path in the app ("/home/family", "/routines", "/me/health", "/home")
  final String route;

  /// open this home first (when it isn't the open one)
  final String? homeId;

  /// then show this device's sheet
  final String? deviceId;

  /// "/devices/d1?home=h1" -> the home tab with d1's sheet; "/people" -> family; "/automations" -> routines …
  static NoticeTarget fromLink(String? link, {String? homeId}) {
    final uri = Uri.tryParse(link ?? '');
    final home = uri?.queryParameters['home'] ?? homeId;
    final path = uri?.path ?? '';
    final segments = path.split('/').where((s) => s.isNotEmpty).toList();
    final first = segments.isEmpty ? '' : segments.first;
    return switch (first) {
      'devices' when segments.length > 1 => NoticeTarget(route: '/home', homeId: home, deviceId: segments[1]),
      'people' => NoticeTarget(route: '/me/family', homeId: home),
      'automations' => NoticeTarget(route: '/routines', homeId: home),
      'diagnostics' => NoticeTarget(route: '/me/health', homeId: home),
      'activity' => NoticeTarget(route: '/home/activity', homeId: home),
      'rooms' => NoticeTarget(route: '/rooms', homeId: home),
      // the pages the phone has now too (home-mobile)
      'billing' when segments.length > 1 => NoticeTarget(route: '/me/billing/${segments[1]}', homeId: home),
      'billing' => NoticeTarget(route: '/me/billing', homeId: home),
      'energy' => NoticeTarget(route: '/home/energy', homeId: home),
      'installation' => NoticeTarget(route: '/me/installation', homeId: home),
      'summary' => NoticeTarget(route: '/me/summary', homeId: home),
      'account' => NoticeTarget(route: '/me/account', homeId: home),
      'help' when segments.length > 1 => NoticeTarget(route: '/me/help/${segments[1]}', homeId: home),
      'help' => NoticeTarget(route: '/me/help', homeId: home),
      _ => NoticeTarget(route: '/home/notifications', homeId: home),
    };
  }
}

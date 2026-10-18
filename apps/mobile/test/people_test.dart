import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:switchboard_home/core/theme/app_theme.dart';
import 'package:switchboard_home/data/models/notice.dart';
import 'package:switchboard_home/data/models/people.dart';
import 'package:switchboard_home/data/models/presence.dart';
import 'package:switchboard_home/data/models/session.dart';
import 'package:switchboard_home/features/family/access_limits.dart';
import 'package:switchboard_home/features/notices/notifications_screen.dart';
import 'package:switchboard_home/state/notices.dart';

/// The notices without a server.
class _FakeNotices extends NoticesController {
  _FakeNotices(this.list);
  final NoticeList list;

  @override
  Future<NoticeList> build() async => list;
}

void main() {
  test('a notice\'s link opens the nearest screen of the app', () {
    final d = NoticeTarget.fromLink('/devices/d1?home=h1');
    expect((d.route, d.homeId, d.deviceId), ('/home', 'h1', 'd1'));
    expect(NoticeTarget.fromLink('/people?home=h2').route, '/me/family');
    expect(NoticeTarget.fromLink('/automations?home=h1').route, '/routines');
    expect(NoticeTarget.fromLink('/diagnostics?home=h1&board=esp-1').route, '/me/health');
    expect(NoticeTarget.fromLink('/support/7').route, '/home/notifications');
    // bills, electricity, the installation report and the summary open their own pages now
    expect(NoticeTarget.fromLink('/billing/inv1?home=h1').route, '/me/billing/inv1');
    expect(NoticeTarget.fromLink('/billing?home=h1').route, '/me/billing');
    expect(NoticeTarget.fromLink('/energy').route, '/home/energy');
    expect(NoticeTarget.fromLink('/installation?home=h1').route, '/me/installation');
    expect(NoticeTarget.fromLink('/summary?period=week').route, '/me/summary');
    expect(NoticeTarget.fromLink('/account').route, '/me/account');
    expect(NoticeTarget.fromLink(null, homeId: 'h3').homeId, 'h3');
  });

  test('notices and who\'s home read from the API', () {
    final list = NoticeList.fromJson({
      'unread': 1,
      'items': [
        {'id': 'n1', 'kind': 'leak', 'severity': 'ALERT', 'title': 'Water leak!', 'body': 'Check it now.', 'link': '/devices/d1', 'readAt': null, 'createdAt': '2026-10-18T10:00:00Z'},
        {'id': 'n2', 'kind': 'presence', 'severity': 'INFO', 'title': 'Everyone has left', 'body': '', 'readAt': '2026-10-18T10:05:00Z'},
      ],
    });
    expect(list.unread, 1);
    expect(list.items.first.severity, NoticeSeverity.alert);
    expect(list.items.first.unread, true);
    expect(list.items.last.unread, false);
    expect(list.items.first.markRead().unread, false);

    final who = WhoIsHome.fromJson({
      'sharing': true,
      'line': 'Ali is home.',
      'people': [
        {'id': 'u1', 'name': 'Ali Khan', 'status': 'home', 'me': true},
        {'id': 'u2', 'name': 'Sara', 'status': 'later-status'},
      ],
    });
    expect(who.people.first.status, PresenceStatus.home);
    expect(who.people.last.status, PresenceStatus.unknown); // a status this app doesn't know yet
    final mine = MySharing.fromJson({'sharing': true, 'canShare': true, 'boards': [{'nodeId': 'esp-1', 'ip': '192.168.1.5'}, {'ip': 'x'}]});
    expect(mine.boards.length, 1);
  });

  test('a guest\'s limits: the home tells the app when it may not use it', () {
    final home = CurrentHome.fromJson({
      'id': 'h1', 'name': 'Home', 'role': 'GUEST',
      'blocked': {'reason': 'hours', 'message': 'Your access to Home is from 9:00 to 17:00.'},
      'access': {'summary': '9:00–17:00 Mon–Sat'},
    });
    expect(home.blocked, 'Your access to Home is from 9:00 to 17:00.');
    expect(home.accessSummary, '9:00–17:00 Mon–Sat');
    final m = Member.fromJson({
      'id': 'u', 'name': 'Shazia', 'role': 'GUEST',
      'access': {'accessFrom': '09:00', 'accessTo': '17:00', 'accessDays': [1, 2, 3, 4, 5, 6], 'accessUntil': null, 'status': 'expired', 'summary': 'x'},
    });
    expect(m.access!.status, AccessStatus.expired);
    expect(m.access!.hasHours, true);

    // the editor round-trips and sends what the API takes
    final draft = LimitsDraft.of(m.access);
    expect(draft.hours, true);
    expect(draft.days, {1, 2, 3, 4, 5, 6});
    expect(draft.body, {'accessUntil': null, 'accessFrom': '09:00', 'accessTo': '17:00', 'accessDays': [1, 2, 3, 4, 5, 6]});
    final until = DateTime(2026, 10, 25, 20);
    expect(draft.copyWith(until: until).body['accessUntil'], until.toUtc().toIso8601String());
    expect(const LimitsDraft().any, false);
    expect(const LimitsDraft().body, {'accessUntil': null, 'accessFrom': null, 'accessTo': null, 'accessDays': <int>[]});
  });

  testWidgets('the bell shows the unread count, the list marks new ones', (tester) async {
    final list = NoticeList.fromJson({
      'unread': 2,
      'items': [
        {'id': 'n1', 'kind': 'leak', 'severity': 'ALERT', 'title': 'Water leak in the Kitchen!', 'body': 'Check it now.', 'createdAt': DateTime.now().toIso8601String()},
        {'id': 'n2', 'kind': 'accessEnded', 'severity': 'INFO', 'title': 'Shazia’s access ended', 'body': 'Extend it on the People page.'},
      ],
    });
    await tester.pumpWidget(
      ProviderScope(
        overrides: [noticesProvider.overrideWith(() => _FakeNotices(list))],
        child: MaterialApp(
          theme: AppTheme.light(),
          home: Scaffold(
            body: Column(
              children: [
                const NoticeBell(),
                for (final n in list.items) NoticeRow(notice: n),
              ],
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('2'), findsOneWidget);
    expect(find.bySemanticsLabel('Notifications, 2 unread'), findsOneWidget);
    expect(find.text('Water leak in the Kitchen!'), findsOneWidget);
    expect(find.text('Now'), findsOneWidget);
  });
}

import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:switchboard_home/core/theme/app_theme.dart';
import 'package:switchboard_home/data/models/alert_groups.dart';
import 'package:switchboard_home/data/models/automation.dart';
import 'package:switchboard_home/data/models/billing.dart';
import 'package:switchboard_home/data/models/board.dart';
import 'package:switchboard_home/data/models/device.dart';
import 'package:switchboard_home/data/models/device_detail.dart';
import 'package:switchboard_home/data/models/energy.dart';
import 'package:switchboard_home/data/models/help.dart';
import 'package:switchboard_home/data/models/installation.dart';
import 'package:switchboard_home/data/models/people.dart';
import 'package:switchboard_home/data/models/power.dart';
import 'package:switchboard_home/data/models/session.dart' hide HomeSummary;
import 'package:switchboard_home/data/repositories/account_repository.dart';
import 'package:switchboard_home/features/energy/day_bars.dart';
import 'package:switchboard_home/features/energy/shedding_section.dart';
import 'package:switchboard_home/features/rooms/manage_rooms.dart';
import 'package:switchboard_home/shared/widgets/markdown_text.dart';

void main() {
  group('electricity', () {
    final e = Energy.fromJson({
      'days': 7, 'tariff': 48, 'tariffSet': true, 'unknown': 1, 'powerCuts': 16,
      'total': {'kwh': 62.3, 'cost': 2990, 'hours': 218.6}, 'month': {'kwh': 306, 'cost': 14680},
      'perDay': [{'day': '2026-10-13', 'kwh': 9.2, 'cost': 441}, {'day': '2026-10-19', 'kwh': 0.4, 'cost': 19}],
      'devices': [
        {'id': 'd1', 'name': 'AC', 'room': 'Living room', 'watts': 1500, 'wattsSource': 'set', 'hours': 27, 'kwh': 40, 'cost': 1909, 'onNow': true},
        {'id': 'd2', 'name': 'Lamp', 'watts': 0, 'wattsSource': 'unknown', 'hours': 3, 'kwh': 0, 'cost': 0},
      ],
    });

    test('a week reads with its days, its devices and the rate', () {
      expect(e.tariffSet, isTrue);
      expect(e.perDay, hasLength(2));
      expect(e.perDay.first.label(short: true), 'Tue');
      expect(e.perDay.first.label(short: false), '13');
      expect(e.maxDay, 9.2);
      expect(e.devices.first.onNow, isTrue);
      expect(e.devices.first.shareOf(e.kwh), closeTo(.64, .01));
      expect(e.devices.first.wattsText, '1500 W');
      expect(e.devices.last.wattsText, 'power not set');
      expect(Energy.hoursText(.5), '30 min');
      expect(Energy.hoursText(6.6), '6.6 h');
      expect(Energy.hoursText(27), '27 h');
      expect(Energy.rate(48), 'Rs 48');
      expect(Energy.rate(47.5), 'Rs 47.5');
      expect(Energy.units(12151), '12,151');
      expect(Energy.rupees(-1500), 'Rs -1,500');
    });

    test('the WhatsApp text has the total, the month and the top devices', () {
      final text = e.shareText('Khan House', 'last 7 days');
      expect(text, startsWith('*Khan House — electricity, last 7 days* (estimate)'));
      expect(text, contains('About 62 units, Rs 2,990 at Rs 48 a unit.'));
      expect(text, contains('• AC: 40 units, Rs 1,909'));
      expect(text, isNot(contains('Lamp')));
    });

    test('load-shedding never says "2 or more of the last 1 days"', () {
      final fresh = sheddingHow('none', observedDays: 1, needed: 2);
      expect(fresh, isNot(contains('last 1 days')));
      expect(fresh, contains('on 2 different days'));
      expect(fresh, contains('1 day of power history'));
      expect(sheddingHow('none', observedDays: 10, needed: 4), contains('on 4 or more of the last 10 days'));
      expect(sheddingHow('learned', observedDays: 14, needed: 5), contains('at least 5 of them'));
      expect(sheddingHow('area', observedDays: 3, needed: 2, place: 'Lahore'), contains('other homes in Lahore'));
      expect(Shedding.fromJson({'source': 'none', 'learned': {'observedDays': 1, 'needed': 2}}).how, contains('2 different days'));
    });

    test('price bands read as on the bill, and are checked like the server does', () {
      const slabs = [Slab(upTo: 100, rate: 22), Slab(upTo: 200, rate: 30), Slab(rate: 45)];
      expect(Slab.describe(slabs), ['Up to 100 units: Rs 22 a unit', '101 to 200 units: Rs 30 a unit', 'Above 200 units: Rs 45 a unit']);
      expect(Slab.describe(const [Slab(rate: 50)]), ['Every unit: Rs 50 a unit']);
      expect(Slab.problem(slabs), isNull);
      expect(Slab.problem(const [Slab(upTo: 200, rate: 22), Slab(upTo: 100, rate: 30), Slab(rate: 45)]), contains('higher'));
      expect(Slab.problem(const [Slab(rate: 22), Slab(rate: 30)]), contains('last band'));
      expect(Slab.problem(const [Slab(upTo: 100, rate: 0), Slab(rate: 30)]), contains('above Rs 0'));
      final added = Slab.addBand(slabs, 60);
      expect(added.map((s) => s.upTo), [100, 200, 300, null]);
      expect(added.last.rate, 45);
      expect(Slab.addBand(const [], 55).map((s) => (s.upTo, s.rate)), [(100, 55.0), (null, 55.0)]);
      expect(const Slab(upTo: 100, rate: 22).toJson(), {'upTo': 100, 'rate': 22.0});
    });

    test('the bill carries its rates, its dates and the cycle', () {
      final b = Bill.fromJson({
        'tariff': 48, 'tariffSet': true, 'slabs': [{'upTo': 100, 'rate': 22}, {'upTo': null, 'rate': 45}],
        'cycle': {'start': '2026-09-30T19:00:00.000Z', 'end': '2026-10-31T19:00:00.000Z', 'daysLeft': 13},
        'latest': {'kwh': 12151, 'readAt': '2026-10-16T20:54:55.584Z'},
      });
      expect(b.slabs, hasLength(2));
      expect(b.slabs.last.upTo, isNull);
      expect(b.cycleStart, isNotNull);
      expect(b.latestAt, isNotNull);
      expect(b.daysLeft, 13);
    });

    test('UPS mode names its heavy loads', () {
      final g = GridSettings.fromJson({
        'sensor': {'id': 's', 'name': 'Grid sensor'}, 'off': false, 'loads': ['a'], 'restore': true,
        'switches': [{'id': 'a', 'name': 'AC', 'heavy': true}, {'id': 'b', 'name': 'Lamp', 'heavy': false}],
      });
      expect(g.sensor, 'Grid sensor');
      expect(g.loadNames, ['AC']);
      expect(GridSettings.fromJson({'sensor': null}).sensor, isNull);
    });

    test('the day strip marks the expected cut windows, also past midnight', () {
      const w = [CutWindow(from: '14:00', to: '15:00'), CutWindow(from: '23:30', to: '00:30')];
      expect(inWindows(28, w), isTrue); // 14:00
      expect(inWindows(29, w), isTrue); // 14:30
      expect(inWindows(30, w), isFalse); // 15:00
      expect(inWindows(47, w), isTrue); // 23:30
      expect(inWindows(0, w), isTrue); // 00:00
      expect(inWindows(1, w), isFalse); // 00:30
    });
  });

  group('plan and bills', () {
    final billing = HomeBilling.fromJson({
      'company': 'Switchboard', 'due': 4300,
      'pay': {'bank': 'Meezan · PK36', 'jazzcash': '0300 1234567', 'easypaisa': null},
      'contract': {'id': 'c', 'plan': 'Care plan', 'amount': 2500, 'period': 'MONTHLY', 'periodText': 'a month', 'visitsIncluded': 1, 'startsOn': '2026-09-08', 'endsOn': '2027-09-08', 'nextInvoiceOn': '2026-11-08', 'status': 'ACTIVE'},
      'invoices': [
        {'id': 'i3', 'number': 3, 'description': 'Extra visit', 'amount': 1800, 'issuedOn': '2026-10-19', 'dueOn': '2026-10-26', 'status': 'DUE', 'late': false},
        {'id': 'i2', 'number': 2, 'description': 'Care plan, 8 Oct – 7 Nov 2026', 'amount': 2500, 'dueOn': '2026-10-14', 'status': 'DUE', 'late': true},
        {'id': 'i1', 'number': 1, 'description': 'Care plan', 'amount': 2500, 'status': 'PAID', 'paidOn': '2026-09-18', 'method': 'jazzcash', 'reference': 'JC-1'},
      ],
    });

    test('the plan, the bills and what is due', () {
      expect(billing.loaded, isTrue);
      expect(billing.contract!.priceText, 'Rs 2,500 a month');
      expect(billing.contract!.visitsText, '1 visit included each month');
      expect(billing.contract!.daysLeft(DateTime(2027, 9, 1)), 7);
      expect(billing.unpaid, hasLength(2));
      expect(billing.anyLate, isTrue);
      expect(billing.dueLine, 'Rs 4,300 to pay · 1 overdue');
      expect(const HomeBilling(due: 0).dueLine, isNull);
      expect(billing.pay.ways.map((w) => w.$1), ['JazzCash', 'Bank']);
      final [due, late, paid] = billing.invoices;
      expect((due.statusText, late.statusText, paid.statusText), ('Due', 'Overdue', 'Paid'));
      expect(late.line, 'Invoice 2 · was due 14 Oct 2026');
      expect(paid.paidText, 'Paid on 18 Sep 2026 by JazzCash (ref. JC-1). Thank you!');
    });

    test('an invoice to share, and the message that says it was paid', () {
      final d = InvoiceDetail.fromJson({
        'id': 'i2', 'number': 2, 'description': 'Care plan', 'amount': 2500, 'dueOn': '2026-10-14', 'status': 'DUE', 'late': true,
        'company': {'name': 'Switchboard', 'billingEmail': 'bills@example.com'}, 'pay': {'jazzcash': '0300 1234567'},
        'billTo': {'home': 'Khan House', 'city': 'Lahore', 'owner': {'name': 'Sara Khan'}},
      });
      expect(d.billTo, 'Sara Khan');
      expect(d.billToHome, 'Khan House, Lahore');
      final share = d.shareText();
      expect(share, contains('Amount: *Rs 2,500*'));
      expect(share, contains('It was due on: 14 Oct 2026'));
      expect(share, contains('JazzCash: 0300 1234567'));
      expect(share, contains('Please write invoice 2 as the reference.'));
      final paid = d.paidMessage(method: 'JazzCash', reference: ' 0123456 ', note: '');
      expect(paid, startsWith('I have paid invoice 2 (Care plan): Rs 2,500 by JazzCash.'));
      expect(paid, contains('Reference: 0123456'));
      expect(dayText('2026-10-26'), '26 Oct 2026');
    });
  });

  group('notifications, help, rules', () {
    test('every kind the server offers lands in a topic', () {
      const prefs = [
        NotificationPref('leak', 'Water leak', true),
        NotificationPref('billing', 'A new bill', true),
        NotificationPref('backup', 'Backups (super admins)', true),
        NotificationPref('somethingNew', 'A new kind', false),
      ];
      final home = groupAlerts(prefs, staff: false);
      expect(home.map((g) => g.$1), ['Safety at home', 'Bills and help', 'Other']);
      expect(home.expand((g) => g.$2).any((p) => p.key == 'backup'), isFalse);
      expect(groupAlerts(prefs, staff: true).map((g) => g.$1), contains('For the team'));
      expect(alertsSummary(prefs, staff: false), '2 of 3 on');
    });

    test('help search ranks titles and keywords, ignores Markdown', () {
      const a = [
        HelpArticle(id: '1', title: 'A board is offline', tags: ['batti', 'offline'], body: 'Check the **breaker** first.'),
        HelpArticle(id: '2', title: 'Add family', body: 'Invite people. A board can be offline too.'),
      ];
      final hits = searchHelp(a, 'offline board');
      expect(hits.map((h) => h.$1.id), ['1', '2']);
      expect(searchHelp(a, 'batti').single.$1.id, '1');
      expect(searchHelp(a, 'x'), isEmpty);
      expect(plainText('## Hi\n- **bold** [link](http://x) [[check: 2 years]]'), 'Hi bold link 2 years');
      expect(helpSection('FAQ').label, 'Questions');
    });

    test('Markdown blocks for articles', () {
      final blocks = parseMarkdown('# Title\n\nSome *text*.\n\n- one\n- two\n\n1. first\n2. second\n\n> note\n\n| a | b |\n|---|---|\n| 1 | 2 |');
      expect(blocks.map((b) => b.runtimeType), [MdHeading, MdParagraph, MdList, MdList, MdQuote, MdTable]);
      expect((blocks[2] as MdList).items, ['one', 'two']);
      expect((blocks[3] as MdList).numbered, isTrue);
      expect((blocks[5] as MdTable).rows, [['a', 'b'], ['1', '2']]);
    });

    test('a rule round-trips to the API body', () {
      final r = Rule.fromJson({
        'id': 'r', 'name': 'Gate', 'enabled': true, 'summary': 'When Gate opens…', 'problems': ['Gate: waiting for a replacement board'],
        'trigger': {'deviceId': 'gate', 'event': 'opens', 'deviceName': 'Gate'},
        'conditions': {'from': '22:00', 'to': '06:00', 'days': [1, 2]},
        'actions': [
          {'type': 'device', 'deviceId': 'porch', 'on': true, 'forMinutes': 5, 'deviceName': 'Porch'},
          {'type': 'scene', 'sceneId': 's1', 'sceneName': 'Night'},
          {'type': 'notify', 'to': 'me', 'message': 'Someone is at the gate'},
        ],
      });
      expect(r.trigger!.event, 'opens');
      expect(r.problems, hasLength(1));
      final body = RuleInput(name: '', trigger: r.trigger!, conditions: r.conditions, actions: r.actions).toJson();
      expect(body, {
        'trigger': {'deviceId': 'gate', 'event': 'opens'},
        'conditions': {'from': '22:00', 'to': '06:00', 'days': [1, 2]},
        'actions': [
          {'type': 'device', 'deviceId': 'porch', 'on': true, 'forMinutes': 5},
          {'type': 'scene', 'sceneId': 's1'},
          {'type': 'notify', 'to': 'me', 'message': 'Someone is at the gate'},
        ],
      });
      expect(r.copyWith(enabled: false).actions, hasLength(3));
      // a reading needs its value; a rule needs something to do
      const hot = RuleTrigger(deviceId: 't', event: 'above', field: 'temperature');
      expect(const RuleInput(trigger: hot, actions: [RuleAction.notify('me')]).problem, contains('value'));
      expect(const RuleInput(trigger: RuleTrigger(deviceId: 't', event: 'on'), actions: []).problem, contains('Say what to do'));
      expect(const RuleTrigger(deviceId: 't', event: 'above', value: 32, field: 'temperature').toJson(), {'deviceId': 't', 'event': 'above', 'value': 32.0, 'field': 'temperature'});
      // switching off doesn't take "for a while"
      expect(const RuleAction.device('x', on: false, forMinutes: 5).toJson(), {'type': 'device', 'deviceId': 'x', 'on': false});
    });

    test('what each device can start a rule with', () {
      expect(ruleEventsFor('switch', {}).map((e) => e.$1), ['on', 'off']);
      expect(ruleEventsFor('contact', {'kind': 'motion'}).first.$2, 'Sees movement');
      expect(ruleEventsFor('contact', {'kind': 'mains'}).first.$1, 'gridOff');
      expect(ruleEventsFor('dht', {}).map((e) => e.$1), ['above', 'below']);
      expect(ruleEventsFor('fan', {}), isEmpty);
    });

    test('a sunset schedule body', () {
      const s = NewSchedule.sun('SUNSET', -15, [1, 2, 3], [DeviceAction(deviceId: 'p', on: true)]);
      expect(s.toJson(), {
        'kind': 'SUN', 'sunEvent': 'SUNSET', 'offsetMin': -15, 'days': [1, 2, 3],
        'actions': [{'deviceId': 'p', 'on': true}],
      });
    });
  });

  group('devices, boards, rooms, account, installation', () {
    test('a device page: safety choices and readings oldest first', () {
      final d = DeviceDetail.fromJson({
        'id': 'g', 'key': 'g', 'name': 'Geyser', 'type': 'switch', 'autoOffMinutes': 45, 'watts': 2000,
        'stateFields': [{'key': 'temperature', 'label': 'Temperature', 'unit': '°C'}],
      });
      expect(d.autoOffChoices, [0, 15, 30, 45, 60, 90, 120, 180, 240]);
      expect(d.watts, 2000);
      expect(d.stateFields.single.unit, '°C');
      expect(DeviceDetail.autoOffText(0), 'Never');
      expect(DeviceDetail.autoOffText(60), 'After 1 hour');
      expect(DeviceDetail.autoOffText(120), 'After 2 hours');
      expect(DeviceDetail.autoOffText(90), 'After 1 h 30 min');
      final points = readingsOf([
        {'at': '2026-10-19T10:00:00Z', 'state': {'temperature': 30}},
        {'at': '2026-10-19T09:00:00Z', 'state': {'temperature': 28.5}},
        {'at': '2026-10-19T08:00:00Z', 'state': {'humidity': 50}},
      ], 'temperature');
      expect(points.map((p) => p.value), [28.5, 30.0]);
    });

    test('a board says how it is and what to try', () {
      final ok = BoardInfo.fromJson({'id': 'b', 'name': 'Kitchen board', 'online': true, 'configRev': 2, 'appliedRev': 2, 'health': {'rssi': -60, 'vcc': 3300, 'heap': 28000, 'uptime': 3700}, 'devices': [{}, {}]});
      expect(ok.condition, ('ok', 'Healthy'));
      expect(ok.devices, 2);
      expect(ok.signalText, 'Good (-60 dBm)');
      expect(ok.uptimeText, '1 h 1 min');
      expect(ok.advice, isEmpty);
      final off = BoardInfo.fromJson({'id': 'b', 'name': 'Kitchen board', 'online': false});
      expect(off.condition.$1, 'bad');
      expect(off.advice.first, contains('for the kitchen in your main panel'));
      final weak = BoardInfo.fromJson({'id': 'b', 'name': 'Porch', 'online': true, 'health': {'rssi': -82}});
      expect(weak.condition, ('warn', 'Weak Wi‑Fi'));
      expect(BoardInfo.fromJson({'id': 'x', 'status': 'STOCK'}).installed, isFalse);
    });

    test('moving a room up renumbers the rest', () {
      const rooms = [Room(id: 'a', name: 'A', order: 0), Room(id: 'b', name: 'B', order: 1), Room(id: 'c', name: 'C', order: 2)];
      expect(reorderRooms(rooms, 2, 0).map((x) => (x.$1.id, x.$2)), [('c', 0), ('a', 1), ('b', 2)]);
      expect(reorderRooms(rooms, 0, 5).map((x) => x.$1.id), ['b', 'c', 'a']);
    });

    test('people: invites and room rights in words', () {
      final i = PendingInvite.fromJson({'id': 'i', 'email': 'ali@example.com', 'role': 'GUEST', 'expiresAt': '2026-10-25T00:00:00Z'});
      expect(i.role, HomeRole.guest);
      expect(accessLabel(null), 'No access');
      expect(accessLabel(Access.manage), 'Switch & rename');
    });

    test('two-step setup decodes its QR, sessions know phones', () {
      final s = TwoStepSetup.fromJson({'secret': 'ABCD EFGH', 'uri': 'otpauth://totp/x', 'qr': 'data:image/png;base64,iVBORw0KGgo='});
      expect(s.qrPng, isNotNull);
      expect(TwoStepSetup.fromJson({'qr': 'nope'}).qrPng, isNull);
      expect(SignInSession.fromJson({'id': '1', 'device': 'Switchboard app'}).phone, isTrue);
      expect(SignInSession.fromJson({'id': '1', 'device': 'Chrome on Windows'}).phone, isFalse);
      expect(TwoStepStatus.fromJson({'enabled': true, 'recoveryLeft': 8}).recoveryLeft, 8);
    });

    test('the installation report and a drawn signature', () {
      final r = InstallReport.fromJson({
        'installer': 'Fawad', 'done': 2, 'total': 2, 'canSign': true,
        'items': [{'key': 'wifi', 'label': 'Wi-Fi', 'done': true, 'check': {'ok': true, 'text': '2 of 2 online'}}, {'key': 'clean', 'label': 'Clean', 'done': true}],
        'photos': [{'id': 'p', 'url': '/api/installation/photos/p?exp=1&sig=2', 'caption': 'Board'}],
      });
      expect(r.complete, isTrue);
      expect(r.items.first.checkText, '2 of 2 online');
      expect(r.photos.single.on('https://home.example.com/'), 'https://home.example.com/api/installation/photos/p?exp=1&sig=2');
      final png = Uint8List.fromList([137, 80, 78, 71, 1, 2, 3]);
      expect(pngFromDataUrl(pngDataUrl(png)), png);
      expect(pngFromDataUrl('data:image/jpeg;base64,AAAA'), isNull);
    });

    test('a summary line splits into its topic and the rest', () {
      expect(HomeSummary.split('Power: 8 cuts, 7 h without power'), ('Power', '8 cuts, 7 h without power'));
      expect(HomeSummary.split('All quiet'), ('', 'All quiet'));
    });
  });

  testWidgets('the day bars draw, and a tap reads that day', (tester) async {
    await tester.pumpWidget(MaterialApp(
      theme: AppTheme.light(),
      home: const Scaffold(
        body: Padding(
          padding: EdgeInsets.all(16),
          child: DayBars(days: [
            EnergyDay(day: '2026-10-13', kwh: 9.2, cost: 441),
            EnergyDay(day: '2026-10-14', kwh: 4, cost: 192),
            EnergyDay(day: '2026-10-15', kwh: 0, cost: 0),
          ]),
        ),
      ),
    ));
    expect(find.textContaining('a day · tap a bar'), findsOneWidget);
    expect(find.text('Tue'), findsOneWidget);
    // the first of three bars is in the left third
    final box = tester.getRect(find.byType(CustomPaint).last);
    await tester.tapAt(Offset(box.left + box.width / 6, box.center.dy));
    await tester.pump();
    expect(find.textContaining('Tue 13 Oct: 9.2 units · Rs 441'), findsOneWidget);
  });
}

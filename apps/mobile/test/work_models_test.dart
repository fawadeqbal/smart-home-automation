import 'package:flutter_test/flutter_test.dart';
import 'package:switchboard_home/data/models/session.dart';
import 'package:switchboard_home/data/models/work/board.dart';
import 'package:switchboard_home/data/models/work/day.dart';
import 'package:switchboard_home/data/models/work/homes.dart';
import 'package:switchboard_home/data/models/work/office.dart';
import 'package:switchboard_home/data/models/work/tickets.dart';

void main() {
  test('the installer’s day reads stops, jobs, the route and the ticket behind a job', () {
    final day = InstallerDay.fromJson({
      'date': '2026-10-19',
      'installer': {'id': 'u1', 'name': 'Ravi Kumar'},
      'installers': [
        {'id': 'u1', 'name': 'Ravi Kumar', 'staffRole': 'INSTALLER'},
        {'id': 'u0', 'name': 'Fawad', 'staffRole': 'SUPERADMIN'},
      ],
      'baseSet': true,
      'totalKm': 12.4,
      'mapsUrl': 'https://www.google.com/maps/dir/?api=1&destination=1,2',
      'stops': [
        {
          'key': 'h1',
          'n': 1,
          'kind': 'home',
          'name': 'Khan residence',
          'city': 'Lahore',
          'lat': 31.4,
          'lng': '74.2',
          'homeId': 'h1',
          'whatsapp': '923214567890',
          'phone': '+923214567890',
          'legKm': 6.2,
          'directions': 'https://maps/x',
          'jobs': [
            {
              'type': 'install',
              'title': 'Installation',
              'detail': '1 board to install',
              'link': '/console/homes/h1?tab=installation',
            },
            {
              'type': 'ticket',
              'title': '#1 · Fan',
              'detail': 'High priority',
              'link': '/console/tickets/t9',
              'priority': 'HIGH',
            },
          ],
        },
        {
          'key': 'visit:v1',
          'n': 2,
          'kind': 'visit',
          'name': 'Bilal',
          'city': '',
          'lat': null,
          'jobs': [
            {
              'type': 'visit',
              'title': 'Home visit: Bilal',
              'at': '2026-10-19T11:30:00.000Z',
              'link': '/console/requests?id=v1',
            },
          ],
        },
      ],
    });
    expect(day.installer!.name, 'Ravi Kumar');
    expect(day.installers.last.role.label, 'Super admin');
    expect(day.totalKm, 12.4);
    final home = day.stops.first;
    expect(home.located, isTrue);
    expect(home.lng, 74.2);
    expect(home.installing, isTrue);
    expect(home.jobs[1].ticketId, 't9');
    expect(home.jobs[0].ticketId, isNull);
    final visit = day.stops.last;
    expect(visit.isVisit, isTrue);
    expect(visit.located, isFalse);
    expect(visit.visitAt, DateTime.utc(2026, 10, 19, 11, 30).toLocal());
    expect(WorkDays.inPakistan(visit.visitAt!).hour, 16);
  });

  test('calendar days are Pakistan’s, and shift across months', () {
    expect(WorkDays.today(DateTime.utc(2026, 10, 18, 20, 0)), '2026-10-19'); // 1 am in Lahore
    expect(WorkDays.today(DateTime.utc(2026, 10, 18, 18, 0)), '2026-10-18');
    expect(WorkDays.shift('2026-10-31', 1), '2026-11-01');
    expect(WorkDays.shift('2026-03-01', -1), '2026-02-28');
  });

  test('a home row says how it is doing and matches searches', () {
    final h = HomeRow.fromJson({
      'id': 'h1',
      'name': 'Khan residence',
      'city': 'Lahore',
      'owner': 'Ayesha Khan',
      'status': 'attention',
      'statusLabel': 'Board offline',
      'tone': 'bad',
      'boardsOnline': 1,
      'boardsTotal': 3,
      'boardsInstalled': 2,
    });
    expect(h.badge, 'Board offline');
    expect(h.tone, Tone.bad);
    expect(h.boardsWaiting, 1);
    expect(h.matches('ayesha'), isTrue);
    expect(h.matches('lahore'), isTrue);
    expect(h.matches('karachi'), isFalse);
    expect(HomeRow.fromJson({'id': 'x', 'status': 'setup'}).badge, 'Installing');
    expect(HomeRow.fromJson({'id': 'x', 'status': 'live'}).badge, 'Live');
  });

  test('the staff view of a home: boards waiting, installed, the owner', () {
    final w = Workspace.fromJson({
      'home': {
        'id': 'h1',
        'name': 'Khan residence',
        'owner': {'id': 'o', 'name': 'Ayesha Khan', 'phone': '0321 4567890'},
        'installer': {'id': 'u1', 'name': 'Ravi'},
        'status': 'live',
        'tone': 'ok',
      },
      'stepsDone': 6,
      'boards': [
        {'id': 'b1', 'status': 'ASSIGNED', 'online': true},
        {'id': 'b2', 'status': 'ASSIGNED', 'online': false},
        {'id': 'b3', 'name': 'Hall', 'status': 'ADOPTED', 'online': true, 'cond': 'ok'},
        {'id': 'b4', 'name': 'Roof', 'status': 'FAULTY', 'cond': 'bad'},
      ],
      'currentFirmware': '2.7.0',
    });
    expect(w.readyToInstall.map((b) => b.id), ['b1']);
    expect(w.waitingForPower.map((b) => b.id), ['b2']);
    expect(w.installed.map((b) => b.id), ['b3', 'b4']);
    expect(w.installerId, 'u1');
    expect(whatsappDigits(w.owner!.phone), '923214567890');
  });

  test('phone numbers become WhatsApp digits like the API’s normalisePhone', () {
    expect(whatsappDigits('0300-1234567'), '923001234567');
    expect(whatsappDigits('+92 300 1234567'), '923001234567');
    expect(whatsappDigits('3001234567'), '923001234567');
    expect(whatsappDigits('0044 20 7946 0958'), '442079460958');
    expect(whatsappDigits('call me'), isNull);
    expect(whatsappDigits(null), isNull);
    expect(displayPhone('923001234567'), '+92 300 1234567');
  });

  test('a board: its condition, signal, settings and firmware', () {
    Map<String, Object?> j({bool online = true, int rssi = -60, int vcc = 3300, String? err, int applied = 3}) => {
      'id': 'esp-1',
      'name': 'Hall',
      'online': online,
      'configRev': 3,
      'appliedRev': applied,
      'configError': err,
      'health': {'rssi': rssi, 'vcc': vcc, 'heap': 30000, 'connects': 1},
      'devices': [
        {
          'id': 'd',
          'name': 'Lamp',
          'type': 'switch',
          'pin': 5,
          'state': {'on': true},
        },
      ],
      'inputs': [
        {
          'id': 'i',
          'type': 'toggle_button',
          'pin': 13,
          'settings': {'gestures': true},
          'actions': {
            'double': {'type': 'scene', 'sceneId': 's1'},
            'long': {'type': 'allOff'},
            'bad': {'type': 'nope'},
          },
        },
      ],
    };
    expect(BoardCondition.of(BoardNode.fromJson(j())).label, 'Healthy');
    expect(BoardCondition.of(BoardNode.fromJson(j(online: false))).tone, Tone.bad);
    expect(BoardCondition.of(BoardNode.fromJson(j(err: 'pin 7'))).label, 'Settings refused');
    expect(BoardCondition.of(BoardNode.fromJson(j(applied: 2))).label, 'Saving settings');
    expect(BoardCondition.of(BoardNode.fromJson(j(vcc: 2900))).label, 'Low supply voltage');
    expect(BoardCondition.of(BoardNode.fromJson(j(rssi: -85))).label, 'Weak Wi-Fi');
    final n = BoardNode.fromJson(j());
    expect(n.sync, SettingsSync.saved);
    expect(signalOf(-60).bars, 3);
    expect(signalOf(null).text, '—');
    expect(n.inputs.single.actions.keys, ['double', 'long']);
    expect(n.inputs.single.actions['long']!.toJson(), {'type': 'allOff', 'roomId': null});
    expect(n.inputs.single.gestures, isTrue);
    expect(deviceNow(n.devices.single), 'On');
    final patched = n.copyWith(
      devices: [
        n.devices.single.withState({'on': false}),
      ],
    );
    expect(deviceNow(patched.devices.single), 'Off');
    expect(compareVersions('2.6.3-fake', '2.7.0'), lessThan(0));
    expect(compareVersions('2.10.0', '2.9.9'), greaterThan(0));
    expect(isBehind('2.6.3', '2.6.3'), isFalse);
    expect(isBehind(null, '2.7.0'), isFalse);
    expect(uptimeText(3725), '1 h 2 min');
  });

  test('what sensors say, in words', () {
    NodeDevice d(String type, Map<String, Object?> state, [Map<String, Object?> settings = const {}]) =>
        NodeDevice.fromJson({'id': 'x', 'name': 'X', 'type': type, 'pin': 1, 'state': state, 'settings': settings});
    expect(deviceNow(d('fan', {'on': true, 'speed': 2})), 'On · speed 2');
    expect(deviceNow(d('tank', {'level': 35, 'alarm': 'dry'})), '35% full · motor stopped: water not rising');
    expect(deviceNow(d('contact', {'active': false}, {'kind': 'mains'})), 'Grid off (on UPS)');
    expect(deviceNow(d('contact', {'active': true}, {'kind': 'door'})), 'Open');
    expect(deviceNow(d('dht', {'temperature': 31.46, 'humidity': 52})), '31.5°C · 52%');
    expect(deviceTypeText(d('contact', {}, {'kind': 'mains'})), 'Contact sensor · grid power');
  });

  test('tickets: state, priority, the team, and the most urgent first', () {
    final t = StaffTicket.fromJson({
      'id': 't1',
      'number': 7,
      'title': 'Fan',
      'status': 'IN_PROGRESS',
      'priority': 'URGENT',
      'overdue': true,
      'contact': {'name': 'Ayesha', 'whatsapp': '923214567890'},
      'staff': [
        {'id': 'u1', 'name': 'Ravi', 'staffRole': 'INSTALLER'},
      ],
      'messages': [
        {'id': 'm1', 'body': 'Hello', 'staff': false},
        {'id': 'm2', 'body': 'On it', 'staff': true},
        {'id': 'm3', 'body': 'note', 'staff': true, 'internal': true},
        {'id': 'm4', 'body': 'Status: Solved', 'event': true},
      ],
    });
    expect(t.state, TicketState.inProgress);
    expect(t.state.json, 'IN_PROGRESS');
    expect(t.priority, TicketPriority.urgent);
    expect(t.lastReply, 'On it');
    expect(t.team.single.role.label, 'Installer');
    StaffTicket row(String id, String status, String priority, {bool overdue = false}) => StaffTicket.fromJson({
      'id': id,
      'number': 1,
      'title': id,
      'status': status,
      'priority': priority,
      'overdue': overdue,
    });
    final sorted = sortTickets([
      row('solved', 'RESOLVED', 'URGENT'),
      row('low', 'OPEN', 'LOW'),
      row('high', 'OPEN', 'HIGH'),
      row('late', 'WAITING', 'NORMAL', overdue: true),
    ]);
    expect(sorted.map((t) => t.id), ['late', 'high', 'low', 'solved']);
  });

  test('office lists: stock, visit requests, quotes, outages', () {
    final inv = Inventory.fromJson({
      'boards': [
        {'id': 'a', 'status': 'STOCK', 'cond': 'mute'},
        {'id': 'b', 'status': 'ASSIGNED', 'homeId': 'h1', 'homeName': 'Khan'},
      ],
      'homes': [
        {'id': 'h1', 'name': 'Khan'},
      ],
      'stock': {'inStock': 1, 'min': 5, 'low': true},
    });
    expect(inv.inStock, 1);
    expect(inv.low, isTrue);
    expect(inv.homes.single.name, 'Khan');
    expect(VisitRequest.fromJson({'id': 'v', 'name': 'Bilal', 'status': 'NEW'}).tone, Tone.warn);
    final q = QuoteRow.fromJson({
      'id': 'q',
      'ref': 'Q-0007',
      'status': 'ACCEPTED',
      'total': 125000,
      'items': [
        {'name': 'Board', 'qty': 2, 'unit': 'each'},
      ],
    });
    expect(q.statusLabel, 'Accepted');
    expect(q.items.single.qty, '2');
    expect(rupees(125000), 'Rs 125,000');
    expect(rupees(950), 'Rs 950');
    final o = StaffOutages.fromJson({
      'homes': [
        {'homeId': 'h', 'home': 'Khan', 'power': 2, 'powerSeconds': 3700},
      ],
      'down': [
        {'board': 'Hall', 'home': 'Khan', 'homeId': 'h', 'since': '2026-10-19T00:00:00Z'},
      ],
    });
    expect(o.homes.single.power, 2);
    expect(o.down.single.since, isNotNull);
    expect(durationText(3700), '1 h 1 min');
    expect(durationText(45), '45 s');
  });

  test('the session keeps the staff role as the API writes it', () {
    final me = Me.fromJson({
      'id': 'u1',
      'name': 'Ravi Kumar',
      'email': 'r@x',
      'staff': {
        'role': 'INSTALLER',
        'org': {'name': 'Bright Homes'},
      },
      'homes': [],
    });
    expect(me.staff!.code, 'INSTALLER');
    expect(me.staff!.role, 'Installer');
    expect(me.staff!.orgName, 'Bright Homes');
  });
}

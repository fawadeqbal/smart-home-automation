import 'package:flutter_test/flutter_test.dart';
import 'package:switchboard_home/data/models/activity.dart';
import 'package:switchboard_home/data/models/automation.dart';
import 'package:switchboard_home/data/models/device.dart';
import 'package:switchboard_home/data/models/session.dart';

void main() {
  test('Me reads the API session (home, role, rooms shared with a member)', () {
    final me = Me.fromJson({
      'id': 'u1',
      'name': 'Zara Khan',
      'email': 'zara@example.com',
      'staff': null,
      'homes': [
        {'id': 'h1', 'name': 'Khan residence', 'city': 'Lahore', 'role': 'MEMBER'},
      ],
      'home': {
        'id': 'h1',
        'name': 'Khan residence',
        'city': 'Lahore',
        'timezone': 'Asia/Karachi',
        'role': 'MEMBER',
        'viaStaff': false,
        'readOnly': false,
        'onboarded': true,
      },
      'rooms': [
        {'roomId': 'r1', 'access': 'CONTROL'},
      ],
    });
    expect(me.firstName, 'Zara');
    expect(me.initials, 'ZK');
    expect(me.home!.role, HomeRole.member);
    expect(me.home!.manages, isFalse);
    expect(me.rooms['r1'], Access.control);
  });

  test('Device: on, and who may switch it', () {
    Device d(String access, {bool online = true, bool on = true}) => Device.fromJson({
      'id': 'd1',
      'key': 'fan',
      'name': 'Fan',
      'type': 'switch',
      'controllable': true,
      'online': online,
      'enabled': true,
      'state': {'on': on},
      'access': access,
      'roomId': 'r1',
      'roomName': 'Bedroom',
    });
    expect(d('CONTROL').isOn, isTrue);
    expect(d('CONTROL').canControl, isTrue);
    expect(d('VIEW').canControl, isFalse);
    expect(d('MANAGE', online: false).responding, isFalse);
    expect(d('MANAGE').copyWith(state: {'on': false}).isOn, isFalse);
  });

  test('a one-device "off in a while" schedule is that device’s timer', () {
    final s = Schedule.fromJson({
      'id': 's1',
      'name': 'Fan off · 30 min',
      'kind': 'ONCE',
      'enabled': true,
      'nextRunAt': DateTime.now().add(const Duration(minutes: 30)).toIso8601String(),
      'actions': [
        {'deviceId': 'd1', 'on': false, 'deviceName': 'Fan'},
      ],
    });
    expect(s.isTimerFor('d1'), isTrue);
    expect(s.isTimerFor('d2'), isFalse);
    expect(s.copyWith(enabled: false).isTimerFor('d1'), isFalse);
  });

  test('new schedules are sent the way the API expects', () {
    const a = [DeviceAction(deviceId: 'd1', on: true)];
    expect(const NewSchedule.inMinutes(30, a).toJson(), {
      'kind': 'ONCE',
      'inMinutes': 30,
      'actions': [
        {'deviceId': 'd1', 'on': true},
      ],
    });
    expect(const NewSchedule.daily('05:00', [1, 4], a, name: 'Geyser').toJson(), {
      'kind': 'DAILY',
      'name': 'Geyser',
      'time': '05:00',
      'days': [1, 4],
      'actions': [
        {'deviceId': 'd1', 'on': true},
      ],
    });
    final at = NewSchedule.at(DateTime.utc(2026, 10, 15, 17), a).toJson();
    expect(at['runAt'], '2026-10-15T17:00:00.000Z');
  });

  test('activity events say how the change happened', () {
    final e = ActivityEvent.fromJson({
      'id': '9',
      'at': '2026-10-15T10:00:00Z',
      'deviceId': 'd1',
      'deviceName': 'Fan',
      'deviceType': 'switch',
      'roomName': 'Bedroom',
      'state': {'on': false},
      'via': 'voice',
      'by': 'Zara',
    });
    expect(e.via, EventVia.voice);
    expect(e.on, isFalse);
    expect(ActivityEvent.fromJson({'via': 'something-new', 'state': <String, dynamic>{}}).via, EventVia.app);
  });
}

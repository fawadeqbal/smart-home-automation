import 'package:flutter_test/flutter_test.dart';
import 'package:switchboard_home/data/models/automation.dart';
import 'package:switchboard_home/data/models/device.dart';

void main() {
  test('a sunset schedule reads as words', () {
    final s = Schedule.fromJson({'id': 's1', 'name': 'Porch on', 'kind': 'SUN', 'sunEvent': 'SUNSET', 'offsetMin': -10, 'days': []});
    expect(s.kind, ScheduleKind.sun);
    expect(s.sunText, '10 min before sunset');
    expect(Schedule.fromJson({'kind': 'SUN', 'sunEvent': 'SUNRISE'}).sunText, 'at sunrise');
  });

  test('rules and away mode come from the server as they are', () {
    final r = Rule.fromJson({'id': 'r1', 'name': 'Gate at night', 'enabled': false, 'summary': 'When Gate opens: Porch on', 'createdById': 'u1'});
    expect(r.enabled, isFalse);
    expect(r.copyWith(enabled: true).enabled, isTrue);
    expect(r.summary, startsWith('When Gate opens'));

    final a = AwayState.fromJson({
      'on': true, 'by': 'Fawad', 'lights': ['d1'],
      'switches': [{'id': 'd1', 'name': 'Porch'}, {'id': 'd2', 'name': 'Fan'}],
    });
    expect(a.on, isTrue);
    expect(a.lights, ['Porch']);
    expect(const AwayState().loaded, isFalse);
  });

  test('child lock is read from the device', () {
    final d = Device.fromJson({'id': 'd1', 'key': 'k', 'name': 'Iron', 'type': 'switch', 'childLock': true});
    expect(d.childLock, isTrue);
    expect(d.copyWith(online: true).childLock, isTrue);
  });
}

import 'package:flutter_test/flutter_test.dart';
import 'package:switchboard_home/data/models/automation.dart';
import 'package:switchboard_home/data/models/device.dart';

void main() {
  test('a schedule says how its last run went', () {
    final s = Schedule.fromJson({
      'id': 's1', 'name': 'Geyser off', 'kind': 'ONCE', 'lastStatus': 'RETRYING',
      'lastResult': 'Not yet: Geyser is offline. Trying again at 07:03.',
      'problems': ['Geyser: waiting for a replacement board'],
    });
    expect(s.status, RunStatus.retrying);
    expect(s.problems.single, contains('replacement board'));
    expect(s.copyWith(enabled: false).status, RunStatus.retrying);
    // runs from before the status was kept: worked out from the words
    expect(Schedule.fromJson({'lastResult': 'Skipped: the server was down at 07:00.'}).status, RunStatus.skipped);
    expect(Schedule.fromJson({'lastResult': 'Done: Lamp on. Failed: Fan: offline'}).status, RunStatus.failed);
    expect(Schedule.fromJson({'lastResult': 'Done: Lamp on.'}).status, RunStatus.ok);
    expect(Schedule.fromJson({'id': 'x'}).status, isNull);
  });

  test('a device on a broken board waits for a replacement and does not respond', () {
    final d = Device.fromJson({'id': 'd1', 'key': 'lamp', 'name': 'Lamp', 'type': 'switch', 'online': false, 'waiting': true});
    expect(d.waiting, isTrue);
    expect(d.responding, isFalse);
    // a live "board online" update doesn't make it switchable while its board is out of service
    expect(d.copyWith(online: true).responding, isFalse);
    expect(DeviceAction.fromJson({'deviceId': 'd1', 'on': true, 'waiting': true}).waiting, isTrue);
  });
}

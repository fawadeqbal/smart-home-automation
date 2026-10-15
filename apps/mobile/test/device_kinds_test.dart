import 'package:flutter_test/flutter_test.dart';
import 'package:switchboard_home/core/theme/sb_icons.dart';
import 'package:switchboard_home/data/models/device.dart';
import 'package:switchboard_home/features/devices/device_kinds.dart';

Device dev(
  String name, {
  String type = 'switch',
  Map<String, dynamic> state = const {},
  List<String> aliases = const [],
  Map<String, dynamic> settings = const {},
}) => Device.fromJson({
  'id': name,
  'key': name,
  'name': name,
  'type': type,
  'controllable': type == 'switch',
  'online': true,
  'enabled': true,
  'state': state,
  'aliases': aliases,
  'settings': settings,
  'access': 'MANAGE',
  'roomName': 'Bedroom',
});

void main() {
  test('switches get their icon from their name or alias', () {
    expect(DeviceKinds.of(dev('Ceiling fan')).icon(dev('Ceiling fan')), SbIcons.fan);
    expect(DeviceKinds.of(dev('Bedroom AC')).icon(dev('Bedroom AC')), SbIcons.snowflake);
    expect(const SwitchKind().icon(dev('Bijli', aliases: ['pankha'])), SbIcons.fan);
    expect(const SwitchKind().icon(dev('Water motor')), SbIcons.zap);
    expect(const SwitchKind().icon(dev('Something')), SbIcons.lightbulb);
  });

  test('fans spin only while on', () {
    expect(const SwitchKind().spins(dev('Fan', state: {'on': true})), isTrue);
    expect(const SwitchKind().spins(dev('Fan', state: {'on': false})), isFalse);
    expect(const SwitchKind().spins(dev('Lamp', state: {'on': true})), isFalse);
  });

  test('sensors are shown, not switched', () {
    final climate = dev('Climate', type: 'dht', state: {'temperature': 26.6, 'humidity': 55.3});
    expect(DeviceKinds.of(climate), isA<ClimateKind>());
    expect(DeviceKinds.of(climate).toggleable, isFalse);
    expect(DeviceKinds.of(climate).status(climate), '26.6° · 55%');
    final leak = dev('Leak', type: 'contact', state: {'active': true}, settings: {'kind': 'leak'});
    expect(DeviceKinds.of(leak).status(leak), 'Water detected!');
    expect(DeviceKinds.of(leak).alarm(leak), isTrue);
    expect(DeviceKinds.of(dev('X', type: 'future-type')), isA<GenericKind>());
  });

  test('what you could say to the assistant', () {
    final p = const SwitchKind().phrases(dev('Fan', aliases: ['pankha']));
    expect(p.first, 'Bedroom fan on');
    expect(p, contains('Bedroom ka pankha band karo'));
    expect(p.length, lessThanOrEqualTo(4));
  });
}

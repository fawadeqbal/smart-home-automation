import 'package:flutter_test/flutter_test.dart';
import 'package:switchboard_home/data/models/work/board.dart';
import 'package:switchboard_home/data/models/work/pins.dart';

/// The ESP8266 dev board pins exactly as `packages/contracts/src/boards.ts` gives them in `/catalog`.
const _pins = [
  {
    'gpio': 5,
    'label': 'D1',
    'uses': ['output', 'input', 'sensor'],
    'note': 'Best choice for a relay',
  },
  {
    'gpio': 4,
    'label': 'D2',
    'uses': ['output', 'input', 'sensor'],
  },
  {
    'gpio': 14,
    'label': 'D5',
    'uses': ['output', 'input', 'sensor'],
  },
  {
    'gpio': 12,
    'label': 'D6',
    'uses': ['output', 'input', 'sensor'],
  },
  {
    'gpio': 13,
    'label': 'D7',
    'uses': ['output', 'input', 'sensor'],
  },
  {
    'gpio': 16,
    'label': 'D0',
    'uses': ['output'],
  },
  {
    'gpio': 15,
    'label': 'D8',
    'uses': ['output'],
  },
  {
    'gpio': 0,
    'label': 'D3',
    'uses': ['input'],
  },
  {
    'gpio': 2,
    'label': 'D4',
    'uses': ['output', 'input'],
  },
  {
    'gpio': 3,
    'label': 'RX',
    'uses': ['input', 'sensor'],
  },
  {
    'gpio': 17,
    'label': 'A0',
    'uses': ['analog'],
  },
];

final catalog = Catalog.fromJson({
  'boards': [
    for (final t in ['NODEMCU_V2', 'NODEMCU_V3', 'WEMOS_D1_MINI']) {'type': t, 'name': t, 'pins': _pins},
  ],
  'deviceTypes': [
    {'type': 'switch', 'label': 'Switch', 'pinUse': 'output', 'controllable': true, 'hasActiveLow': true},
    {'type': 'fan', 'label': 'Fan', 'pinUse': 'output', 'controllable': true, 'hasActiveLow': true},
    {'type': 'dht', 'label': 'DHT', 'pinUse': 'sensor', 'controllable': false},
    {'type': 'contact', 'label': 'Contact', 'pinUse': 'input', 'controllable': false, 'hasActiveLow': true},
    {'type': 'analog', 'label': 'Analog', 'pinUse': 'analog', 'controllable': false},
    {'type': 'tank', 'label': 'Tank', 'pinUse': 'output', 'controllable': false},
  ],
});

BoardNode board({
  List<Map<String, Object?>> devices = const [],
  List<Map<String, Object?>> inputs = const [],
  bool vcc = false,
}) => BoardNode.fromJson({
  'id': 'esp-1',
  'name': 'Hall',
  'board': 'NODEMCU_V3',
  'devices': devices,
  'inputs': inputs,
  'health': vcc ? {'vcc': 3300} : null,
});

List<String> labels(List<BoardPin> pins) => pins.map((p) => p.label).toList();

void main() {
  test('a fan uses its relay 2 and 3 pins, a tank its echo pin', () {
    final fan = NodeDevice.fromJson({
      'id': 'f',
      'name': 'Fan',
      'type': 'fan',
      'pin': 5,
      'settings': {
        'pins': [4, 14],
      },
    });
    final tank = NodeDevice.fromJson({
      'id': 't',
      'name': 'Tank',
      'type': 'tank',
      'pin': 15,
      'settings': {'echoPin': 3},
    });
    expect(devicePins(fan), [5, 4, 14]);
    expect(devicePins(tank), [15, 3]);
    expect(devicePins(NodeDevice.fromJson({'id': 's', 'name': 'S', 'type': 'switch', 'pin': 12})), [12]);
  });

  test('only safe pins for the use, never taken ones (extra pins and buttons too)', () {
    final node = board(
      devices: [
        {
          'id': 'f',
          'name': 'Fan',
          'type': 'fan',
          'pin': 5,
          'settings': {
            'pins': [4, 14],
          },
        },
      ],
      inputs: [
        {'id': 'b', 'type': 'wall_switch', 'pin': 13},
      ],
    );
    // relays: no D3 (input only), no RX, no A0, none of the fan's three pins, not the button's D7
    expect(labels(freePins(catalog, node, 'output')), ['D6', 'D0', 'D8', 'D4']);
    expect(labels(freePins(catalog, node, 'input')), ['D6', 'D3', 'D4', 'RX']);
    expect(labels(freePins(catalog, node, 'sensor')), ['D6', 'RX']);
    expect(labels(freePins(catalog, node, 'analog')), ['A0']);
    // the device being changed keeps its own pins
    expect(labels(freePins(catalog, node, 'output', keep: [5, 4, 14])), ['D1', 'D2', 'D5', 'D6', 'D0', 'D8', 'D4']);
  });

  test('A0 is not offered while the board measures its supply voltage on it', () {
    expect(freePins(catalog, board(vcc: true), 'analog'), isEmpty);
    expect(labels(freePins(catalog, board(), 'analog')), ['A0']);
    expect(pinStats(board(vcc: true), catalog), (used: 0, free: 10));
  });

  test('a fan’s three relays are three different pins; picking relay 1 moves the others on', () {
    final node = board();
    var c = deviceChoices(catalog, node, 'fan');
    final r1 = pickPin(c.main, -1);
    c = deviceChoices(catalog, node, 'fan', main: r1);
    final r2 = pickPin(c.second, -1);
    c = deviceChoices(catalog, node, 'fan', main: r1, second: r2);
    final r3 = pickPin(c.third, -1);
    expect({r1, r2, r3}.length, 3);
    expect(c.second.any((p) => p.gpio == r1), isFalse);
    expect(c.third.any((p) => p.gpio == r1 || p.gpio == r2), isFalse);
    // relay 1 moved onto relay 2's pin: relay 2 is moved to the next free one
    c = deviceChoices(catalog, node, 'fan', main: r2);
    expect(pickPin(c.second, r2), isNot(r2));
    expect(pinsNeeded('fan'), 3);
  });

  test('a tank’s echo is an input pin other than its trigger', () {
    final c = deviceChoices(catalog, board(), 'tank', main: 15);
    expect(c.main.every((p) => p.uses.contains('output')), isTrue);
    expect(labels(c.second), ['D1', 'D2', 'D5', 'D6', 'D7', 'D3', 'D4', 'RX']);
    final c2 = deviceChoices(catalog, board(), 'tank', main: 5);
    expect(c2.second.any((p) => p.gpio == 5), isFalse);
    expect(c.third, isEmpty);
  });

  test('a contact gets input pins, a temperature sensor sensor pins', () {
    expect(labels(deviceChoices(catalog, board(), 'contact').main), ['D1', 'D2', 'D5', 'D6', 'D7', 'D3', 'D4', 'RX']);
    expect(labels(deviceChoices(catalog, board(), 'dht').main), ['D1', 'D2', 'D5', 'D6', 'D7', 'RX']);
  });

  test('pickPin keeps a valid pick and otherwise takes the first free pin', () {
    final pins = freePins(catalog, board(), 'output');
    expect(pickPin(pins, 12), 12);
    expect(pickPin(pins, 3), 5); // RX can't drive a relay
    expect(pickPin(const [], 5), -1);
  });

  test('the pin map shows what is on each header pin', () {
    final node = board(
      vcc: true,
      devices: [
        {
          'id': 'f',
          'name': 'Fan',
          'type': 'fan',
          'pin': 5,
          'settings': {
            'pins': [4, 14],
          },
        },
        {
          'id': 't',
          'name': 'Tank',
          'type': 'tank',
          'pin': 15,
          'settings': {'echoPin': 3},
        },
      ],
      inputs: [
        {'id': 'b', 'type': 'wall_switch', 'pin': 13, 'targetName': 'Fan'},
      ],
    );
    final map = pinMap(node, catalog);
    HeaderPin pin(String label) => [...map.left, ...map.right].firstWhere((p) => p.label == label);
    expect(pin('D1').kind, PinKind.used);
    expect(pin('D1').what, 'Fan');
    expect(pin('D2').what, 'Fan · relay 2');
    expect(pin('D5').what, 'Fan · relay 3');
    expect(pin('RX').what, 'Tank · echo');
    expect(pin('D7').what, 'Wall switch → Fan');
    expect(pin('D7').isButton, isTrue);
    expect(pin('D6').kind, PinKind.free);
    expect(pin('A0').kind, PinKind.reserved); // measuring the supply
    expect(pin('TX').kind, PinKind.reserved);
    expect(pin('S1').kind, PinKind.reserved); // flash chip
    expect(pin('VIN').kind, PinKind.power);
    expect(map.left.length, 15);
    expect(map.right.length, 15);
    expect(pinLabel(catalog, 'NODEMCU_V3', 14), 'D5');
    expect(pinName(catalog, 'NODEMCU_V3', 99), 'GPIO 99');
  });
}

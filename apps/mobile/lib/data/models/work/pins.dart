/// Which pins a device or a wall button may go on — the same rules as the web console's DeviceForm and
/// `packages/contracts/src/boards.ts` (the API checks again, and so does the board):
///
/// * only the pins the board model offers, and only for a use they allow (`output` for relays and a
///   tank's TRIG, `input` for contacts, buttons and a tank's ECHO, `sensor`, `analog`);
/// * never a pin that's already taken — by a device's main pin, its extra pins (a fan's relays 2 and 3,
///   a tank's ECHO) or a wall button — except the pins of the device being changed;
/// * never A0 while the board measures its own supply voltage on it;
/// * within one device, each of its pins is different (relay 1, 2 and 3 of a fan; TRIG and ECHO).
library;

import 'package:flutter/foundation.dart';

import 'board.dart';
import 'num.dart';

/// The analog pin (A0) is GPIO 17 in the contracts.
const analogPin = 17;

/// Every pin a device uses: its main pin, then a fan's relays 2 and 3 or a tank's ECHO.
List<int> devicePins(NodeDevice d) => [d.pin, ...extraPins(d.type, d.settings)];

List<int> extraPins(String type, Map<String, dynamic> settings) {
  if (type == 'fan' && settings['pins'] is List) {
    return [for (final p in settings['pins'] as List) ?intOrNull(p)];
  }
  if (type == 'tank') {
    final echo = intOrNull(settings['echoPin']);
    if (echo != null) return [echo];
  }
  return const [];
}

/// Pins already in use on the board (devices, their extra pins, wall buttons; A0 while it measures
/// the supply voltage), leaving out [keep] — the pins of the device or button being changed.
Set<int> takenPins(BoardNode node, {Iterable<int> keep = const []}) {
  final taken = {for (final d in node.devices) ...devicePins(d), for (final i in node.inputs) i.pin};
  taken.removeAll(keep);
  if (node.health?.vcc != null) taken.add(analogPin);
  return taken;
}

/// The pins of this board that suit [use] and are free. [keep]: pins of the device being changed
/// (still allowed); [exclude]: pins this same form already uses for another of the device's wires.
List<BoardPin> freePins(
  Catalog catalog,
  BoardNode node,
  String use, {
  Iterable<int> keep = const [],
  Iterable<int> exclude = const [],
}) {
  final model = catalog.board(node.board);
  if (model == null) return const [];
  final taken = takenPins(node, keep: keep)..addAll(exclude);
  return model.pins.where((p) => p.uses.contains(use) && !taken.contains(p.gpio)).toList();
}

/// How many pins a device of this type needs: 3 for a fan (relays 1–3), 2 for a tank (TRIG, ECHO).
int pinsNeeded(String type) => switch (type) {
  'fan' => 3,
  'tank' => 2,
  _ => 1,
};

/// Pin choices for each wire of a device of [type], while the form has picked [main] and [second]
/// (-1: none yet). Main = relay 1, a tank's TRIG, or the only pin; second = a fan's relay 2 or a tank's
/// ECHO; third = a fan's relay 3. Each wire leaves out the pins of the wires before it, so one pin can't
/// be used twice (picking relay 1 on relay 2's pin moves relay 2 to the next free pin).
({List<BoardPin> main, List<BoardPin> second, List<BoardPin> third}) deviceChoices(
  Catalog catalog,
  BoardNode node,
  String type, {
  NodeDevice? editing,
  int main = -1,
  int second = -1,
}) {
  final def = catalog.type(type);
  final keep = editing == null ? const <int>[] : devicePins(editing);
  final use = def?.pinUse ?? 'output';
  List<int> not(List<int> pins) => pins.where((p) => p >= 0).toList();
  return (
    main: freePins(catalog, node, use, keep: keep),
    second: type == 'fan'
        ? freePins(catalog, node, 'output', keep: keep, exclude: not([main]))
        : type == 'tank'
        ? freePins(catalog, node, 'input', keep: keep, exclude: not([main]))
        : const [],
    third: type == 'fan' ? freePins(catalog, node, 'output', keep: keep, exclude: not([main, second])) : const [],
  );
}

/// Picks a pin from [choices]: [wanted] when it's still there, else the first one (-1: none).
int pickPin(List<BoardPin> choices, int wanted) =>
    choices.any((p) => p.gpio == wanted) ? wanted : (choices.isEmpty ? -1 : choices.first.gpio);

/// How many usable pins are taken and free on this board.
({int used, int free}) pinStats(BoardNode node, Catalog catalog) {
  final allowed = catalog.board(node.board)?.pins ?? const <BoardPin>[];
  final taken = {for (final d in node.devices) ...devicePins(d), for (final i in node.inputs) i.pin};
  final usable = allowed.where((p) => !(p.gpio == analogPin && node.health?.vcc != null)).toList();
  final used = usable.where((p) => taken.contains(p.gpio)).length;
  return (used: used, free: usable.length - used);
}

/// "D1 (GPIO 5)".
String pinName(Catalog catalog, String board, int gpio) {
  final p = catalog.board(board)?.pins.where((x) => x.gpio == gpio).firstOrNull;
  return p == null ? 'GPIO $gpio' : '${p.label} (GPIO $gpio)';
}

String pinLabel(Catalog catalog, String board, int gpio) =>
    catalog.board(board)?.pins.where((x) => x.gpio == gpio).firstOrNull?.label ?? 'GPIO $gpio';

// ---------------------------------------------------------------- the pin map

/// What a header pin of the board is: power, reserved (don't use), free, or used by something.
enum PinKind { power, reserved, free, used }

@immutable
class HeaderPin {
  const HeaderPin({
    required this.label,
    required this.kind,
    this.gpio,
    this.what = '',
    this.why = '',
    this.uses = const [],
    this.isSensor = false,
    this.isButton = false,
  });

  final String label;
  final PinKind kind;
  final int? gpio;

  /// What uses it ("Ceiling fan · relay 2", "Wall switch → Ceiling light").
  final String what;

  /// Why it's reserved, or what the power pin gives.
  final String why;
  final List<String> uses;
  final bool isSensor, isButton;

  /// One line about the pin, for its sheet.
  String get explain => switch (kind) {
    PinKind.power => why,
    PinKind.reserved => why,
    PinKind.free => 'Free — can be used as ${uses.map(_useWord).join(', ')}${why.isEmpty ? '' : '. $why'}',
    PinKind.used => what,
  };
}

String _useWord(String use) => switch (use) {
  'output' => 'a relay (output)',
  'input' => 'a button or contact (input)',
  'sensor' => 'a sensor',
  'analog' => 'an analog sensor',
  _ => use,
};

/// The two rows of header pins of each board model, antenna at the top (as printed on the PCB).
const boardLayouts = <String, ({List<String> left, List<String> right, String chip, String usb})>{
  'NODEMCU_V3': (
    left: ['A0', 'G', 'VU', 'S3', 'S2', 'S1', 'SC', 'S0', 'SK', 'G', '3V', 'EN', 'RST', 'G', 'VIN'],
    right: ['D0', 'D1', 'D2', 'D3', 'D4', '3V', 'G', 'D5', 'D6', 'D7', 'D8', 'RX', 'TX', 'G', '3V'],
    chip: 'ESP-12E',
    usb: 'micro-USB',
  ),
  'NODEMCU_V2': (
    left: ['A0', 'RSV', 'RSV', 'SD3', 'SD2', 'SD1', 'CMD', 'SD0', 'CLK', 'GND', '3V3', 'EN', 'RST', 'GND', 'VIN'],
    right: ['D0', 'D1', 'D2', 'D3', 'D4', '3V3', 'GND', 'D5', 'D6', 'D7', 'D8', 'RX', 'TX', 'GND', '3V3'],
    chip: 'ESP-12E',
    usb: 'micro-USB',
  ),
  'WEMOS_D1_MINI': (
    left: ['RST', 'A0', 'D0', 'D5', 'D6', 'D7', 'D8', '3V3'],
    right: ['TX', 'RX', 'D1', 'D2', 'D3', 'D4', 'GND', '5V'],
    chip: 'ESP-8266EX',
    usb: 'USB',
  ),
};

const _gpioOf = {
  'A0': 17,
  'D0': 16,
  'D1': 5,
  'D2': 4,
  'D3': 0,
  'D4': 2,
  'D5': 14,
  'D6': 12,
  'D7': 13,
  'D8': 15,
  'RX': 3,
  'TX': 1,
};
const _powerWhy = {
  'G': 'Ground (0 V)',
  'GND': 'Ground (0 V)',
  '3V': '3.3 V out — power for sensors',
  '3V3': '3.3 V out — power for sensors',
  'VU': '5 V from USB — power for relay modules',
  'VIN': '5 V in/out — power for relay modules',
  '5V': '5 V — power for relay modules',
};
const _reservedWhy = {
  'TX': 'Serial (logs and flashing) — don’t use',
  'RSV': 'Not connected',
  'EN': 'Enable — don’t use',
  'RST': 'Reset — don’t use',
};

/// Every header pin of the board, with what is on it.
({List<HeaderPin> left, List<HeaderPin> right, String chip, String usb}) pinMap(BoardNode node, Catalog catalog) {
  final layout = boardLayouts[node.board] ?? boardLayouts['NODEMCU_V2']!;
  final allowed = catalog.board(node.board)?.pins ?? const <BoardPin>[];
  HeaderPin info(String label) {
    if (_powerWhy.containsKey(label)) return HeaderPin(label: label, kind: PinKind.power, why: _powerWhy[label]!);
    final gpio = _gpioOf[label];
    if (gpio == null) {
      return HeaderPin(label: label, kind: PinKind.reserved, why: _reservedWhy[label] ?? 'Flash chip — never use');
    }
    for (final d in node.devices) {
      final pins = devicePins(d);
      if (!pins.contains(gpio)) continue;
      final part = gpio == d.pin
          ? ''
          : d.type == 'tank'
          ? ' · echo'
          : ' · relay ${pins.indexOf(gpio) + 1}';
      final sensor = !(catalog.type(d.type)?.controllable ?? d.type == 'switch');
      return HeaderPin(label: label, kind: PinKind.used, gpio: gpio, what: '${d.name}$part', isSensor: sensor);
    }
    for (final i in node.inputs) {
      if (i.pin != gpio) continue;
      final to = i.targetName != null
          ? ' → ${i.targetName}'
          : i.name.isNotEmpty
          ? ' · ${i.name}'
          : '';
      return HeaderPin(
        label: label,
        kind: PinKind.used,
        gpio: gpio,
        what: '${i.isWallSwitch ? 'Wall switch' : 'Button'}$to',
        isButton: true,
      );
    }
    if (gpio == analogPin && node.health?.vcc != null) {
      return HeaderPin(label: label, kind: PinKind.reserved, gpio: gpio, why: 'Measuring the board’s supply voltage');
    }
    final pin = allowed.where((p) => p.gpio == gpio).firstOrNull;
    if (pin != null) {
      return HeaderPin(label: label, kind: PinKind.free, gpio: gpio, uses: pin.uses, why: pin.note ?? '');
    }
    return HeaderPin(label: label, kind: PinKind.reserved, gpio: gpio, why: _reservedWhy[label] ?? 'Not offered');
  }

  return (
    left: layout.left.map(info).toList(),
    right: layout.right.map(info).toList(),
    chip: layout.chip,
    usb: layout.usb,
  );
}

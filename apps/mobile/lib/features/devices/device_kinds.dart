import '../../core/theme/sb_icons.dart';
import '../../data/models/device.dart';

/// How the app shows one kind of device: its icon, what its tile says, whether a tap switches it,
/// and what you could say to the assistant about it.
///
/// To support a new device type from the API, add a [DeviceKind] to [DeviceKinds.registry] —
/// tiles, sheets, rooms and the assistant suggestions pick it up.
abstract class DeviceKind {
  const DeviceKind();

  bool matches(Device d);

  SbIconData icon(Device d);

  /// A tap switches it on or off.
  bool get toggleable => false;

  /// Shown highlighted (on, or a sensor that's triggered).
  bool active(Device d) => false;

  /// Something needs attention (a leak, a door open at night).
  bool alarm(Device d) => false;

  /// The icon turns while it's on (fans).
  bool spins(Device d) => false;

  /// Short status for its tile: "On", "26.6° · 55%", "Closed".
  String status(Device d);

  /// Example phrases for the assistant.
  List<String> phrases(Device d) => const [];
}

/// Switches: lights, fans, ACs, sockets, motors, geysers — told apart by their names and aliases.
class SwitchKind extends DeviceKind {
  const SwitchKind();

  static final _rules = <(RegExp, SbIconData, String?)>[
    (
      RegExp(r'\b(fan|pankha|exhaust|ceiling fan)\b', caseSensitive: false),
      SbIcons.fan,
      'pankha',
    ),
    (
      RegExp(r'\b(ac|a\.c\.|air ?con|aircon|cooler)\b', caseSensitive: false),
      SbIcons.snowflake,
      'AC',
    ),
    (
      RegExp(r'\b(tv|television|led tv|screen)\b', caseSensitive: false),
      SbIcons.monitor,
      'TV',
    ),
    (
      RegExp(r'\b(geyser|heater|water heater|boiler)\b', caseSensitive: false),
      SbIcons.droplet,
      'geyser',
    ),
    (
      RegExp(r'\b(motor|pump|tank)\b', caseSensitive: false),
      SbIcons.zap,
      'motor',
    ),
    (
      RegExp(r'\b(socket|plug|charger|outlet|iron)\b', caseSensitive: false),
      SbIcons.plug,
      null,
    ),
    (
      RegExp(
        r'\b(light|bulb|lamp|batti|tube ?light|led|chandelier|spot)\b',
        caseSensitive: false,
      ),
      SbIcons.lightbulb,
      'batti',
    ),
  ];

  static (SbIconData, String?) _look(Device d) {
    final text = '${d.name} ${d.aliases.join(' ')}';
    for (final (re, icon, urdu) in _rules) {
      if (re.hasMatch(text)) return (icon, urdu);
    }
    return (SbIcons.lightbulb, null);
  }

  @override
  bool matches(Device d) => d.type == 'switch' || d.controllable;

  @override
  bool get toggleable => true;

  @override
  SbIconData icon(Device d) => _look(d).$1;

  @override
  bool active(Device d) => d.isOn;

  @override
  bool spins(Device d) => d.isOn && _look(d).$1 == SbIcons.fan;

  @override
  String status(Device d) => d.isOn ? 'On' : 'Off';

  @override
  List<String> phrases(Device d) {
    final room = d.roomName;
    final name = d.name.toLowerCase();
    final inRoom = room != null && !name.contains(room.toLowerCase()) ? '${room.toLowerCase()} $name' : name;
    final out = <String>['${_cap(inRoom)} on', '${_cap(name)} off'];
    for (final a in d.aliases.take(2)) {
      out.add('${_cap(a)} on');
    }
    final urdu = _look(d).$2;
    if (urdu == 'pankha') {
      out.add(
        room != null ? '${room.split(' ').first} ka pankha band karo' : 'Pankha band karo',
      );
    }
    if (urdu == 'batti') {
      out.add(
        room != null ? '${room.split(' ').first} ki batti jala do' : 'Batti jala do',
      );
    }
    if (urdu == 'motor') out.add('Motor chala do');
    if (urdu == 'geyser') out.add('Geyser on karo');
    return out.toSet().take(4).toList();
  }
}

/// A ceiling fan on a speed regulator: tap for on/off, choose a speed in its sheet.
class FanKind extends DeviceKind {
  const FanKind();

  @override
  bool matches(Device d) => d.type == 'fan';

  @override
  bool get toggleable => true;

  @override
  SbIconData icon(Device d) => SbIcons.fan;

  @override
  bool active(Device d) => d.isOn;

  @override
  bool spins(Device d) => d.isOn;

  @override
  String status(Device d) => d.isOn ? (d.speed != null ? 'Speed ${d.speed}' : 'On') : 'Off';

  @override
  List<String> phrases(Device d) => [
    '${_cap(d.name.toLowerCase())} on',
    '${_cap(d.name.toLowerCase())} speed 2',
    d.roomName != null ? '${d.roomName!.split(' ').first} ka pankha tez karo' : 'Pankha tez karo',
  ];
}

/// A water tank's level (ultrasonic sensor), and an alarm when its motor was stopped.
class TankKind extends DeviceKind {
  const TankKind();

  static const _alarms = {
    'dry': 'Motor stopped: water not rising',
    'long': 'Motor stopped: ran too long',
    'sensor': 'Motor stopped: no sensor reading',
  };

  @override
  bool matches(Device d) => d.type == 'tank';

  @override
  SbIconData icon(Device d) => SbIcons.droplet;

  @override
  bool active(Device d) => d.state['level'] is num && (d.state['level'] as num) >= 90;

  @override
  bool alarm(Device d) => _alarms.containsKey('${d.state['alarm'] ?? ''}');

  @override
  String status(Device d) {
    final v = d.state['level'];
    final a = _alarms['${d.state['alarm'] ?? ''}'];
    if (v is! num) return 'No reading yet';
    return a != null ? '${v.round()}% · $a' : '${v.round()}% full';
  }

  @override
  List<String> phrases(Device d) => ['How full is the tank?', 'Tanki mein kitna pani hai?'];
}

/// Temperature and humidity.
class ClimateKind extends DeviceKind {
  const ClimateKind();

  @override
  bool matches(Device d) => d.type == 'dht';

  @override
  SbIconData icon(Device d) => SbIcons.thermometer;

  @override
  bool alarm(Device d) {
    final t = d.state['temperature'];
    return t is num && (t > 40 || t < 5);
  }

  @override
  String status(Device d) {
    final t = d.state['temperature'], h = d.state['humidity'];
    if (t is! num) return 'No reading yet';
    return h is num ? '${t.toStringAsFixed(1)}° · ${h.round()}%' : '${t.toStringAsFixed(1)}°';
  }

  @override
  List<String> phrases(Device d) => [
    '${d.roomName ?? 'Room'} temperature?',
    'Kitna garam hai?',
  ];
}

/// Door/window contacts, motion and water-leak sensors.
class ContactKind extends DeviceKind {
  const ContactKind();

  String _kind(Device d) => '${d.settings['kind'] ?? 'door'}';

  @override
  bool matches(Device d) => d.type == 'contact';

  @override
  SbIconData icon(Device d) => switch (_kind(d)) {
    'leak' => SbIcons.waves,
    'mains' => SbIcons.zap,
    'motion' => SbIcons.person,
    _ => SbIcons.door,
  };

  @override
  bool active(Device d) => d.state['active'] == true;

  @override
  bool alarm(Device d) => _kind(d) == 'leak' && active(d);

  @override
  String status(Device d) {
    final on = d.state['active'] == true;
    return switch (_kind(d)) {
      'leak' => on ? 'Water detected!' : 'Dry',
      // a mains-sense sensor is active while the grid is on
      'mains' => on ? 'Grid on' : 'On UPS',
      'motion' => on ? 'Movement' : 'Still',
      'window' => on ? 'Open' : 'Closed',
      'door' => on ? 'Open' : 'Closed',
      _ => on ? 'Active' : 'Quiet',
    };
  }
}

/// Light level, gas, soil moisture, water level (0–100%).
class AnalogKind extends DeviceKind {
  const AnalogKind();

  @override
  bool matches(Device d) => d.type == 'analog';

  @override
  SbIconData icon(Device d) => switch ('${d.settings['kind'] ?? ''}') {
    'water' || 'moisture' => SbIcons.droplet,
    'light' => SbIcons.sun,
    _ => SbIcons.pulse,
  };

  @override
  String status(Device d) {
    final v = d.state['level'];
    return v is num ? '${v.round()}%' : 'No reading yet';
  }
}

/// Anything the app doesn't know yet: shown, never switched.
class GenericKind extends DeviceKind {
  const GenericKind();

  @override
  bool matches(Device d) => true;

  @override
  SbIconData icon(Device d) => SbIcons.toggle;

  @override
  String status(Device d) => d.state.isEmpty ? '—' : d.state.entries.map((e) => '${e.value}').join(' · ');
}

abstract final class DeviceKinds {
  static const List<DeviceKind> registry = [
    FanKind(),
    TankKind(),
    ClimateKind(),
    ContactKind(),
    AnalogKind(),
    SwitchKind(),
  ];

  static DeviceKind of(Device d) => registry.firstWhere(
    (k) => k.matches(d),
    orElse: () => const GenericKind(),
  );
}

String _cap(String s) => s.isEmpty ? s : s[0].toUpperCase() + s.substring(1);

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme/app_theme.dart';
import '../../core/theme/sb_colors.dart';
import '../../core/theme/sb_icons.dart';
import '../../core/util/format.dart';
import '../../data/models/device.dart';
import '../../data/models/json.dart';
import '../../data/models/work/board.dart';
import '../../data/models/work/num.dart';
import '../../data/models/work/pins.dart';
import '../../data/repositories/work_repository.dart';
import '../../shared/widgets/common.dart';
import '../../shared/widgets/sb_switch.dart';
import '../../shared/widgets/segmented.dart';
import '../../shared/widgets/sheet.dart';
import '../../state/toast.dart';
import '../../state/work.dart';
import 'board_screen.dart';
import 'pin_map.dart';
import 'work_icons.dart';
import 'work_widgets.dart';

/// What's wired to a board: its devices and its wall switches and buttons — add, change, remove.
class BoardDevices extends ConsumerWidget {
  const BoardDevices({
    super.key,
    required this.homeId,
    required this.node,
    required this.catalog,
    required this.canSetup,
  });
  final String homeId;
  final BoardNode node;
  final Catalog catalog;
  final bool canSetup;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.sb;
    final rooms = ref.watch(workRoomsProvider(homeId)).value ?? const <Room>[];
    String roomName(String? id) => rooms.where((r) => r.id == id).firstOrNull?.name ?? 'No room';

    Future<void> remove({required String title, required String body, required Future<void> Function() run}) async {
      if (!await confirmSheet(context, title: title, body: body, yes: 'Remove')) return;
      try {
        await run();
        ref.read(toastProvider.notifier).show('Removed — the board frees the pin in a second');
        refreshBoards(ref, homeId);
      } catch (e) {
        toastError(ref, e);
      }
    }

    final repo = ref.read(workRepositoryProvider);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (node.configError != null) ...[
          Note(
            tone: NoteTone.bad,
            icon: SbIcons.warning,
            child: Text('The board refused its settings: ${node.configError}'),
          ),
          const SizedBox(height: 12),
        ],
        Row(
          children: [
            Expanded(
              child: Text('Devices', style: SbText.section.copyWith(color: c.tx)),
            ),
            _SyncChip(node: node),
          ],
        ),
        const SizedBox(height: 10),
        if (node.devices.isEmpty)
          EmptyView(
            icon: SbIcons.lightbulb,
            title: 'No devices yet',
            text: canSetup ? 'Add the first light, fan, socket or sensor wired to this board.' : null,
          )
        else
          for (final d in node.devices)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: _DeviceCard(
                device: d,
                node: node,
                catalog: catalog,
                room: roomName(d.roomId),
                canSetup: canSetup,
                onEdit: () => showDeviceForm(context, homeId: homeId, node: node, catalog: catalog, editing: d),
                onRemove: () => remove(
                  title: 'Remove ${d.name}?',
                  body:
                      'It disappears from the app and the board frees ${devicePins(d).map((p) => pinLabel(catalog, node.board, p)).join(', ')}.'
                      '${node.inputs.any((i) => i.targetId == d.id) ? ' Wall switches that toggle it are removed too.' : ''}',
                  run: () => repo.removeDevice(homeId, d.id),
                ),
              ),
            ),
        if (canSetup) ...[
          const SizedBox(height: 4),
          BigButton(
            label: 'Add a device',
            icon: SbIcons.plus,
            height: 50,
            onTap: () => showDeviceForm(context, homeId: homeId, node: node, catalog: catalog),
          ),
        ],
        const SizedBox(height: 22),
        Text('Wall switches and buttons', style: SbText.section.copyWith(color: c.tx)),
        const SizedBox(height: 10),
        if (node.inputs.isEmpty)
          const EmptyView(
            icon: WorkIcons.lightning,
            title: 'None yet',
            text: 'Wire an ordinary wall switch or a push-button between a pin and G: it toggles a light even when Wi-Fi is down, and a button’s double-press or long press can run a scene.',
          )
        else
          for (final i in node.inputs)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: _InputCard(
                input: i,
                pin: pinLabel(catalog, node.board, i.pin),
                canSetup: canSetup,
                onEdit: () => showInputForm(context, homeId: homeId, node: node, catalog: catalog, editing: i),
                onRemove: () => remove(
                  title: 'Remove this ${i.isWallSwitch ? 'wall switch' : 'button'}?',
                  body:
                      'The ${i.isWallSwitch ? 'wall switch' : 'button'} on ${pinLabel(catalog, node.board, i.pin)} stops working${i.targetName != null ? ' (it toggles ${i.targetName})' : ''}.',
                  run: () => repo.removeInput(homeId, i.id),
                ),
              ),
            ),
        if (canSetup) ...[
          const SizedBox(height: 4),
          BigButton(
            label: 'Add a wall switch or button',
            icon: SbIcons.plus,
            height: 50,
            color: c.sf2,
            foreground: c.tx,
            onTap: () => showInputForm(context, homeId: homeId, node: node, catalog: catalog),
          ),
        ],
      ],
    );
  }
}

class _SyncChip extends StatelessWidget {
  const _SyncChip({required this.node});
  final BoardNode node;

  @override
  Widget build(BuildContext context) => switch (node.sync) {
    SettingsSync.saved => const ToneBadge('Settings saved', Tone.ok, icon: SbIcons.check),
    SettingsSync.saving => ToneBadge(node.online ? 'Saving to board…' : 'Will update when online', Tone.warn),
    SettingsSync.refused => const ToneBadge('Settings refused', Tone.bad, icon: SbIcons.warning),
  };
}

class _DeviceCard extends StatelessWidget {
  const _DeviceCard({
    required this.device,
    required this.node,
    required this.catalog,
    required this.room,
    required this.canSetup,
    required this.onEdit,
    required this.onRemove,
  });
  final NodeDevice device;
  final BoardNode node;
  final Catalog catalog;
  final String room;
  final bool canSetup;
  final VoidCallback onEdit, onRemove;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final d = device;
    final pins = devicePins(d);
    final names = d.type == 'fan'
        ? [for (final (i, p) in pins.indexed) 'R${i + 1} ${pinLabel(catalog, node.board, p)}']
        : d.type == 'tank'
        ? [
            'TRIG ${pinLabel(catalog, node.board, pins.first)}',
            if (pins.length > 1) 'ECHO ${pinLabel(catalog, node.board, pins[1])}',
          ]
        : [pinLabel(catalog, node.board, d.pin)];
    return WorkCard(
      padding: const EdgeInsets.fromLTRB(14, 12, 6, 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(d.name, style: SbText.cardTitle.copyWith(fontSize: 15.5, color: c.tx)),
                const SizedBox(height: 2),
                Text(
                  '${deviceTypeText(d)}${d.aliases.isNotEmpty ? ' · also “${d.aliases.join('”, “')}”' : ''}',
                  style: TextStyle(fontSize: 13, color: c.mu, height: 1.3),
                ),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: [
                    for (final n in names) _MonoChip(n),
                    _MonoChip(room, mono: false),
                    _MonoChip(
                      node.online ? deviceNow(d, def: catalog.type(d.type)) : 'offline',
                      mono: false,
                      strong: true,
                    ),
                  ],
                ),
              ],
            ),
          ),
          if (canSetup) ...[
            IconButton(
              onPressed: onEdit,
              tooltip: 'Change ${d.name}',
              icon: SbIcon(WorkIcons.pencil, size: 19, color: c.tx),
            ),
            IconButton(
              onPressed: onRemove,
              tooltip: 'Remove ${d.name}',
              icon: SbIcon(WorkIcons.trash, size: 19, color: c.badText),
            ),
          ],
        ],
      ),
    );
  }
}

class _MonoChip extends StatelessWidget {
  const _MonoChip(this.text, {this.mono = true, this.strong = false});
  final String text;
  final bool mono, strong;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(color: strong ? c.onSoft : c.sf2, borderRadius: BorderRadius.circular(7)),
      child: Text(
        text,
        style: TextStyle(
          fontSize: 12,
          fontFamily: mono ? SbFonts.mono : null,
          fontWeight: FontWeight.w500,
          color: strong ? c.onText : c.tx,
        ),
      ),
    );
  }
}

const _gestureLabel = {'single': 'Press', 'double': 'Double-press', 'long': 'Long press', 'flip': 'Each flip'};

String _actionsText(BoardInput i) => i.actions.entries
    .map(
      (e) =>
          '${_gestureLabel[e.key] ?? e.key}: ${switch (e.value.kind) {
            'scene' => 'run a scene',
            'allOff' => e.value.id != null ? 'a room off' : 'everything off',
            _ => e.value.on == null ? 'toggle a switch' : 'a switch ${e.value.on! ? 'on' : 'off'}',
          }}',
    )
    .join(' · ');

class _InputCard extends StatelessWidget {
  const _InputCard({
    required this.input,
    required this.pin,
    required this.canSetup,
    required this.onEdit,
    required this.onRemove,
  });
  final BoardInput input;
  final String pin;
  final bool canSetup;
  final VoidCallback onEdit, onRemove;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final i = input;
    final also = _actionsText(i);
    return WorkCard(
      padding: const EdgeInsets.fromLTRB(14, 12, 6, 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(i.title, style: SbText.cardTitle.copyWith(fontSize: 15.5, color: c.tx)),
                const SizedBox(height: 2),
                Text(
                  '${i.kindLabel} on $pin${i.targetName != null ? ' → toggles ${i.targetName}' : ''}${i.lastEventAt != null ? ' · used ${Fmt.ago(i.lastEventAt!).toLowerCase()}' : ''}',
                  style: TextStyle(fontSize: 13, color: c.mu, height: 1.3),
                ),
                if (also.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Text(also, style: TextStyle(fontSize: 13, color: c.tx, height: 1.3)),
                  ),
              ],
            ),
          ),
          if (canSetup) ...[
            IconButton(
              onPressed: onEdit,
              tooltip: 'Change',
              icon: SbIcon(WorkIcons.pencil, size: 19, color: c.tx),
            ),
            IconButton(
              onPressed: onRemove,
              tooltip: 'Remove',
              icon: SbIcon(WorkIcons.trash, size: 19, color: c.badText),
            ),
          ],
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------- the device form

Future<void> showDeviceForm(
  BuildContext context, {
  required String homeId,
  required BoardNode node,
  required Catalog catalog,
  NodeDevice? editing,
}) => showSbSheet<void>(
  context,
  builder: (_) => DeviceForm(homeId: homeId, node: node, catalog: catalog, editing: editing),
);

/// Add or change a device on a board: name, type, the pin(s) it's wired to (only safe, free pins for
/// that use), room, the relay type, what it does after a power cut, its settings, other names for voice.
class DeviceForm extends ConsumerStatefulWidget {
  const DeviceForm({super.key, required this.homeId, required this.node, required this.catalog, this.editing});
  final String homeId;
  final BoardNode node;
  final Catalog catalog;
  final NodeDevice? editing;

  @override
  ConsumerState<DeviceForm> createState() => _DeviceFormState();
}

class _DeviceFormState extends ConsumerState<DeviceForm> {
  late final NodeDevice? _d = widget.editing;
  late String _type = _d?.type ?? 'switch';
  late final _name = TextEditingController(text: _d?.name ?? '');
  late final _aliases = TextEditingController(text: _d?.aliases.join(', ') ?? '');
  late String _room = _d?.roomId ?? '';
  bool _roomPicked = false;
  late bool _activeLow = _d?.activeLow ?? true;
  late bool _restoreOff = _d?.restoreOff ?? false;
  late int _pin = _d?.pin ?? -1;
  late int _second = _d == null ? -1 : (devicePins(_d).length > 1 ? devicePins(_d)[1] : -1);
  late int _third = _d == null ? -1 : (devicePins(_d).length > 2 ? devicePins(_d)[2] : -1);
  late Json _s = {...?_d?.settings};
  final _num = <String, TextEditingController>{};
  bool _busy = false;
  String? _error;

  TextEditingController _n(String key, int fallback) =>
      _num.putIfAbsent(key, () => TextEditingController(text: '${intOrNull(_s[key]) ?? fallback}'));

  @override
  void dispose() {
    _name.dispose();
    _aliases.dispose();
    for (final c in _num.values) {
      c.dispose();
    }
    super.dispose();
  }

  DeviceTypeDef? get _def => widget.catalog.type(_type);

  static const _placeholder = {
    'dht': 'Room climate',
    'contact': 'Front door',
    'analog': 'Light level',
    'fan': 'Ceiling fan',
    'tank': 'Roof tank',
  };

  int? _int(String key) => int.tryParse(_num[key]?.text.trim() ?? '');

  Json _settings() => switch (_type) {
    'dht' => {'model': _s['model'] ?? 'dht22', 'intervalSec': _int('intervalSec') ?? 30},
    'contact' => {'kind': _s['kind'] ?? 'door'},
    'analog' => {
      'kind': _s['kind'] ?? 'light',
      'intervalSec': _int('intervalSec') ?? 10,
      'invert': _s['invert'] == true,
    },
    // keep a fan's own speed table when it has one
    'fan' => {
      'pins': [_second, _third],
      if (_s['speeds'] is List) 'speeds': _s['speeds'],
    },
    'tank' => {
      'echoPin': _second,
      'emptyCm': _int('emptyCm') ?? 150,
      'fullCm': _int('fullCm') ?? 25,
      'intervalSec': _int('intervalSec') ?? 30,
      'motorDeviceId': str(_s['motorDeviceId']),
      'fillBelowPct': _int('fillBelowPct') ?? 0,
      'stopAtPct': _int('stopAtPct') ?? 95,
      'dryRunMin': _int('dryRunMin') ?? 10,
      'maxRunMin': _int('maxRunMin') ?? 60,
    },
    _ => <String, dynamic>{},
  };

  String? _check() {
    if (_name.text.trim().isEmpty) return 'Give it a name people will say, like “${_placeholder[_type] ?? 'Bulb'}”.';
    if (_pin < 0) return 'Pick the pin it’s wired to.';
    if (pinsNeeded(_type) >= 2 && _second < 0) {
      return _type == 'fan' ? 'Pick the pin of relay 2.' : 'Pick the ECHO pin.';
    }
    if (pinsNeeded(_type) >= 3 && _third < 0) return 'Pick the pin of relay 3.';
    if (_type == 'tank') {
      final empty = _int('emptyCm') ?? 0, full = _int('fullCm') ?? 0;
      if (empty <= full + 10) return 'The empty distance must be at least 10 cm more than the full distance.';
    }
    return null;
  }

  Future<void> _save() async {
    final problem = _check();
    if (problem != null) return setState(() => _error = problem);
    setState(() {
      _busy = true;
      _error = null;
    });
    final repo = ref.read(workRepositoryProvider);
    final aliases = _aliases.text.split(',').map((a) => a.trim()).where((a) => a.isNotEmpty).toList();
    final room = _room.isEmpty ? null : _room;
    try {
      if (_d != null) {
        await repo.updateDevice(widget.homeId, _d.id, {
          'name': _name.text.trim(),
          'pin': _pin,
          'activeLow': _activeLow,
          'roomId': room,
          'aliases': aliases,
          'settings': _settings(),
          if (_def?.controllable ?? false) 'restoreOff': _restoreOff,
        });
      } else {
        await repo.addDevice(widget.homeId, widget.node.id, {
          'name': _name.text.trim(),
          'type': _type,
          'pin': _pin,
          'activeLow': (_def?.hasActiveLow ?? false) && _activeLow,
          'roomId': room,
          'aliases': aliases,
          'settings': _settings(),
          'restoreOff': (_def?.controllable ?? false) && _restoreOff,
        });
      }
      ref
          .read(toastProvider.notifier)
          .show(_d != null ? 'Saved — the board updates in a second' : 'Added — the board updates in a second');
      refreshBoards(ref, widget.homeId);
      if (mounted) Navigator.of(context).pop();
    } catch (e) {
      setState(() => _error = messageOf(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Widget _numberField(String key, int fallback, {String? suffix}) => TextField(
    controller: _n(key, fallback),
    keyboardType: TextInputType.number,
    inputFormatters: [FilteringTextInputFormatter.digitsOnly],
    decoration: InputDecoration(suffixText: suffix),
  );

  Widget _twoUp(Widget a, Widget b) => Row(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Expanded(child: a),
      const SizedBox(width: 10),
      Expanded(child: b),
    ],
  );

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final catalog = widget.catalog;
    final node = widget.node;
    final def = _def;
    // keep the picks valid (a type change, or a pin taken by an earlier wire), wire by wire
    final pin = pickPin(deviceChoices(catalog, node, _type, editing: _d).main, _pin);
    final second = pinsNeeded(_type) >= 2
        ? pickPin(deviceChoices(catalog, node, _type, editing: _d, main: pin).second, _second)
        : -1;
    final ch = deviceChoices(catalog, node, _type, editing: _d, main: pin, second: second);
    final third = pinsNeeded(_type) >= 3 ? pickPin(ch.third, _third) : -1;
    // the form saves what it shows
    _pin = pin;
    _second = second;
    _third = third;
    final rooms = ref.watch(workRoomsProvider(widget.homeId)).value ?? const <Room>[];
    // a new device goes in the first room unless another is picked (like the web console)
    if (_d == null && !_roomPicked && _room.isEmpty && rooms.isNotEmpty) _room = rooms.first.id;
    final motors = _type == 'tank'
        ? (ref.watch(workDevicesProvider(widget.homeId)).value ?? const <Device>[])
              .where((d) => d.controllable)
              .toList()
        : const <Device>[];
    final enough =
        ch.main.isNotEmpty &&
        (pinsNeeded(_type) < 2 || ch.second.isNotEmpty) &&
        (pinsNeeded(_type) < 3 || ch.third.isNotEmpty);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SheetTitle(
          _d != null ? 'Change ${_d.name}' : 'Add a device',
          subtitle: 'On ${node.name} · only safe, free pins are offered',
        ),
        const FieldLabel('Type'),
        PickField<String>(
          title: 'What is it?',
          value: _type,
          enabled: _d == null,
          options: [for (final t in catalog.deviceTypes) (t.type, t.label)],
          onChanged: (v) => setState(() {
            _type = v;
            _s = {};
            _activeLow = true;
          }),
        ),
        const FieldLabel('Name'),
        TextField(
          controller: _name,
          maxLength: 60,
          textCapitalization: TextCapitalization.sentences,
          decoration: InputDecoration(hintText: _placeholder[_type] ?? 'Bulb', counterText: ''),
        ),
        FieldLabel(
          _type == 'fan'
              ? 'Relay 1 (small capacitor) pin'
              : _type == 'tank'
              ? 'Sensor TRIG pin'
              : 'Pin it’s wired to',
          hint: 'The label printed next to the pin on the board (D1, D2…).',
        ),
        PinPicker(choices: ch.main, value: pin, onChanged: (v) => setState(() => _pin = v)),
        if (_type == 'fan') ...[
          const FieldLabel(
            'Relay 2 (bigger capacitor) pin',
            hint: 'The usual 3-relay regulator: relays 1 and 2 switch two capacitors (speeds 1, 2, and 3 with both), relay 3 bypasses them for full speed.',
          ),
          PinPicker(choices: ch.second, value: second, onChanged: (v) => setState(() => _second = v)),
          const FieldLabel('Relay 3 (full speed) pin'),
          PinPicker(choices: ch.third, value: third, onChanged: (v) => setState(() => _third = v)),
        ],
        if (_type == 'tank') ...[
          const FieldLabel(
            'Sensor ECHO pin',
            hint: 'The JSN-SR04T’s echo output is 5 V: connect it through a divider (e.g. 1 kΩ and 2 kΩ), never straight to the board.',
          ),
          PinPicker(choices: ch.second, value: second, onChanged: (v) => setState(() => _second = v)),
          _twoUp(
            Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const FieldLabel('Distance when empty'),
                _numberField('emptyCm', 150, suffix: 'cm'),
              ],
            ),
            Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const FieldLabel('Distance when full'),
                _numberField('fullCm', 25, suffix: 'cm'),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.only(top: 6, left: 2),
            child: Text(
              'From the sensor down to the water. The sensor can’t see closer than about 20 cm.',
              style: TextStyle(fontSize: 12.5, color: c.mu),
            ),
          ),
          const FieldLabel('Read every'),
          _numberField('intervalSec', 30, suffix: 'seconds'),
          const FieldLabel(
            'Water motor',
            hint: 'On this board, the board stops the motor by itself when the tank is full, even without internet.',
          ),
          PickField<String>(
            title: 'Water motor',
            value: str(_s['motorDeviceId']),
            options: [
              ('', 'No motor (just show the level)'),
              for (final m in motors)
                (
                  m.id,
                  '${m.name}${m.nodeId == node.id
                      ? ' (this board)'
                      : m.nodeName.isNotEmpty
                      ? ' (${m.nodeName})'
                      : ''}',
                ),
            ],
            onChanged: (v) => setState(() => _s = {..._s, 'motorDeviceId': v}),
          ),
          _twoUp(
            Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const FieldLabel('Start below', hint: '0 = never by itself'),
                _numberField('fillBelowPct', 0, suffix: '%'),
              ],
            ),
            Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const FieldLabel('Stop at', hint: '50–100'),
                _numberField('stopAtPct', 95, suffix: '%'),
              ],
            ),
          ),
          _twoUp(
            Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const FieldLabel('Stop if not rising', hint: 'A dry well or a closed valve'),
                _numberField('dryRunMin', 10, suffix: 'min'),
              ],
            ),
            Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const FieldLabel('Never run longer', hint: 'In any case'),
                _numberField('maxRunMin', 60, suffix: 'min'),
              ],
            ),
          ),
        ],
        if (_type == 'contact') ...[
          const FieldLabel('What it senses'),
          PickField<String>(
            title: 'What it senses',
            value: str(_s['kind'], 'door'),
            options: const [
              ('door', 'Door (open / closed)'),
              ('window', 'Window (open / closed)'),
              ('motion', 'Motion (PIR)'),
              ('leak', 'Water leak'),
              ('mains', 'Grid power (mains-sense module: UPS mode)'),
              ('generic', 'Other on/off contact'),
            ],
            onChanged: (v) => setState(() => _s = {..._s, 'kind': v}),
          ),
          if (str(_s['kind'], 'door') == 'mains')
            const Padding(
              padding: EdgeInsets.only(top: 10),
              child: Note(
                tone: NoteTone.warn,
                icon: SbIcons.warning,
                child: Text(
                  'An electrician wires a mains-sense module to a circuit fed only by the grid (not the UPS); the module’s low-voltage output goes to this pin. Never connect mains to the board. It reads “active” while the grid is on.',
                ),
              ),
            ),
          const FieldLabel('Active when'),
          Segmented<bool>(
            options: const [(true, 'Pin to GND'), (false, 'Pin goes HIGH')],
            value: _activeLow,
            onChanged: (v) => setState(() => _activeLow = v),
          ),
          Padding(
            padding: const EdgeInsets.only(top: 6, left: 2),
            child: Text(
              _activeLow
                  ? 'A reed switch or a leak probe connects the pin to GND.'
                  : 'A PIR motion module drives the pin HIGH.',
              style: TextStyle(fontSize: 12.5, color: c.mu),
            ),
          ),
        ],
        if (_type == 'analog') ...[
          const FieldLabel('What it measures'),
          PickField<String>(
            title: 'What it measures',
            value: str(_s['kind'], 'light'),
            options: const [
              ('light', 'Light level (LDR)'),
              ('gas', 'Gas / smoke (MQ-2, MQ-135)'),
              ('moisture', 'Soil moisture'),
              ('water', 'Water level'),
              ('generic', 'Other (0–100 %)'),
            ],
            onChanged: (v) => setState(() => _s = {..._s, 'kind': v}),
          ),
          const FieldLabel('Read every'),
          _numberField('intervalSec', 10, suffix: 'seconds'),
          _SwitchRow(
            title: 'Reverse the scale',
            text: 'For sensors that read lower when there’s more (capacitive soil sensors when wet).',
            value: _s['invert'] == true,
            onChanged: (v) => setState(() => _s = {..._s, 'invert': v}),
          ),
        ],
        if (_type == 'dht') ...[
          const FieldLabel('Sensor model'),
          Segmented<String>(
            options: const [('dht22', 'DHT22 / AM2302'), ('dht11', 'DHT11')],
            value: str(_s['model'], 'dht22'),
            onChanged: (v) => setState(() => _s = {..._s, 'model': v}),
          ),
          const FieldLabel('Read every'),
          _numberField('intervalSec', 30, suffix: 'seconds'),
        ],
        if ((def?.hasActiveLow ?? false) && _type != 'contact') ...[
          const FieldLabel('Relay module'),
          Segmented<bool>(
            options: const [(true, 'Switches on LOW'), (false, 'Switches on HIGH')],
            value: _activeLow,
            onChanged: (v) => setState(() => _activeLow = v),
          ),
          Padding(
            padding: const EdgeInsets.only(top: 6, left: 2),
            child: Text('Most relay boards switch on LOW.', style: TextStyle(fontSize: 12.5, color: c.mu)),
          ),
        ],
        if (def?.controllable ?? false) ...[
          const FieldLabel(
            'After a power cut',
            hint: 'A motor, an iron or a geyser is safer staying off until someone switches it on.',
          ),
          Segmented<bool>(
            options: const [(false, 'Back as it was'), (true, 'Stays off')],
            value: _restoreOff,
            onChanged: (v) => setState(() => _restoreOff = v),
          ),
        ],
        const FieldLabel('Room'),
        PickField<String>(
          title: 'Room',
          value: _room,
          options: [('', 'No room (admins only)'), for (final r in rooms) (r.id, r.name)],
          onChanged: (v) => setState(() {
            _room = v;
            _roomPicked = true;
          }),
        ),
        const FieldLabel(
          'Other names for voice',
          hint: 'Extra words the assistant should understand, separated by commas.',
        ),
        TextField(
          controller: _aliases,
          decoration: const InputDecoration(hintText: 'lamp, batti, tube light'),
        ),
        if (!enough) ...[
          const SizedBox(height: 12),
          const Note(
            tone: NoteTone.warn,
            icon: WorkIcons.cpu,
            child: Text('No free pin on this board suits this type of device.'),
          ),
        ],
        errorNote(_error),
        const SizedBox(height: 16),
        BigButton(label: _d != null ? 'Save changes' : 'Add device', busy: _busy, onTap: enough ? _save : null),
      ],
    );
  }
}

class _SwitchRow extends StatelessWidget {
  const _SwitchRow({required this.title, required this.text, required this.value, required this.onChanged});
  final String title, text;
  final bool value;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: () => onChanged(!value),
      child: Padding(
        padding: const EdgeInsets.only(top: 14),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: TextStyle(fontSize: 15, fontWeight: FontWeight.w500, color: c.tx),
                  ),
                  Text(text, style: TextStyle(fontSize: 12.5, color: c.mu, height: 1.35)),
                ],
              ),
            ),
            const SizedBox(width: 10),
            SbSwitch(value: value, onChanged: onChanged, semanticLabel: title),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------- wall switches and buttons

Future<void> showInputForm(
  BuildContext context, {
  required String homeId,
  required BoardNode node,
  required Catalog catalog,
  BoardInput? editing,
}) => showSbSheet<void>(
  context,
  builder: (_) => InputForm(homeId: homeId, node: node, catalog: catalog, editing: editing),
);

/// Add or change an input: an ordinary wall switch or a push-button, its own switch, and what its
/// gestures do through the server (a scene, a switch anywhere, a room or the home off).
class InputForm extends ConsumerStatefulWidget {
  const InputForm({super.key, required this.homeId, required this.node, required this.catalog, this.editing});
  final String homeId;
  final BoardNode node;
  final Catalog catalog;
  final BoardInput? editing;

  @override
  ConsumerState<InputForm> createState() => _InputFormState();
}

class _InputFormState extends ConsumerState<InputForm> {
  late final BoardInput? _i = widget.editing;
  late String _type = _i?.type ?? 'wall_switch';
  late int _pin = _i?.pin ?? -1;
  late final _name = TextEditingController(text: _i?.name ?? '');
  late String _target = _i != null ? (_i.targetId ?? '') : (_switches.firstOrNull?.id ?? '');
  late bool _gestures = _i?.gestures ?? false;
  late final Map<String, InputAction?> _actions = {...?_i?.actions};
  bool _busy = false;
  String? _error;

  List<NodeDevice> get _switches =>
      widget.node.devices.where((d) => widget.catalog.type(d.type)?.controllable ?? d.type == 'switch').toList();

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  List<String> get _shown => _type == 'wall_switch'
      ? (_target.isEmpty ? const ['flip'] : const [])
      : [
          if (_target.isEmpty) 'single',
          if (_gestures) ...['double', 'long'],
        ];

  Future<void> _save() async {
    final kept = {
      for (final g in _shown)
        if (_actions[g] != null) g: _actions[g]!.toJson(),
    };
    if (_target.isEmpty && kept.isEmpty) {
      return setState(() => _error = 'Choose the switch it controls, or what its presses do.');
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    final body = {
      'name': _name.text.trim(),
      'targetId': _target.isEmpty ? null : _target,
      'settings': _type == 'toggle_button' ? {'gestures': _gestures} : <String, dynamic>{},
      'actions': kept,
    };
    final repo = ref.read(workRepositoryProvider);
    try {
      if (_i != null) {
        await repo.updateInput(widget.homeId, _i.id, body);
      } else {
        await repo.addInput(widget.homeId, widget.node.id, {...body, 'type': _type, 'pin': _pin});
      }
      ref
          .read(toastProvider.notifier)
          .show(_i != null ? 'Saved — the board updates in a second' : 'Added — try it on the wall');
      refreshBoards(ref, widget.homeId);
      if (mounted) Navigator.of(context).pop();
    } catch (e) {
      setState(() => _error = messageOf(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final node = widget.node;
    final pins = freePins(widget.catalog, node, 'input', keep: [if (_i != null) _i.pin]);
    final pin = _i?.pin ?? pickPin(pins, _pin);
    _pin = pin; // the form saves what it shows
    final scenes = ref.watch(workScenesProvider(widget.homeId)).value ?? const <SceneRef>[];
    final rooms = ref.watch(workRoomsProvider(widget.homeId)).value ?? const <Room>[];
    final devices = (ref.watch(workDevicesProvider(widget.homeId)).value ?? const <Device>[])
        .where((d) => d.controllable)
        .toList();
    final options = <(String, String)>[
      ('', 'Nothing'),
      for (final s in scenes) (InputAction.scene(s.id).pick, 'Run “${s.name}”'),
      (const InputAction.allOff().pick, 'Everything in the home off'),
      for (final r in rooms) (InputAction.allOff(r.id).pick, 'Everything in ${r.name} off'),
      for (final d in devices)
        (InputAction.device(d.id).pick, 'Toggle ${d.name}${d.roomName != null ? ' · ${d.roomName}' : ''}'),
    ];
    InputAction? fromPick(String k) {
      if (k.isEmpty) return null;
      final p = k.split(':');
      return switch (p.first) {
        'scene' => InputAction.scene(p[1]),
        'device' => InputAction.device(p[1], on: p.length > 2 && p[2] != 't' ? p[2] == '1' : null),
        _ => InputAction.allOff(p.length > 1 && p[1].isNotEmpty ? p[1] : null),
      };
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SheetTitle(
          _i != null ? 'Change this ${_i.isWallSwitch ? 'wall switch' : 'button'}' : 'Add a wall switch or button',
          subtitle: 'On ${node.name}',
        ),
        if (_i == null) ...[
          const SizedBox(height: 14),
          Segmented<String>(
            options: const [('wall_switch', 'Wall switch'), ('toggle_button', 'Push-button')],
            value: _type,
            onChanged: (v) => setState(() => _type = v),
          ),
        ],
        const SizedBox(height: 10),
        Text(
          _type == 'wall_switch'
              ? 'A normal switch that stays up or down, wired between the pin and G. Every flip — up or down — toggles its light, so it always works, whatever the app did last. Works even when Wi-Fi is down.'
              : 'A bell-type button that springs back, wired between the pin and G. A press toggles its light at once (even without Wi-Fi). Turn on double-press and long press to run scenes too.',
          style: TextStyle(fontSize: 13.5, color: c.mu, height: 1.4),
        ),
        if (_i == null) ...[
          const FieldLabel('Pin', hint: 'Only free pins that can read a switch are offered.'),
          PinPicker(choices: pins, value: pin, onChanged: (v) => setState(() => _pin = v)),
        ] else ...[
          const FieldLabel('Pin'),
          Text(
            pinName(widget.catalog, node.board, _i.pin),
            style: TextStyle(fontFamily: SbFonts.mono, fontSize: 15, color: c.tx),
          ),
        ],
        const FieldLabel('Name (optional)'),
        TextField(
          controller: _name,
          maxLength: 60,
          decoration: InputDecoration(
            hintText: _type == 'wall_switch' ? 'Hall switch by the door' : 'Bedside button',
            counterText: '',
          ),
        ),
        const FieldLabel('Toggles (on this board)'),
        PickField<String>(
          title: 'Which switch it toggles',
          value: _target,
          options: [('', 'Nothing of its own'), for (final d in _switches) (d.id, d.name)],
          onChanged: (v) => setState(() => _target = v),
        ),
        if (_type == 'toggle_button')
          _SwitchRow(
            title: 'Double-press and long press do more',
            text: _target.isEmpty ? 'Pick what each does below.' : 'A single press then waits a third of a second.',
            value: _gestures,
            onChanged: (v) => setState(() => _gestures = v),
          ),
        for (final g in _shown) ...[
          FieldLabel(_gestureLabel[g]!),
          PickField<String>(
            title: _gestureLabel[g]!,
            value: _actions[g]?.pick ?? '',
            options: options,
            onChanged: (v) => setState(() => _actions[g] = fromPick(v)),
          ),
        ],
        if (_shown.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 8, left: 2),
            child: Text(
              'These go through the server, so they need Wi-Fi. They act with the home owner’s rights.',
              style: TextStyle(fontSize: 12.5, color: c.mu),
            ),
          ),
        errorNote(_error),
        const SizedBox(height: 16),
        BigButton(label: _i != null ? 'Save' : 'Add', busy: _busy, onTap: _i == null && pins.isEmpty ? null : _save),
      ],
    );
  }
}

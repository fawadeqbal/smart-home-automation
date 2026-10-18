import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_exception.dart';
import '../../core/theme/app_theme.dart';
import '../../core/theme/sb_colors.dart';
import '../../core/theme/sb_icons.dart';
import '../../core/util/format.dart';
import '../../data/models/automation.dart';
import '../../data/models/device.dart';
import '../../shared/widgets/common.dart';
import '../../shared/widgets/pressable.dart';
import '../../shared/widgets/sb_chip.dart';
import '../../shared/widgets/sb_switch.dart';
import '../../shared/widgets/segmented.dart';
import '../../shared/widgets/sheet.dart';
import '../../state/automation.dart';
import '../../state/devices.dart';
import '../../state/session.dart';
import '../../state/toast.dart';

/// New rule, or change [rule]: "when this happens (only then), do that".
Future<void> showRuleEditor(BuildContext context, {Rule? rule}) =>
    showSbSheet<void>(context, builder: (_) => RuleEditor(rule: rule));

/// Builds a rule like the web's New rule form: a device and what it does, optional limits (times,
/// days, away mode), then switch devices (for a while), run a scene and/or send a notice.
class RuleEditor extends ConsumerStatefulWidget {
  const RuleEditor({super.key, this.rule});
  final Rule? rule;

  @override
  ConsumerState<RuleEditor> createState() => _RuleEditorState();
}

class _RuleEditorState extends ConsumerState<RuleEditor> {
  String? _device;
  String _event = 'on';
  String _field = 'temperature';
  late final _value = TextEditingController(text: '30');
  bool _window = false;
  TimeOfDay _from = const TimeOfDay(hour: 22, minute: 0), _to = const TimeOfDay(hour: 6, minute: 0);
  Set<int> _days = {};
  bool _away = false;

  /// device id -> on (true) / off (false)
  final Map<String, bool> _switch = {};
  late final _forMinutes = TextEditingController();
  String? _scene;

  /// '', me, admins or everyone
  String _tell = 'me';
  late final _message = TextEditingController();
  late final _name = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    final r = widget.rule;
    final t = r?.trigger;
    if (r != null && t != null) {
      _device = t.deviceId;
      _event = t.event;
      if (t.field != null) _field = t.field!;
      if (t.value != null) _value.text = _plain(t.value!);
      final c = r.conditions;
      if (c.from != null && c.to != null) {
        _window = true;
        _from = _parse(c.from!);
        _to = _parse(c.to!);
      }
      _days = c.days.toSet();
      _away = c.away;
      _tell = '';
      for (final a in r.actions) {
        switch (a.type) {
          case 'device':
            _switch[a.deviceId!] = a.on ?? false;
            if (a.forMinutes != null) _forMinutes.text = '${a.forMinutes}';
          case 'scene':
            _scene = a.sceneId;
          case 'notify':
            _tell = a.to ?? 'me';
            _message.text = a.message ?? '';
        }
      }
      if (r.name != r.summary) _name.text = r.name;
    }
  }

  @override
  void dispose() {
    for (final c in [_value, _forMinutes, _message, _name]) {
      c.dispose();
    }
    super.dispose();
  }

  static String _plain(double v) => v == v.roundToDouble() ? '${v.round()}' : '$v';
  static TimeOfDay _parse(String t) {
    final p = t.split(':');
    return TimeOfDay(hour: int.tryParse(p.first) ?? 0, minute: p.length > 1 ? int.tryParse(p[1]) ?? 0 : 0);
  }

  static String _hhmm(TimeOfDay t) => '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';

  List<Device> _triggers(List<Device> all) => all.where((d) => ruleEventsFor(d.type, d.settings).isNotEmpty).toList();

  void _pick(Device d) => setState(() {
        _device = d.id;
        _event = ruleEventsFor(d.type, d.settings).first.$1;
      });

  RuleInput _input(Device dev) => RuleInput(
        name: _name.text,
        trigger: RuleTrigger(
          deviceId: dev.id,
          event: _event,
          value: double.tryParse(_value.text.trim()),
          field: dev.type == 'dht' ? _field : null,
        ),
        conditions: RuleConditions(from: _window ? _hhmm(_from) : null, to: _window ? _hhmm(_to) : null, days: (_days.toList()..sort()), away: _away),
        actions: [
          for (final e in _switch.entries) RuleAction.device(e.key, on: e.value, forMinutes: e.value ? int.tryParse(_forMinutes.text.trim()) : null),
          if (_scene != null) RuleAction.scene(_scene!),
          if (_tell.isNotEmpty) RuleAction.notify(_tell, message: _message.text),
        ],
      );

  Future<void> _save(Device dev) async {
    final input = _input(dev);
    final problem = input.problem;
    if (problem != null) {
      setState(() => _error = problem);
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(rulesProvider.notifier).save(input, id: widget.rule?.id);
      if (mounted) Navigator.of(context).pop();
      ref.read(toastProvider.notifier).show(widget.rule == null ? 'Rule saved' : 'Rule changed');
    } catch (e) {
      if (mounted) {
        setState(() {
          _busy = false;
          _error = ApiException.from(e).message;
        });
      }
    }
  }

  Future<void> _delete() async {
    final r = widget.rule!;
    try {
      await ref.read(rulesProvider.notifier).remove(r.id);
      if (mounted) Navigator.of(context).pop();
      ref.read(toastProvider.notifier).show('Deleted');
    } catch (e) {
      ref.read(toastProvider.notifier).show(ApiException.from(e).message, error: true);
    }
  }

  Future<void> _time(bool from) async {
    final t = await showTimePicker(context: context, initialTime: from ? _from : _to);
    if (t != null) setState(() => from ? _from = t : _to = t);
  }

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final all = ref.watch(devicesProvider).value ?? const <Device>[];
    final scenes = (ref.watch(scenesProvider).value ?? const <Scene>[]).where((s) => s.canRun).toList();
    final manages = ref.watch(meProvider.select((m) => m.home?.manages ?? false));
    final triggers = _triggers(all);
    final dev = triggers.where((d) => d.id == _device).firstOrNull ?? triggers.where((d) => d.type == 'contact').firstOrNull ?? triggers.firstOrNull;
    if (dev != null && _device != dev.id) {
      _device = dev.id;
      _event = ruleEventsFor(dev.type, dev.settings).first.$1;
    }
    final switches = all.where((d) => d.type == 'switch' && d.canControl).toList();
    final label = TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: c.mu, letterSpacing: .3);

    if (dev == null) {
      return const EmptyView(icon: SbIcons.zap, title: 'Nothing can start a rule', text: 'You can’t see any device that could start a rule yet.');
    }
    final events = ruleEventsFor(dev.type, dev.settings);
    final reading = _event == 'above' || _event == 'below';
    final unit = dev.type == 'analog' || _field == 'humidity' ? '%' : '°C';

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(child: Text(widget.rule == null ? 'New rule' : 'Change the rule', style: SbText.title.copyWith(color: c.tx))),
            RoundButton(icon: SbIcons.x, label: 'Close', onTap: () => Navigator.of(context).pop()),
          ],
        ),
        const SizedBox(height: 16),
        Text('1 · WHEN', style: label),
        const SizedBox(height: 8),
        Wrap(
          spacing: 6,
          runSpacing: 6,
          children: [
            for (final d in triggers)
              SbChip(
                label: d.roomName == null ? d.name : '${d.name} · ${d.roomName}',
                selected: d.id == dev.id,
                height: 38,
                onTap: () => _pick(d),
              ),
          ],
        ),
        const SizedBox(height: 10),
        Segmented<String>(options: events, value: _event, onChanged: (v) => setState(() => _event = v)),
        if (reading) ...[
          const SizedBox(height: 10),
          Row(
            children: [
              if (dev.type == 'dht') ...[
                Expanded(
                  child: Segmented<String>(options: const [('temperature', 'Temperature'), ('humidity', 'Humidity')], value: _field, onChanged: (v) => setState(() => _field = v)),
                ),
                const SizedBox(width: 10),
              ],
              SizedBox(
                width: 110,
                child: TextField(
                  controller: _value,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true, signed: true),
                  style: TextStyle(fontSize: 16, color: c.tx),
                  decoration: InputDecoration(suffixText: unit, isDense: true),
                ),
              ),
            ],
          ),
        ],
        const SizedBox(height: 18),
        Text('2 · ONLY… (OPTIONAL)', style: label),
        const SizedBox(height: 4),
        _Toggle(title: 'Between certain times', value: _window, onChanged: (v) => setState(() => _window = v)),
        if (_window)
          Row(
            children: [
              Expanded(child: SbChip(label: Fmt.clock(DateTime(2000, 1, 1, _from.hour, _from.minute)), mono: true, height: 42, selected: false, icon: SbIcons.clock, onTap: () => _time(true))),
              Padding(padding: const EdgeInsets.symmetric(horizontal: 8), child: Text('to', style: TextStyle(color: c.mu))),
              Expanded(child: SbChip(label: Fmt.clock(DateTime(2000, 1, 1, _to.hour, _to.minute)), mono: true, height: 42, selected: false, icon: SbIcons.clock, onTap: () => _time(false))),
            ],
          ),
        const SizedBox(height: 6),
        Text('On these days (none: every day)', style: TextStyle(fontSize: 13.5, color: c.tx)),
        const SizedBox(height: 6),
        Row(
          children: [
            for (var i = 0; i < 7; i++) ...[
              if (i > 0) const SizedBox(width: 4),
              Expanded(
                child: Pressable(
                  selected: _days.contains(i),
                  semanticLabel: Fmt.dayShort[i],
                  onTap: () => setState(() => _days = _days.contains(i) ? ({..._days}..remove(i)) : {..._days, i}),
                  child: Container(
                    height: 38,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: _days.contains(i) ? c.tx : c.sf,
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: _days.contains(i) ? c.tx : c.ln2),
                    ),
                    child: Text(Fmt.dayLetter[i], style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: _days.contains(i) ? c.bg : c.mu)),
                  ),
                ),
              ),
            ],
          ],
        ),
        _Toggle(title: 'Only while the home is in away mode', value: _away, onChanged: (v) => setState(() => _away = v)),
        const SizedBox(height: 12),
        Text('3 · THEN', style: label),
        const SizedBox(height: 8),
        if (switches.isNotEmpty) ...[
          Text('Switch — tap once for on, again for off', style: TextStyle(fontSize: 13.5, color: c.tx)),
          const SizedBox(height: 6),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              for (final d in switches)
                SbChip(
                  label: _switch.containsKey(d.id) ? '${d.name}: ${_switch[d.id]! ? 'on' : 'off'}' : d.name,
                  selected: _switch.containsKey(d.id),
                  tone: _switch[d.id] == false ? ChipTone.ink : ChipTone.amber,
                  height: 38,
                  onTap: () => setState(() {
                    // nothing -> on -> off -> nothing
                    if (!_switch.containsKey(d.id)) {
                      _switch[d.id] = true;
                    } else if (_switch[d.id]!) {
                      _switch[d.id] = false;
                    } else {
                      _switch.remove(d.id);
                    }
                  }),
                ),
            ],
          ),
          if (_switch.values.any((on) => on)) ...[
            const SizedBox(height: 10),
            Row(
              children: [
                Expanded(child: Text('Switch back off after (minutes, optional)', style: TextStyle(fontSize: 13.5, color: c.tx))),
                SizedBox(
                  width: 90,
                  child: TextField(
                    controller: _forMinutes,
                    keyboardType: TextInputType.number,
                    style: TextStyle(fontSize: 15, color: c.tx),
                    decoration: const InputDecoration(hintText: 'e.g. 5', isDense: true),
                  ),
                ),
              ],
            ),
          ],
          const SizedBox(height: 12),
        ],
        if (scenes.isNotEmpty) ...[
          Text('Run a scene', style: TextStyle(fontSize: 13.5, color: c.tx)),
          const SizedBox(height: 6),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              SbChip(label: 'No scene', selected: _scene == null, height: 38, onTap: () => setState(() => _scene = null)),
              for (final s in scenes) SbChip(label: s.name, selected: _scene == s.id, height: 38, tone: ChipTone.blue, onTap: () => setState(() => _scene = s.id)),
            ],
          ),
          const SizedBox(height: 12),
        ],
        Text('Send a notice', style: TextStyle(fontSize: 13.5, color: c.tx)),
        const SizedBox(height: 6),
        Wrap(
          spacing: 6,
          runSpacing: 6,
          children: [
            for (final (v, l) in [('', 'No notice'), ('me', 'To me'), if (manages) ('admins', 'Owners and admins'), if (manages) ('everyone', 'Everyone')])
              SbChip(label: l, selected: _tell == v, height: 38, onTap: () => setState(() => _tell = v)),
          ],
        ),
        if (_tell.isNotEmpty) ...[
          const SizedBox(height: 8),
          TextField(
            controller: _message,
            maxLength: 200,
            style: TextStyle(fontSize: 15, color: c.tx),
            decoration: const InputDecoration(hintText: 'Notice text (optional), e.g. Someone is at the gate', counterText: ''),
          ),
        ],
        const SizedBox(height: 14),
        TextField(
          controller: _name,
          maxLength: 120,
          style: TextStyle(fontSize: 15, color: c.tx),
          decoration: const InputDecoration(hintText: 'Name (optional — made from your choices)', counterText: ''),
        ),
        if (_error != null) ...[
          const SizedBox(height: 12),
          Note(tone: NoteTone.bad, icon: SbIcons.warning, child: Text(_error!)),
        ],
        const SizedBox(height: 16),
        BigButton(label: widget.rule == null ? 'Save rule' : 'Save changes', icon: SbIcons.check, busy: _busy, onTap: () => _save(dev)),
        if (widget.rule != null) ...[
          const SizedBox(height: 8),
          TextButton(onPressed: _busy ? null : _delete, child: Text('Delete this rule', style: TextStyle(color: c.badText, fontWeight: FontWeight.w600))),
        ],
      ],
    );
  }
}

class _Toggle extends StatelessWidget {
  const _Toggle({required this.title, required this.value, required this.onChanged});
  final String title;
  final bool value;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    return InkWell(
      onTap: () => onChanged(!value),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Row(
          children: [
            Expanded(child: Text(title, style: TextStyle(fontSize: 14.5, color: c.tx))),
            SbSwitch(value: value, onChanged: onChanged, semanticLabel: title),
          ],
        ),
      ),
    );
  }
}

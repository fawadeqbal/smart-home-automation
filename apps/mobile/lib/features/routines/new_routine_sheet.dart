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
import '../../shared/widgets/segmented.dart';
import '../../shared/widgets/sheet.dart';
import '../../state/automation.dart';
import '../../state/home_overview.dart';
import '../../state/toast.dart';
import '../devices/device_sheet.dart';

Future<void> showNewRoutineSheet(BuildContext context, {String? deviceId}) => showSbSheet<void>(
  context,
  builder: (_) => NewRoutineSheet(deviceId: deviceId),
);

enum _When { inAWhile, todayAt, repeat, sun }

/// "Turn on the geyser every day at 05:00": what, when, and a sentence that reads it back.
class NewRoutineSheet extends ConsumerStatefulWidget {
  const NewRoutineSheet({super.key, this.deviceId});
  final String? deviceId;

  @override
  ConsumerState<NewRoutineSheet> createState() => _NewRoutineSheetState();
}

class _NewRoutineSheetState extends ConsumerState<NewRoutineSheet> {
  static const times = ['05:00', '06:30', '18:30', '22:00', '23:30'];
  static const minutes = [15, 30, 60, 120];

  String? _room;
  String? _device;
  bool _on = true;
  _When _when = _When.repeat;
  int _mins = 30;
  String _time = '05:00';
  Set<int> _days = {0, 1, 2, 3, 4, 5, 6};
  String _sunEvent = 'SUNSET';
  int _offset = 0;
  bool _saving = false;

  static const offsets = [-30, -15, 0, 15, 30];

  /// "at sunset", "15 min before sunrise".
  String get _sunText {
    final ev = _sunEvent == 'SUNRISE' ? 'sunrise' : 'sunset';
    return _offset == 0 ? 'at $ev' : '${_offset.abs()} min ${_offset < 0 ? 'before' : 'after'} $ev';
  }

  List<RoomSummary> _rooms() =>
      ref.read(roomSummariesProvider).where((r) => r.switches.any((d) => d.canControl)).toList();

  @override
  void initState() {
    super.initState();
    final rooms = _rooms();
    final start = widget.deviceId != null
        ? rooms.where((r) => r.devices.any((d) => d.id == widget.deviceId)).firstOrNull
        : null;
    final room = start ?? rooms.firstOrNull;
    _room = room?.room.id;
    _device = widget.deviceId ?? room?.switches.where((d) => d.canControl).firstOrNull?.id;
  }

  Device? get _picked {
    for (final r in _rooms()) {
      for (final d in r.devices) {
        if (d.id == _device) return d;
      }
    }
    return null;
  }

  String get _sentence {
    final d = _picked;
    final what = 'Turn ${_on ? 'on' : 'off'} the ${d?.name.toLowerCase() ?? '…'}';
    return switch (_when) {
      _When.inAWhile => '$what in ${Fmt.minutes(_mins)}.',
      _When.todayAt => '$what ${_todayOrTomorrow()} at $_time.',
      _When.repeat =>
        _days.isEmpty ? '$what — pick at least one day.' : '$what ${Fmt.days(_days.toList()).toLowerCase()} at $_time.',
      // it moves with the seasons: the home's sunset, from where the home is
      _When.sun => _days.isEmpty ? '$what — pick at least one day.' : '$what ${Fmt.days(_days.toList()).toLowerCase()} $_sunText.',
    };
  }

  DateTime _at() {
    final parts = _time.split(':');
    final now = DateTime.now();
    var t = DateTime(
      now.year,
      now.month,
      now.day,
      int.parse(parts[0]),
      int.parse(parts[1]),
    );
    if (!t.isAfter(now)) t = t.add(const Duration(days: 1));
    return t;
  }

  String _todayOrTomorrow() => _at().day == DateTime.now().day ? 'today' : 'tomorrow';

  Future<void> _pickTime() async {
    final parts = _time.split(':');
    final picked = await showTimePicker(
      context: context,
      initialTime: TimeOfDay(
        hour: int.parse(parts[0]),
        minute: int.parse(parts[1]),
      ),
      builder: (ctx, child) => MediaQuery(
        data: MediaQuery.of(ctx).copyWith(alwaysUse24HourFormat: true),
        child: child!,
      ),
    );
    if (picked != null) {
      setState(
        () => _time = '${picked.hour.toString().padLeft(2, '0')}:${picked.minute.toString().padLeft(2, '0')}',
      );
    }
  }

  Future<void> _save() async {
    final d = _picked;
    final toast = ref.read(toastProvider.notifier);
    if (d == null) return;
    if ((_when == _When.repeat || _when == _When.sun) && _days.isEmpty) {
      toast.show('Pick at least one day');
      return;
    }
    final actions = [DeviceAction(deviceId: d.id, on: _on)];
    final s = switch (_when) {
      _When.inAWhile => NewSchedule.inMinutes(_mins, actions),
      _When.todayAt => NewSchedule.at(_at(), actions),
      _When.repeat => NewSchedule.daily(
        _time,
        (_days.toList()..sort()),
        actions,
      ),
      _When.sun => NewSchedule.sun(_sunEvent, _offset, (_days.toList()..sort()), actions),
    };
    setState(() => _saving = true);
    try {
      await ref.read(schedulesProvider.notifier).create(s);
      if (mounted) Navigator.of(context).pop();
      toast.show('Routine saved');
    } catch (e) {
      toast.show(ApiException.from(e).message, error: true);
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final rooms = _rooms();
    final room = rooms.where((r) => r.room.id == _room).firstOrNull;
    final devices = room?.switches.where((d) => d.canControl).toList() ?? const <Device>[];
    final label = TextStyle(
      fontSize: 13,
      fontWeight: FontWeight.w600,
      color: c.mu,
      letterSpacing: .3,
    );

    if (rooms.isEmpty) {
      return const EmptyView(
        icon: SbIcons.clock,
        title: 'Nothing you can schedule',
        text: 'You can only schedule things in rooms where you’re allowed to switch them.',
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                'New routine',
                style: SbText.title.copyWith(color: c.tx),
              ),
            ),
            RoundButton(
              icon: SbIcons.x,
              label: 'Close',
              onTap: () => Navigator.of(context).pop(),
            ),
          ],
        ),
        const SizedBox(height: 18),
        Text('1 · WHAT', style: label),
        const SizedBox(height: 8),
        SizedBox(
          height: 36,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            itemCount: rooms.length,
            separatorBuilder: (_, _) => const SizedBox(width: 6),
            itemBuilder: (_, i) => SbChip(
              label: rooms[i].room.name,
              height: 36,
              selected: rooms[i].room.id == _room,
              onTap: () => setState(() {
                _room = rooms[i].room.id;
                _device = rooms[i].switches.where((d) => d.canControl).firstOrNull?.id;
              }),
            ),
          ),
        ),
        const SizedBox(height: 8),
        Wrap(
          spacing: 6,
          runSpacing: 6,
          children: [
            for (final d in devices)
              DeviceChoiceChip(
                device: d,
                selected: d.id == _device,
                onTap: () => setState(() => _device = d.id),
              ),
          ],
        ),
        const SizedBox(height: 8),
        Segmented<bool>(
          options: const [(true, 'Turn on'), (false, 'Turn off')],
          value: _on,
          onChanged: (v) => setState(() => _on = v),
        ),
        const SizedBox(height: 18),
        Text('2 · WHEN', style: label),
        const SizedBox(height: 8),
        Segmented<_When>(
          options: const [
            (_When.inAWhile, 'In a while'),
            (_When.todayAt, 'Once at'),
            (_When.repeat, 'Repeat'),
            (_When.sun, 'Sun'),
          ],
          value: _when,
          onChanged: (v) => setState(() => _when = v),
        ),
        const SizedBox(height: 8),
        Wrap(
          spacing: 6,
          runSpacing: 6,
          children: [
            if (_when == _When.sun) ...[
              for (final (v, l) in const [('SUNSET', 'Sunset'), ('SUNRISE', 'Sunrise')])
                SbChip(label: l, height: 42, selected: _sunEvent == v, icon: v == 'SUNSET' ? SbIcons.moon : SbIcons.sun, onTap: () => setState(() => _sunEvent = v)),
              for (final o in offsets)
                SbChip(
                  label: o == 0 ? 'Right at it' : '${o.abs()} min ${o < 0 ? 'before' : 'after'}',
                  height: 42,
                  selected: _offset == o,
                  onTap: () => setState(() => _offset = o),
                ),
            ] else if (_when == _When.inAWhile)
              for (final m in minutes)
                SbChip(
                  label: Fmt.minutes(m),
                  mono: true,
                  height: 42,
                  selected: _mins == m,
                  onTap: () => setState(() => _mins = m),
                )
            else ...[
              for (final t in times)
                SbChip(
                  label: t,
                  mono: true,
                  height: 42,
                  selected: _time == t,
                  onTap: () => setState(() => _time = t),
                ),
              SbChip(
                label: times.contains(_time) ? 'Other…' : _time,
                mono: !times.contains(_time),
                height: 42,
                selected: !times.contains(_time),
                onTap: _pickTime,
              ),
            ],
          ],
        ),
        if (_when == _When.repeat || _when == _When.sun) ...[
          const SizedBox(height: 8),
          Row(
            children: [
              for (var i = 0; i < 7; i++) ...[
                if (i > 0) const SizedBox(width: 5),
                Expanded(
                  child: Pressable(
                    selected: _days.contains(i),
                    semanticLabel: Fmt.dayShort[i],
                    onTap: () => setState(
                      () => _days = _days.contains(i) ? ({..._days}..remove(i)) : {..._days, i},
                    ),
                    child: AnimatedContainer(
                      duration: const Duration(milliseconds: 180),
                      height: 44,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        color: _days.contains(i) ? c.on : c.sf,
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(
                          color: _days.contains(i) ? c.on : c.ln2,
                        ),
                      ),
                      child: Text(
                        Fmt.dayLetter[i],
                        style: TextStyle(
                          fontSize: 13.5,
                          fontWeight: FontWeight.w600,
                          color: _days.contains(i) ? SbColors.onInk : c.mu,
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            ],
          ),
        ],
        const SizedBox(height: 18),
        Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: c.onSoft,
            borderRadius: BorderRadius.circular(16),
          ),
          child: Row(
            children: [
              SbIcon(SbIcons.sparkle, size: 18, color: c.tx),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  _sentence,
                  style: TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w500,
                    color: c.tx,
                    height: 1.4,
                  ),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 18),
        BigButton(
          label: 'Save routine',
          busy: _saving,
          onTap: _picked == null ? null : _save,
        ),
      ],
    );
  }
}

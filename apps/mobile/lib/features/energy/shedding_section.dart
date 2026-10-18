import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../core/network/api_exception.dart';
import '../../core/theme/app_theme.dart';
import '../../core/theme/sb_colors.dart';
import '../../core/theme/sb_icons.dart';
import '../../core/util/format.dart';
import '../../data/models/power.dart';
import '../../data/repositories/home_repository.dart';
import '../../shared/widgets/common.dart';
import '../../shared/widgets/pressable.dart';
import '../../shared/widgets/sb_chip.dart';
import '../../shared/widgets/segmented.dart';
import '../../shared/widgets/sheet.dart';
import '../../state/money.dart';
import '../../state/people.dart';
import '../../state/toast.dart';

/// Whether half hour [slot] (0 = midnight) falls in one of [windows].
bool inWindows(int slot, List<CutWindow> windows) {
  int minutes(String t) {
    final p = t.split(':');
    return (int.tryParse(p.first) ?? 0) * 60 + (p.length > 1 ? int.tryParse(p[1]) ?? 0 : 0);
  }

  final m = slot * 30;
  for (final w in windows) {
    final a = minutes(w.from);
    var b = minutes(w.to);
    if (b <= a) b += 1440;
    if ((m >= a && m < b) || (m + 1440 >= a && m + 1440 < b)) return true;
  }
  return false;
}

/// The day as 48 half hours: darker where the power went on more of the last 14 days; the expected
/// windows outlined.
class DayStrip extends StatelessWidget {
  const DayStrip({super.key, required this.slots, this.windows = const []});
  final List<int> slots;
  final List<CutWindow> windows;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final list = slots.isEmpty ? List.filled(48, 0) : slots;
    final max = list.fold<int>(1, (a, b) => b > a ? b : a);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Semantics(
          label: windows.isEmpty ? 'No regular cut times' : 'Cuts usually at ${windows.map((w) => '${w.from} to ${w.to}').join(', ')}',
          child: ClipRRect(
            borderRadius: BorderRadius.circular(6),
            child: SizedBox(
              height: 26,
              child: Row(
                children: [
                  for (final (i, n) in list.indexed)
                    Expanded(
                      child: Container(
                        margin: const EdgeInsets.only(right: 1),
                        decoration: BoxDecoration(
                          color: n == 0 ? c.sf2 : c.bad.withValues(alpha: .25 + .75 * n / max),
                          border: inWindows(i, windows) ? Border(bottom: BorderSide(color: c.onText, width: 3)) : null,
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ),
        ),
        const SizedBox(height: 4),
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [for (final t in ['12 am', '6 am', '12 pm', '6 pm', '12 am']) Text(t, style: TextStyle(fontSize: 11, color: c.mu))],
        ),
      ],
    );
  }
}

/// Load-shedding: the next cut, the pattern as a day strip, and the area's schedule (owners and admins
/// type it in from the electricity company's SMS).
class SheddingSection extends ConsumerWidget {
  const SheddingSection({super.key, required this.canEdit});
  final bool canEdit;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.sb;
    final shed = ref.watch(sheddingProvider);
    final s = shed.value;
    if (s == null) {
      return shed.hasError ? ErrorView(error: shed.error!, onRetry: () => ref.invalidate(sheddingProvider)) : const SizedBox.shrink();
    }
    final shown = s.source == 'typed' ? s.typed : s.learned;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SectionHeader(
          'Load-shedding times',
          action: canEdit ? (s.typed.isEmpty ? 'Type our schedule' : 'Change') : null,
          onAction: () => showScheduleEditor(context, s),
        ),
        const SizedBox(height: 10),
        GroupCard(
          radius: 22,
          children: [
            Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    s.next == null ? 'No regular cut time yet' : s.next!.now ? 'Load-shedding time: ${s.next!.text}' : 'Next expected cut: ${s.next!.text}',
                    style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600, color: c.tx),
                  ),
                  const SizedBox(height: 4),
                  Text(s.how, style: TextStyle(fontSize: 13, color: c.mu, height: 1.35)),
                  const SizedBox(height: 12),
                  DayStrip(slots: s.slots, windows: shown),
                  if (shown.isNotEmpty) ...[
                    const SizedBox(height: 12),
                    Wrap(
                      spacing: 6,
                      runSpacing: 6,
                      children: [
                        for (final w in shown)
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                            decoration: BoxDecoration(color: c.acSoft, borderRadius: BorderRadius.circular(999)),
                            child: Text(w.text, style: TextStyle(fontSize: 13, fontWeight: FontWeight.w500, color: c.acText)),
                          ),
                      ],
                    ),
                  ],
                  const SizedBox(height: 12),
                  Text(
                    canEdit
                        ? 'Got your area’s schedule by SMS? Type it in above. For a heads-up 15 minutes before, turn on “Load-shedding is due” in Notifications.'
                        : 'For a heads-up 15 minutes before, turn on “Load-shedding is due” in Notifications.',
                    style: TextStyle(fontSize: 12.5, color: c.mu),
                  ),
                ],
              ),
            ),
          ],
        ),
      ],
    );
  }
}

// ------------------------------------------------------------------ the schedule editor

Future<void> showScheduleEditor(BuildContext context, Shedding s) =>
    showSbSheet<void>(context, builder: (_) => _ScheduleEditor(current: s.typed.isNotEmpty ? s.typed : s.learned, typed: s.typed.isNotEmpty));

class _Window {
  _Window(this.from, this.to, this.days);
  TimeOfDay from, to;
  Set<int> days;

  static TimeOfDay parse(String t) {
    final p = t.split(':');
    return TimeOfDay(hour: int.tryParse(p.first) ?? 0, minute: p.length > 1 ? int.tryParse(p[1]) ?? 0 : 0);
  }

  static String hhmm(TimeOfDay t) => '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';

  CutWindow get window => CutWindow(from: hhmm(from), to: hhmm(to), days: (days.toList()..sort()));
}

/// "Your area's load-shedding schedule": a few daily times, some only on certain days.
class _ScheduleEditor extends ConsumerStatefulWidget {
  const _ScheduleEditor({required this.current, required this.typed});
  final List<CutWindow> current;
  final bool typed;

  @override
  ConsumerState<_ScheduleEditor> createState() => _ScheduleEditorState();
}

class _ScheduleEditorState extends ConsumerState<_ScheduleEditor> {
  late final List<_Window> _rows = widget.current.isEmpty
      ? [_Window(const TimeOfDay(hour: 14, minute: 0), const TimeOfDay(hour: 15, minute: 0), {})]
      : [for (final w in widget.current) _Window(_Window.parse(w.from), _Window.parse(w.to), w.days.toSet())];
  bool _busy = false;
  String? _error;

  Future<void> _save(List<CutWindow> windows, String done) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(homeRepositoryProvider).setShedding(windows);
      ref.invalidate(sheddingProvider);
      ref.invalidate(powerStatusProvider);
      if (mounted) Navigator.of(context).pop();
      ref.read(toastProvider.notifier).show(done);
    } catch (e) {
      if (mounted) {
        setState(() {
          _busy = false;
          _error = ApiException.from(e).message;
        });
      }
    }
  }

  Future<TimeOfDay?> _pick(TimeOfDay t) => showTimePicker(
        context: context,
        initialTime: t,
        builder: (ctx, child) => MediaQuery(data: MediaQuery.of(ctx).copyWith(alwaysUse24HourFormat: false), child: child!),
      );

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    String ampm(TimeOfDay t) => CutWindow.ampm(_Window.hhmm(t));
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('Your area’s load-shedding schedule', style: SbText.title.copyWith(color: c.tx)),
        const SizedBox(height: 4),
        Text('Type the times from your electricity company’s SMS. Leave the days empty for every day.', style: TextStyle(fontSize: 14.5, color: c.mu)),
        const SizedBox(height: 14),
        for (final (i, r) in _rows.indexed)
          Container(
            margin: const EdgeInsets.only(bottom: 10),
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(color: c.sf2, borderRadius: BorderRadius.circular(16)),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: SbChip(
                        label: ampm(r.from),
                        selected: false,
                        height: 42,
                        icon: SbIcons.clock,
                        onTap: () async {
                          final t = await _pick(r.from);
                          if (t != null) setState(() => r.from = t);
                        },
                      ),
                    ),
                    Padding(padding: const EdgeInsets.symmetric(horizontal: 8), child: Text('to', style: TextStyle(color: c.mu))),
                    Expanded(
                      child: SbChip(
                        label: ampm(r.to),
                        selected: false,
                        height: 42,
                        icon: SbIcons.clock,
                        onTap: () async {
                          final t = await _pick(r.to);
                          if (t != null) setState(() => r.to = t);
                        },
                      ),
                    ),
                    IconButton(
                      tooltip: 'Remove',
                      onPressed: () => setState(() => _rows.removeAt(i)),
                      icon: SbIcon(SbIcons.trash, size: 17, color: c.mu),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Row(
                  children: [
                    for (var d = 0; d < 7; d++) ...[
                      if (d > 0) const SizedBox(width: 4),
                      Expanded(
                        child: Pressable(
                          selected: r.days.contains(d),
                          semanticLabel: Fmt.dayShort[d],
                          onTap: () => setState(() => r.days.contains(d) ? r.days.remove(d) : r.days.add(d)),
                          child: Container(
                            height: 36,
                            alignment: Alignment.center,
                            decoration: BoxDecoration(
                              color: r.days.contains(d) ? c.tx : c.sf,
                              borderRadius: BorderRadius.circular(10),
                              border: Border.all(color: r.days.contains(d) ? c.tx : c.ln2),
                            ),
                            child: Text(
                              Fmt.dayShort[d],
                              style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: r.days.contains(d) ? c.bg : c.mu),
                            ),
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
                const SizedBox(height: 6),
                Text(r.days.isEmpty ? 'Every day' : Fmt.days(r.days.toList()), style: TextStyle(fontSize: 12.5, color: c.mu)),
              ],
            ),
          ),
        if (_rows.length < 8)
          OutlinedButton.icon(
            onPressed: () => setState(() => _rows.add(_Window(const TimeOfDay(hour: 20, minute: 0), const TimeOfDay(hour: 21, minute: 0), {}))),
            icon: SbIcon(SbIcons.plus, size: 15, color: c.tx),
            label: const Text('Add a time'),
            style: OutlinedButton.styleFrom(
              foregroundColor: c.tx,
              minimumSize: const Size.fromHeight(46),
              side: BorderSide(color: c.ln2),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
              textStyle: const TextStyle(fontFamily: SbFonts.sans, fontSize: 14.5, fontWeight: FontWeight.w500),
            ),
          ),
        if (_error != null) ...[
          const SizedBox(height: 12),
          Note(tone: NoteTone.bad, icon: SbIcons.warning, child: Text(_error!)),
        ],
        const SizedBox(height: 16),
        BigButton(
          label: _rows.isEmpty ? 'Save (no schedule)' : 'Save schedule',
          icon: SbIcons.check,
          busy: _busy,
          onTap: () => _save([for (final r in _rows) r.window], _rows.isEmpty ? 'Back to the learned times' : 'Schedule saved'),
        ),
        if (widget.typed) ...[
          const SizedBox(height: 8),
          TextButton(
            onPressed: _busy ? null : () => _save(const [], 'Back to the learned times'),
            child: Text('Use the learned times instead', style: TextStyle(color: c.acText, fontWeight: FontWeight.w500)),
          ),
        ],
      ],
    );
  }
}

// ------------------------------------------------------------------ UPS mode

/// UPS mode (owners and admins): the grid sensor, and the heavy loads that switch off by themselves.
class UpsSection extends ConsumerWidget {
  const UpsSection({super.key, required this.canEdit});
  final bool canEdit;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.sb;
    final g = ref.watch(gridProvider).value;
    if (g == null || !g.loaded) return const SizedBox.shrink();
    final loads = g.loadNames;
    return Padding(
      padding: const EdgeInsets.only(top: 22),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SectionHeader('UPS mode', action: g.sensor != null && canEdit ? 'Heavy loads' : null, onAction: () => _pickLoads(context, g)),
          const SizedBox(height: 10),
          GroupCard(
            radius: 22,
            children: [
              Padding(
                padding: const EdgeInsets.all(16),
                child: g.sensor == null
                    ? Text(
                        'Ask your installer for a grid sensor: then the app knows when you’re on UPS or solar, switches heavy things off to save the battery, and records each cut to the minute.',
                        style: TextStyle(fontSize: 14, color: c.mu, height: 1.4),
                      )
                    : Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Text(
                            g.off ? 'On UPS or solar since ${g.since == null ? 'a while' : DateFormat('h:mm a').format(g.since!).toLowerCase()}' : 'The grid power is on',
                            style: TextStyle(fontSize: 15.5, fontWeight: FontWeight.w600, color: c.tx),
                          ),
                          Text('From ${g.sensor}.', style: TextStyle(fontSize: 13, color: c.mu)),
                          const SizedBox(height: 8),
                          Text(
                            loads.isEmpty
                                ? 'Pick heavy loads (AC, iron, geyser, motor, kettle) to switch off by themselves when the grid goes.'
                                : 'When the grid goes: ${loads.join(', ')} switch off. When it comes back: ${g.restore ? 'they go back on' : 'they stay off'}. While on UPS, switching them on asks first.',
                            style: TextStyle(fontSize: 13.5, color: c.tx, height: 1.4),
                          ),
                        ],
                      ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Future<void> _pickLoads(BuildContext context, GridSettings g) => showSbSheet<void>(context, builder: (_) => _LoadPicker(grid: g));
}

class _LoadPicker extends ConsumerStatefulWidget {
  const _LoadPicker({required this.grid});
  final GridSettings grid;

  @override
  ConsumerState<_LoadPicker> createState() => _LoadPickerState();
}

class _LoadPickerState extends ConsumerState<_LoadPicker> {
  late final Set<String> _picked = widget.grid.loads.isNotEmpty ? widget.grid.loads.toSet() : widget.grid.switches.where((s) => s.heavy).map((s) => s.id).toSet();
  late bool _restore = widget.grid.restore;
  bool _busy = false;

  Future<void> _save() async {
    setState(() => _busy = true);
    try {
      await ref.read(homeRepositoryProvider).setGrid(loads: _picked.toList(), restore: _restore);
      ref.invalidate(gridProvider);
      if (mounted) Navigator.of(context).pop();
      ref.read(toastProvider.notifier).show('Saved');
    } catch (e) {
      ref.read(toastProvider.notifier).show(ApiException.from(e).message, error: true);
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final sorted = [...widget.grid.switches]..sort((a, b) => (b.heavy ? 1 : 0) - (a.heavy ? 1 : 0));
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('When the grid goes', style: SbText.title.copyWith(color: c.tx)),
        const SizedBox(height: 4),
        Text('Switch off these heavy loads, so the UPS battery lasts. Suggested from their names and power.', style: TextStyle(fontSize: 14.5, color: c.mu)),
        const SizedBox(height: 14),
        Wrap(
          spacing: 6,
          runSpacing: 6,
          children: [
            for (final s in sorted)
              SbChip(
                label: '${s.name}${s.heavy ? ' · heavy' : ''}',
                selected: _picked.contains(s.id),
                tone: ChipTone.amber,
                height: 40,
                onTap: () => setState(() => _picked.contains(s.id) ? _picked.remove(s.id) : _picked.add(s.id)),
              ),
          ],
        ),
        const SizedBox(height: 16),
        Text('When the grid comes back', style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w500, color: c.tx)),
        const SizedBox(height: 8),
        Segmented<bool>(options: const [(false, 'Leave them off'), (true, 'Back on')], value: _restore, onChanged: (v) => setState(() => _restore = v)),
        const SizedBox(height: 6),
        Text(_restore ? 'Only the ones that were on go back on.' : 'They stay off until someone switches them on.', style: TextStyle(fontSize: 12.5, color: c.mu)),
        const SizedBox(height: 16),
        BigButton(label: 'Save', icon: SbIcons.check, busy: _busy, onTap: _save),
      ],
    );
  }
}

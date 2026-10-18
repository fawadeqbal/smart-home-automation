import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_exception.dart';
import '../../core/theme/app_theme.dart';
import '../../core/theme/sb_colors.dart';
import '../../core/theme/sb_icons.dart';
import '../../core/util/format.dart';
import '../../data/models/json.dart';
import '../../data/models/people.dart';
import '../../data/repositories/people_repository.dart';
import '../../shared/widgets/common.dart';
import '../../shared/widgets/sb_chip.dart';
import '../../shared/widgets/sb_switch.dart';
import '../../shared/widgets/sheet.dart';
import '../../state/people.dart';
import '../../state/toast.dart';

/// A member's or guest's limits being edited: an end (on the phone's clock) and hours on some days
/// (the home's clock: "9:00 to 17:00").
@immutable
class LimitsDraft {
  const LimitsDraft({this.until, this.hours = false, this.from = const TimeOfDay(hour: 9, minute: 0), this.to = const TimeOfDay(hour: 17, minute: 0), this.days = const {}});

  factory LimitsDraft.of(AccessLimits? a) {
    if (a == null) return const LimitsDraft();
    TimeOfDay? t(String? hhmm) {
      final p = hhmm?.split(':');
      return p == null || p.length != 2 ? null : TimeOfDay(hour: int.tryParse(p[0]) ?? 0, minute: int.tryParse(p[1]) ?? 0);
    }

    return LimitsDraft(
      until: a.until,
      hours: a.hasHours,
      from: t(a.from) ?? const TimeOfDay(hour: 9, minute: 0),
      to: t(a.to) ?? const TimeOfDay(hour: 17, minute: 0),
      days: a.days.toSet(),
    );
  }

  final DateTime? until;
  final bool hours;
  final TimeOfDay from, to;

  /// 0 = Sunday … 6 = Saturday; empty = every day
  final Set<int> days;

  LimitsDraft copyWith({DateTime? until, bool clearUntil = false, bool? hours, TimeOfDay? from, TimeOfDay? to, Set<int>? days}) => LimitsDraft(
    until: clearUntil ? null : until ?? this.until,
    hours: hours ?? this.hours,
    from: from ?? this.from,
    to: to ?? this.to,
    days: days ?? this.days,
  );

  static String hhmm(TimeOfDay t) => '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';

  /// What the API takes (the end as an exact time, so it means the same in any time zone).
  Json get body => {
    'accessUntil': until?.toUtc().toIso8601String(),
    'accessFrom': hours ? hhmm(from) : null,
    'accessTo': hours ? hhmm(to) : null,
    'accessDays': (days.toList()..sort()),
  };

  bool get any => until != null || hours || days.isNotEmpty;

  /// "Until Sun 20:00 · 9:00–17:00 · Mon, Tue" — for the form's summary line.
  String get summary {
    final parts = [
      if (hours) '${hhmm(from)}–${hhmm(to)}',
      if (days.isNotEmpty) Fmt.days(days.toList()),
      if (until != null) 'until ${Fmt.when(until!)}',
    ];
    return parts.isEmpty ? 'Any time, no end' : parts.join(' · ');
  }
}

/// The fields: an end (quick picks or a date and time) and allowed hours and days.
class LimitsFields extends StatelessWidget {
  const LimitsFields({super.key, required this.value, required this.onChanged});
  final LimitsDraft value;
  final ValueChanged<LimitsDraft> onChanged;

  /// Monday first.
  static const _week = [1, 2, 3, 4, 5, 6, 0];

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final now = DateTime.now();
    DateTime day(int days, int hour) => DateTime(now.year, now.month, now.day + days, hour);
    final toSunday = (DateTime.sunday - now.weekday) % 7;
    final picks = <(String, DateTime)>[
      ('Tonight', day(0, 23)),
      ('Tomorrow', day(1, 20)),
      ('The weekend', day(toSunday == 0 ? 7 : toSunday, 20)),
      ('A week', day(7, 20)),
    ];
    Future<void> pickEnd() async {
      final d = await showDatePicker(
        context: context,
        firstDate: now,
        lastDate: now.add(const Duration(days: 730)),
        initialDate: value.until ?? now.add(const Duration(days: 1)),
      );
      if (d == null || !context.mounted) return;
      final t = await showTimePicker(context: context, initialTime: TimeOfDay.fromDateTime(value.until ?? day(0, 20)));
      if (t == null) return;
      onChanged(value.copyWith(until: DateTime(d.year, d.month, d.day, t.hour, t.minute)));
    }

    Future<void> pickTime(bool start) async {
      final t = await showTimePicker(context: context, initialTime: start ? value.from : value.to);
      if (t != null) onChanged(start ? value.copyWith(from: t) : value.copyWith(to: t));
    }

    Text label(String s) => Text(s, style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: c.mu));

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        label(value.until == null ? 'Until' : 'Until ${Fmt.when(value.until!)}'),
        const SizedBox(height: 8),
        Wrap(
          spacing: 6,
          runSpacing: 6,
          children: [
            for (final (name, at) in picks)
              SbChip(label: name, tone: ChipTone.amber, height: 34, selected: value.until == at, onTap: () => onChanged(value.copyWith(until: at))),
            SbChip(label: 'Pick…', tone: ChipTone.amber, height: 34, selected: value.until != null && !picks.any((p) => p.$2 == value.until), onTap: pickEnd),
            if (value.until != null) SbChip(label: 'No end', height: 34, selected: false, onTap: () => onChanged(value.copyWith(clearUntil: true))),
          ],
        ),
        const SizedBox(height: 14),
        Row(
          children: [
            Expanded(child: Text('Only at certain hours', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w500, color: c.tx))),
            SbSwitch(value: value.hours, onChanged: (v) => onChanged(value.copyWith(hours: v)), semanticLabel: 'Only at certain hours'),
          ],
        ),
        if (value.hours) ...[
          const SizedBox(height: 8),
          Row(
            children: [
              SbChip(label: 'From ${LimitsDraft.hhmm(value.from)}', height: 34, selected: true, tone: ChipTone.blue, onTap: () => pickTime(true)),
              const SizedBox(width: 6),
              SbChip(label: 'To ${LimitsDraft.hhmm(value.to)}', height: 34, selected: true, tone: ChipTone.blue, onTap: () => pickTime(false)),
            ],
          ),
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Text('In the home’s time. 22:00 to 06:00 goes past midnight.', style: TextStyle(fontSize: 12.5, color: c.mu)),
          ),
        ],
        const SizedBox(height: 14),
        label(value.days.isEmpty ? 'Days (every day)' : 'Days'),
        const SizedBox(height: 8),
        Wrap(
          spacing: 6,
          runSpacing: 6,
          children: [
            for (final d in _week)
              SbChip(
                label: Fmt.dayShort[d],
                height: 34,
                selected: value.days.contains(d),
                onTap: () => onChanged(value.copyWith(days: value.days.contains(d) ? ({...value.days}..remove(d)) : {...value.days, d})),
              ),
          ],
        ),
      ],
    );
  }
}

Future<void> showAccessSheet(BuildContext context, Member member) =>
    showSbSheet<void>(context, builder: (_) => AccessSheet(member: member));

/// Family → a person → their hours and end: change, extend, lift, or remove them.
class AccessSheet extends ConsumerStatefulWidget {
  const AccessSheet({super.key, required this.member});
  final Member member;

  @override
  ConsumerState<AccessSheet> createState() => _AccessSheetState();
}

class _AccessSheetState extends ConsumerState<AccessSheet> {
  late LimitsDraft _draft = LimitsDraft.of(widget.member.access);
  bool _busy = false;
  String? _error;

  Future<void> _save(Json body) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(peopleRepositoryProvider).setLimits(widget.member.id, body);
      ref.invalidate(membersProvider);
      if (mounted) Navigator.of(context).pop();
      ref.read(toastProvider.notifier).show('Saved');
    } catch (e) {
      setState(() => _error = ApiException.from(e).message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _remove() async {
    final name = widget.member.name.split(' ').first;
    final yes = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Remove $name?'),
        content: const Text('They can no longer open this home.'),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.of(ctx).pop(true), child: const Text('Remove')),
        ],
      ),
    );
    if (yes != true) return;
    try {
      await ref.read(peopleRepositoryProvider).remove(widget.member.id);
      ref.invalidate(membersProvider);
      if (mounted) Navigator.of(context).pop();
      ref.read(toastProvider.notifier).show('$name was removed');
    } catch (e) {
      setState(() => _error = ApiException.from(e).message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final m = widget.member;
    final expired = m.access?.status == AccessStatus.expired;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(child: Text(expired ? 'Extend ${m.name.split(' ').first}' : '${m.name.split(' ').first}’s access', style: SbText.title.copyWith(color: c.tx))),
            RoundButton(icon: SbIcons.x, label: 'Close', onTap: () => Navigator.of(context).pop()),
          ],
        ),
        const SizedBox(height: 6),
        Text(
          expired
              ? 'Their access has ended. Pick a new end, or no end, to let them in again.'
              : 'Outside these hours they can open the app but can’t see or switch anything.',
          style: TextStyle(fontSize: 14, color: c.mu),
        ),
        const SizedBox(height: 16),
        LimitsFields(value: _draft, onChanged: (v) => setState(() => _draft = v)),
        if (_error != null)
          Padding(padding: const EdgeInsets.only(top: 12), child: Note(tone: NoteTone.bad, icon: SbIcons.warning, child: Text(_error!))),
        const SizedBox(height: 16),
        BigButton(label: 'Save', busy: _busy, onTap: () => _save(_draft.body)),
        if (m.access != null) ...[
          const SizedBox(height: 8),
          TextButton(
            onPressed: _busy ? null : () => _save(const LimitsDraft().body),
            child: Text('Any time, no end', style: TextStyle(color: c.acText, fontWeight: FontWeight.w600)),
          ),
        ],
        TextButton(
          onPressed: _busy ? null : _remove,
          child: Text('Remove from the home', style: TextStyle(color: c.badText, fontWeight: FontWeight.w600)),
        ),
      ],
    );
  }
}

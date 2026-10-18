import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../core/network/api_exception.dart';
import '../../core/theme/app_theme.dart';
import '../../core/theme/sb_colors.dart';
import '../../core/theme/sb_icons.dart';
import '../../data/models/energy.dart';
import '../../data/models/power.dart';
import '../../data/repositories/home_repository.dart';
import '../../shared/widgets/common.dart';
import '../../shared/widgets/sheet.dart';
import '../../state/people.dart';
import '../../state/session.dart';
import '../../state/toast.dart';
import '../auth/auth_widgets.dart';

/// Electricity: the bill this month from the meter readings (owners and admins), load-shedding times,
/// and this week's estimate per switch. Opened from Home (the power card) or Me.
class EnergyScreen extends ConsumerWidget {
  const EnergyScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final manages = ref.watch(meProvider.select((m) => m.home?.manages ?? false));
    return RefreshIndicator(
      color: context.sb.on,
      onRefresh: () async {
        ref.invalidate(billProvider);
        ref.invalidate(readingsProvider);
        ref.invalidate(sheddingProvider);
        ref.invalidate(powerStatusProvider);
        ref.invalidate(homeEnergyProvider);
      },
      child: ListView(
        padding: EdgeInsets.fromLTRB(18, MediaQuery.paddingOf(context).top + 4, 18, 130),
        children: [
          BackPill(onTap: () => context.pop()),
          const SizedBox(height: 12),
          const PageTitle('Electricity', subtitle: 'Your bill, load-shedding times and what uses the most.'),
          const SizedBox(height: 18),
          const _UpsNow(),
          if (manages) ...[const _BillCard(), const SizedBox(height: 18)],
          const _SheddingCard(),
          const SizedBox(height: 18),
          const _EstimateCard(),
        ],
      ),
    );
  }
}

class _UpsNow extends ConsumerWidget {
  const _UpsNow();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final p = ref.watch(powerStatusProvider).value;
    if (p == null || !p.gridOff) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: 18),
      child: Note(tone: NoteTone.warn, icon: SbIcons.zap, child: Text('${p.headline}. ${p.detail}')),
    );
  }
}

String _units(double n) => n < 10 ? n.toStringAsFixed(1) : n.round().toString();

class _BillCard extends ConsumerWidget {
  const _BillCard();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.sb;
    final bill = ref.watch(billProvider);
    final b = bill.value;
    if (b == null) {
      return bill.hasError ? ErrorView(error: bill.error!, onRetry: () => ref.invalidate(billProvider)) : const LoadingView(label: 'Adding up the bill…');
    }
    final readings = ref.watch(readingsProvider).value ?? const [];
    final limit = b.protectedLimit;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SectionHeader('Bill this month', subtitle: 'Since the ${b.billingDayText} · ${b.daysLeft} days to go', action: 'Billing day', onAction: () => _billingDay(context, ref, b)),
        const SizedBox(height: 10),
        Note(tone: b.warn ? NoteTone.bad : NoteTone.info, icon: b.warn ? SbIcons.warning : SbIcons.zap, child: Text(b.message)),
        const SizedBox(height: 10),
        GroupCard(
          radius: 22,
          children: [
            Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    children: [
                      Expanded(child: _Big(value: _units(b.units), unit: 'units so far', note: b.unitsNote)),
                      Expanded(child: _Big(value: b.projected == null ? '–' : '~${b.projected!.round()}', unit: 'by the ${b.billingDayText}', note: 'at this pace')),
                    ],
                  ),
                  const SizedBox(height: 12),
                  Text(
                    b.costProjected != null
                        ? 'Bill about ${Energy.rupees(b.costProjected!)} at this pace (${Energy.rupees(b.costSoFar)} so far)'
                        : 'Bill so far about ${Energy.rupees(b.costSoFar)}',
                    style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: c.tx),
                  ),
                  if (limit != null) ...[
                    const SizedBox(height: 12),
                    _LimitBar(now: b.limitShare, end: b.limitShareEnd, over: b.over),
                    const SizedBox(height: 6),
                    Text('Protected limit: $limit units. Staying at or below it keeps the cheaper rate.', style: TextStyle(fontSize: 12.5, color: c.mu)),
                  ],
                  if (b.topDevices.isNotEmpty) ...[
                    const SizedBox(height: 10),
                    Text('Most used (estimates): ${b.topDevices.take(3).map((d) => '${d.$1} ~${_units(d.$2)}').join(' · ')}', style: TextStyle(fontSize: 13, color: c.mu)),
                  ],
                ],
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        BigButton(label: 'Add a meter reading', icon: SbIcons.plus, height: 50, onTap: () => _addReading(context, ref, null)),
        if (readings.isNotEmpty) ...[
          const SizedBox(height: 12),
          GroupCard(
            radius: 22,
            children: [
              for (final r in readings.take(6))
                InkWell(
                  onTap: () => _addReading(context, ref, r),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                    child: Row(
                      children: [
                        Expanded(
                          child: Text('${_units(r.kwh)} kWh${r.newMeter ? ' · new meter' : ''}', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w500, color: c.tx)),
                        ),
                        Text(DateFormat('EEE d MMM').format(r.readAt), style: TextStyle(fontSize: 13, color: c.mu)),
                        const SizedBox(width: 6),
                        SbIcon(SbIcons.caretRight, size: 14, color: c.mu),
                      ],
                    ),
                  ),
                ),
            ],
          ),
        ],
      ],
    );
  }
}

class _Big extends StatelessWidget {
  const _Big({required this.value, required this.unit, required this.note});
  final String value, unit, note;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(value, style: TextStyle(fontSize: 28, fontWeight: FontWeight.w600, letterSpacing: -.8, color: c.tx)),
        Text(unit, style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w500, color: c.tx)),
        Text(note, style: TextStyle(fontSize: 12, color: c.mu)),
      ],
    );
  }
}

class _LimitBar extends StatelessWidget {
  const _LimitBar({required this.now, required this.end, required this.over});
  final double now, end;
  final bool over;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    return ClipRRect(
      borderRadius: BorderRadius.circular(99),
      child: SizedBox(
        height: 10,
        child: Stack(
          children: [
            Container(color: c.sf2),
            FractionallySizedBox(widthFactor: end, child: Container(color: c.ac.withValues(alpha: .3))),
            FractionallySizedBox(widthFactor: now, child: Container(color: over ? c.bad : c.ac)),
          ],
        ),
      ),
    );
  }
}

Future<void> _addReading(BuildContext context, WidgetRef ref, MeterReading? reading) =>
    showSbSheet<void>(context, builder: (_) => _ReadingSheet(reading: reading));

class _ReadingSheet extends ConsumerStatefulWidget {
  const _ReadingSheet({this.reading});
  final MeterReading? reading;

  @override
  ConsumerState<_ReadingSheet> createState() => _ReadingSheetState();
}

class _ReadingSheetState extends ConsumerState<_ReadingSheet> {
  late final _kwh = TextEditingController(text: widget.reading == null ? '' : _units(widget.reading!.kwh));
  bool _newMeter = false, _busy = false;
  String? _error;

  @override
  void dispose() {
    _kwh.dispose();
    super.dispose();
  }

  Future<void> _run(Future<Bill> Function(HomeRepository repo) call, String done) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await call(ref.read(homeRepositoryProvider));
      ref.invalidate(billProvider);
      ref.invalidate(readingsProvider);
      if (mounted) Navigator.of(context).pop();
      ref.read(toastProvider.notifier).show(done);
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = ApiException.from(e).message;
          _busy = false;
        });
      }
    }
  }

  void _save() {
    final kwh = double.tryParse(_kwh.text.trim());
    if (kwh == null || kwh < 0) {
      setState(() => _error = 'Type the number on the meter (kWh), e.g. 12345.');
      return;
    }
    final r = widget.reading;
    _run(
      (repo) => r == null ? repo.addReading(kwh, DateTime.now(), newMeter: _newMeter) : repo.updateReading(r.id, kwh),
      r == null ? 'Reading saved' : 'Reading changed',
    );
  }

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final r = widget.reading;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(r == null ? 'Add a meter reading' : 'Reading of ${DateFormat('d MMM').format(r.readAt)}', style: SbText.title.copyWith(color: c.tx)),
        const SizedBox(height: 4),
        Text('The kWh number on your electricity meter, as it shows now.', style: TextStyle(fontSize: 14.5, color: c.mu)),
        const SizedBox(height: 16),
        LabeledField(
          label: 'Meter reading (kWh)',
          controller: _kwh,
          icon: SbIcons.zap,
          hint: 'e.g. 12345',
          autofocus: true,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          textInputAction: TextInputAction.done,
          onSubmitted: (_) => _save(),
        ),
        if (r == null)
          CheckboxListTile(
            contentPadding: EdgeInsets.zero,
            value: _newMeter,
            onChanged: (v) => setState(() => _newMeter = v ?? false),
            title: Text('The meter was replaced', style: TextStyle(fontSize: 14.5, color: c.tx)),
            subtitle: Text('A new meter starts from its own number', style: TextStyle(fontSize: 12.5, color: c.mu)),
          ),
        if (_error != null) ...[
          const SizedBox(height: 12),
          Note(tone: NoteTone.bad, icon: SbIcons.warning, child: Text(_error!)),
        ],
        const SizedBox(height: 16),
        BigButton(label: 'Save', icon: SbIcons.check, busy: _busy, onTap: _save),
        if (r != null) ...[
          const SizedBox(height: 10),
          BigButton(
            label: 'Delete this reading',
            icon: SbIcons.trash,
            color: c.badSoft,
            foreground: c.badText,
            height: 50,
            onTap: _busy ? null : () => _run((repo) => repo.removeReading(r.id), 'Reading deleted'),
          ),
        ],
      ],
    );
  }
}

Future<void> _billingDay(BuildContext context, WidgetRef ref, Bill b) async {
  final controller = TextEditingController(text: '${b.billingDay}');
  await showSbSheet<void>(
    context,
    builder: (ctx) {
      final c = ctx.sb;
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Billing day', style: SbText.title.copyWith(color: c.tx)),
          const SizedBox(height: 4),
          Text('The day of the month the meter reader comes. Rates and slabs are set on the web app.', style: TextStyle(fontSize: 14.5, color: c.mu)),
          const SizedBox(height: 16),
          LabeledField(
            label: 'Day of the month (1–31)',
            controller: controller,
            icon: SbIcons.clock,
            keyboardType: TextInputType.number,
            autofocus: true,
          ),
          const SizedBox(height: 16),
          BigButton(
            label: 'Save',
            icon: SbIcons.check,
            onTap: () async {
              final day = int.tryParse(controller.text.trim());
              try {
                if (day == null) throw const ApiException(400, 'The billing day is a day of the month, 1 to 31.');
                await ref.read(homeRepositoryProvider).setBillingDay(day);
                ref.invalidate(billProvider);
                if (ctx.mounted) Navigator.of(ctx).pop();
              } catch (e) {
                ref.read(toastProvider.notifier).show(ApiException.from(e).message, error: true);
              }
            },
          ),
        ],
      );
    },
  );
  controller.dispose();
}

/// The day as 48 half hours: darker where the power went on more of the last 14 days.
class DayStrip extends StatelessWidget {
  const DayStrip({super.key, required this.slots});
  final List<int> slots;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final max = slots.fold<int>(1, (a, b) => b > a ? b : a);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Semantics(
          label: 'Power cuts by time of day, last two weeks',
          child: ClipRRect(
            borderRadius: BorderRadius.circular(6),
            child: SizedBox(
              height: 24,
              child: Row(
                children: [
                  for (final n in slots.isEmpty ? List.filled(48, 0) : slots)
                    Expanded(
                      child: Container(
                        margin: const EdgeInsets.only(right: 1),
                        color: n == 0 ? c.sf2 : c.bad.withValues(alpha: .25 + .75 * n / max),
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

class _SheddingCard extends ConsumerWidget {
  const _SheddingCard();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.sb;
    final s = ref.watch(sheddingProvider).value;
    if (s == null || !s.loaded) return const SizedBox.shrink();
    final shown = s.source == 'typed' ? s.typed : s.learned;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SectionHeader('Load-shedding times'),
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
                  Text(s.how, style: TextStyle(fontSize: 13, color: c.mu)),
                  const SizedBox(height: 12),
                  DayStrip(slots: s.slots),
                  for (final w in shown)
                    Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: Text('• ${w.text}', style: TextStyle(fontSize: 14, color: c.tx)),
                    ),
                  const SizedBox(height: 10),
                  Text(
                    'Your area’s schedule from the SMS can be typed in on the web app. For a heads-up 15 minutes before, turn on “Load-shedding is due” in notifications.',
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

class _EstimateCard extends ConsumerWidget {
  const _EstimateCard();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.sb;
    final e = ref.watch(homeEnergyProvider).value;
    if (e == null || !e.loaded) return const SizedBox.shrink();
    final rows = e.devices.where((d) => d.hours > 0).take(8).toList();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SectionHeader('This week, by switch', subtitle: 'About ${Energy.units(e.kwh)} units, ${Energy.rupees(e.cost)} (estimate)'),
        const SizedBox(height: 10),
        GroupCard(
          radius: 22,
          children: [
            if (rows.isEmpty)
              Padding(padding: const EdgeInsets.all(16), child: Text('Nothing was on this week.', style: TextStyle(color: c.mu))),
            for (final d in rows)
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                child: Row(
                  children: [
                    Expanded(child: Text(d.name, style: TextStyle(fontSize: 15, fontWeight: FontWeight.w500, color: c.tx))),
                    Text('${Energy.units(d.kwh)} units · ${Energy.rupees(d.cost)}', style: TextStyle(fontSize: 13, color: c.mu)),
                  ],
                ),
              ),
          ],
        ),
      ],
    );
  }
}

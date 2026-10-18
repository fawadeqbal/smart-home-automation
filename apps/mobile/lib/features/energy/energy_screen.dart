import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:share_plus/share_plus.dart';

import '../../core/routing/routes.dart';
import '../../core/theme/sb_colors.dart';
import '../../core/theme/sb_icons.dart';
import '../../data/models/energy.dart';
import '../../data/models/power.dart';
import '../../shared/widgets/common.dart';
import '../../shared/widgets/pressable.dart';
import '../../shared/widgets/segmented.dart';
import '../../state/money.dart';
import '../../state/people.dart';
import '../../state/session.dart';
import 'bill_section.dart';
import 'day_bars.dart';
import 'shedding_section.dart';

/// Electricity, like the web's /energy: the bill from the meter readings (owners and admins), what
/// the switches used (today, 7 or 30 days, by day and by device), the rate, load-shedding and UPS mode.
/// Opened from the Home card or Me.
class EnergyScreen extends ConsumerStatefulWidget {
  const EnergyScreen({super.key});

  @override
  ConsumerState<EnergyScreen> createState() => _EnergyScreenState();
}

class _EnergyScreenState extends ConsumerState<EnergyScreen> {
  int _days = 7;

  @override
  Widget build(BuildContext context) {
    final manages = ref.watch(meProvider.select((m) => m.home?.manages ?? false));
    return RefreshIndicator(
      color: context.sb.on,
      onRefresh: () async {
        ref.invalidate(billProvider);
        ref.invalidate(readingsProvider);
        ref.invalidate(sheddingProvider);
        ref.invalidate(powerStatusProvider);
        ref.invalidate(homeEnergyProvider);
        ref.invalidate(energyForProvider);
        ref.invalidate(gridProvider);
      },
      child: ListView(
        padding: EdgeInsets.fromLTRB(18, MediaQuery.paddingOf(context).top + 4, 18, 130),
        children: [
          BackPill(onTap: () => context.pop()),
          const SizedBox(height: 12),
          const PageTitle('Electricity', subtitle: 'What you use, what it costs, and when the power goes.'),
          const SizedBox(height: 18),
          const _UpsNow(),
          if (manages) ...[BillSection(canEdit: manages), const SizedBox(height: 26)],
          _Usage(days: _days, onDays: (d) => setState(() => _days = d), canEdit: manages),
          const SizedBox(height: 22),
          _Rate(canEdit: manages),
          const SizedBox(height: 12),
          const _HowItWorks(),
          const SizedBox(height: 26),
          SheddingSection(canEdit: manages),
          if (manages) UpsSection(canEdit: manages),
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

/// What the switches used in the picked stretch: the total, a month at this pace, the days, the devices.
class _Usage extends ConsumerWidget {
  const _Usage({required this.days, required this.onDays, required this.canEdit});
  final int days;
  final ValueChanged<int> onDays;
  final bool canEdit;

  static String periodText(int days) => days == 1 ? 'today' : 'last $days days';

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.sb;
    final energy = ref.watch(energyForProvider(days));
    final home = ref.watch(meProvider.select((m) => m.home?.name ?? 'Home'));
    final e = energy.value;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SectionHeader('What uses it', subtitle: 'An estimate from the switches — your meter is the real number'),
        const SizedBox(height: 12),
        Segmented<int>(options: const [(1, 'Today'), (7, '7 days'), (30, '30 days')], value: days, onChanged: onDays),
        const SizedBox(height: 12),
        if (e == null)
          energy.hasError
              ? ErrorView(error: energy.error!, onRetry: () => ref.invalidate(energyForProvider(days)))
              : const LoadingView(label: 'Adding it up…')
        else ...[
          GroupCard(
            radius: 22,
            children: [
              Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(child: BigFigure(value: Energy.units(e.kwh), unit: 'units ${periodText(days)}', note: '${Energy.hoursText(e.hours)} of switches on')),
                        const SizedBox(width: 12),
                        Expanded(child: BigFigure(value: Energy.rupees(e.cost), unit: 'about', note: 'at ${Energy.rate(e.tariff)} a unit')),
                      ],
                    ),
                    const SizedBox(height: 12),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                      decoration: BoxDecoration(color: c.sf2, borderRadius: BorderRadius.circular(14)),
                      child: Row(
                        children: [
                          SbIcon(SbIcons.pulse, size: 16, color: c.okText),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Text(
                              'A month at this pace: ~${Energy.units(e.monthKwh.toDouble())} units, about ${Energy.rupees(e.monthCost)}',
                              style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w500, color: c.tx),
                            ),
                          ),
                        ],
                      ),
                    ),
                    if (days > 1 && e.perDay.isNotEmpty) ...[
                      const SizedBox(height: 18),
                      DayBars(days: e.perDay),
                    ],
                    if (e.powerCuts > 0) ...[
                      const SizedBox(height: 10),
                      Text(
                        '${e.powerCuts} power cut${e.powerCuts == 1 ? '' : 's'} in this time ${e.powerCuts == 1 ? 'is' : 'are'} left out: nothing runs without power.',
                        style: TextStyle(fontSize: 12.5, color: c.mu),
                      ),
                    ],
                    const SizedBox(height: 14),
                    BigButton(
                      label: 'Share on WhatsApp',
                      icon: SbIcons.share,
                      height: 46,
                      color: c.sf2,
                      foreground: c.tx,
                      onTap: () => SharePlus.instance.share(ShareParams(text: e.shareText(home, periodText(days)))),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 18),
          SectionHeader(
            'By device',
            subtitle: e.unknown > 0
                ? '${e.unknown} without a power rating count as 0${canEdit ? ' — set them below' : ''}'
                : 'Tap one to see it',
          ),
          const SizedBox(height: 10),
          if (e.devices.isEmpty)
            const EmptyView(icon: SbIcons.zap, title: 'No switches to count yet')
          else
            GroupCard(radius: 22, children: [for (final d in e.devices) _DeviceRow(d: d, top: e.devices.first.kwh, total: e.kwh, canEdit: canEdit)]),
        ],
      ],
    );
  }
}

class _DeviceRow extends StatelessWidget {
  const _DeviceRow({required this.d, required this.top, required this.total, required this.canEdit});
  final EnergyDevice d;
  final double top, total;
  final bool canEdit;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final share = d.shareOf(total);
    final meter = top <= 0 ? 0.0 : (d.kwh / top).clamp(0.0, 1.0);
    return InkWell(
      onTap: d.id.isEmpty ? null : () => context.openInTab(Routes.deviceOf(d.id)),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(
                  child: Row(
                    children: [
                      Flexible(
                        child: Text(d.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: c.tx)),
                      ),
                      if (d.onNow) ...[
                        const SizedBox(width: 8),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                          decoration: BoxDecoration(color: c.okSoft, borderRadius: BorderRadius.circular(99)),
                          child: Text('On', style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w600, color: c.okText)),
                        ),
                      ],
                    ],
                  ),
                ),
                const SizedBox(width: 10),
                Text(Energy.rupees(d.cost), style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: c.tx)),
              ],
            ),
            const SizedBox(height: 7),
            ClipRRect(
              borderRadius: BorderRadius.circular(99),
              child: SizedBox(
                height: 6,
                child: Stack(
                  fit: StackFit.expand,
                  children: [
                    ColoredBox(color: c.sf2),
                    FractionallySizedBox(alignment: Alignment.centerLeft, widthFactor: meter, child: ColoredBox(color: c.on)),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 6),
            Row(
              children: [
                Expanded(
                  child: Text(
                    [
                      ?d.room,
                      '${Energy.hoursText(d.hours)} on',
                      '${Energy.units(d.kwh)} units',
                      if (share >= .005) '${(share * 100).round()}%',
                      d.wattsText,
                    ].join(' · '),
                    style: TextStyle(fontSize: 12.5, color: d.wattsSource == 'unknown' ? c.onText : c.mu),
                  ),
                ),
                if (canEdit && d.id.isNotEmpty)
                  Pressable(
                    onTap: () => showWattsSheet(context, deviceId: d.id, name: d.name, watts: d.wattsSource == 'set' ? d.watts : null),
                    semanticLabel: 'Set the power of ${d.name}',
                    child: Padding(
                      padding: const EdgeInsets.only(left: 8),
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                        decoration: BoxDecoration(border: Border.all(color: c.ln2), borderRadius: BorderRadius.circular(99)),
                        child: Text(d.wattsSource == 'set' ? 'Watts' : 'Set power', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w500, color: c.acText)),
                      ),
                    ),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// The price in use: one rate, or the bands from the bill (owners and admins can change them).
class _Rate extends ConsumerWidget {
  const _Rate({required this.canEdit});
  final bool canEdit;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.sb;
    final bill = ref.watch(billProvider).value;
    final energy = ref.watch(homeEnergyProvider).value;
    final hasBill = bill != null && bill.loaded;
    final tariff = hasBill ? bill.tariff : energy?.tariff ?? 0;
    final set = hasBill ? bill.tariffSet : energy?.tariffSet ?? false;
    final bands = hasBill ? Slab.describe(bill.slabs) : const <String>[];
    if (!hasBill && (energy == null || !energy.loaded)) return const SizedBox.shrink();
    return GroupCard(
      radius: 22,
      children: [
        InkWell(
          onTap: canEdit && hasBill ? () => showRatesSheet(context, bill) : null,
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(color: c.acSoft, borderRadius: BorderRadius.circular(12)),
                  child: Center(child: SbIcon(SbIcons.zap, size: 18, color: c.acText)),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Your rate: ${Energy.rate(tariff)} a unit', style: TextStyle(fontSize: 15.5, fontWeight: FontWeight.w600, color: c.tx)),
                      Text(
                        set ? 'Set by the home’s owner' : 'A typical rate — ${canEdit ? 'set yours from your bill' : 'the owner can set yours'}',
                        style: TextStyle(fontSize: 13, color: c.mu),
                      ),
                      if (bands.isNotEmpty) ...[
                        const SizedBox(height: 8),
                        Text('The bill uses bands:', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w500, color: c.tx)),
                        for (final b in bands) Text('• $b', style: TextStyle(fontSize: 13, color: c.tx, height: 1.4)),
                      ],
                    ],
                  ),
                ),
                if (canEdit && hasBill) Padding(padding: const EdgeInsets.only(top: 10), child: SbIcon(SbIcons.caretRight, size: 16, color: c.mu)),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

/// "How estimates work", folded until asked.
class _HowItWorks extends StatefulWidget {
  const _HowItWorks();

  @override
  State<_HowItWorks> createState() => _HowItWorksState();
}

class _HowItWorksState extends State<_HowItWorks> {
  bool _open = false;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    const points = [
      'Each switch’s on-time comes from its history: when it was switched on and off, from the app, the wall, a timer or the assistant.',
      'Its power is the watts the owner set, or a guess from its name (a geyser 2000 W, an AC 1500 W, a fan 75 W, an LED bulb 15 W). Ones we can’t guess count as 0.',
      'Units = hours on × watts ÷ 1000. Rupees = units × your rate. Power cuts are left out: nothing runs without power.',
      'Things that aren’t on a switch (a fridge on its own plug) aren’t counted, so the meter usually reads more. The bill at the top uses your meter readings.',
    ];
    return Container(
      decoration: BoxDecoration(color: c.sf, borderRadius: BorderRadius.circular(18), border: Border.all(color: c.ln2)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          InkWell(
            borderRadius: BorderRadius.circular(18),
            onTap: () => setState(() => _open = !_open),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
              child: Row(
                children: [
                  SbIcon(SbIcons.sparkle, size: 17, color: c.mu),
                  const SizedBox(width: 10),
                  Expanded(child: Text('How the estimates work', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w500, color: c.tx))),
                  AnimatedRotation(turns: _open ? .5 : 0, duration: const Duration(milliseconds: 200), child: SbIcon(SbIcons.caretDown, size: 16, color: c.mu)),
                ],
              ),
            ),
          ),
          if (_open)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  for (final p in points)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: Text('• $p', style: TextStyle(fontSize: 13.5, color: c.tx, height: 1.4)),
                    ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

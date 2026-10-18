import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../core/network/api_exception.dart';
import '../../core/theme/app_theme.dart';
import '../../core/theme/sb_colors.dart';
import '../../core/theme/sb_icons.dart';
import '../../data/models/energy.dart';
import '../../data/models/power.dart';
import '../../data/repositories/devices_repository.dart';
import '../../data/repositories/home_repository.dart';
import '../../shared/widgets/common.dart';
import '../../shared/widgets/sb_switch.dart';
import '../../shared/widgets/sheet.dart';
import '../../state/devices.dart';
import '../../state/money.dart';
import '../../state/people.dart';
import '../../state/toast.dart';
import '../auth/auth_widgets.dart';

String _units(double n) => Energy.units(n);

/// The bill this month from the meter readings (owners and admins): where it's heading, the
/// protected limit, the readings, and the billing day and rates.
class BillSection extends ConsumerStatefulWidget {
  const BillSection({super.key, required this.canEdit});
  final bool canEdit;

  @override
  ConsumerState<BillSection> createState() => _BillSectionState();
}

class _BillSectionState extends ConsumerState<BillSection> {
  bool _all = false;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final bill = ref.watch(billProvider);
    final b = bill.value;
    if (b == null) {
      return bill.hasError ? ErrorView(error: bill.error!, onRetry: () => ref.invalidate(billProvider)) : const LoadingView(label: 'Adding up the bill…');
    }
    final readings = ref.watch(readingsProvider).value ?? const [];
    final limit = b.protectedLimit;
    final day = DateFormat('d MMM');
    final range = b.cycleStart != null && b.cycleEnd != null ? '${day.format(b.cycleStart!)} – ${day.format(b.cycleEnd!)} · ' : 'Since the ${b.billingDayText} · ';
    final shown = _all ? readings : readings.take(4).toList();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SectionHeader(
          'Bill this month',
          subtitle: '$range${b.daysLeft} day${b.daysLeft == 1 ? '' : 's'} to go',
          action: widget.canEdit ? 'Rates' : null,
          onAction: () => showRatesSheet(context, b),
        ),
        const SizedBox(height: 10),
        if (b.message.isNotEmpty) ...[
          Note(tone: b.warn ? NoteTone.bad : NoteTone.info, icon: b.warn ? SbIcons.warning : SbIcons.zap, child: Text(b.message)),
          const SizedBox(height: 10),
        ],
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
                      Expanded(child: BigFigure(value: _units(b.units), unit: 'units so far', note: b.unitsNote)),
                      const SizedBox(width: 12),
                      Expanded(
                        child: BigFigure(
                          value: b.projected == null ? '–' : '~${_units(b.projected!)}',
                          unit: 'by the ${b.billingDayText}',
                          note: 'at this pace',
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 14),
                  Text(
                    b.costProjected != null
                        ? 'Bill about ${Energy.rupees(b.costProjected!)} at this pace (${Energy.rupees(b.costSoFar)} so far)'
                        : 'Bill so far about ${Energy.rupees(b.costSoFar)}',
                    style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: c.tx),
                  ),
                  if (limit != null) ...[
                    const SizedBox(height: 12),
                    LimitBar(now: b.limitShare, end: b.limitShareEnd, over: b.over),
                    const SizedBox(height: 6),
                    Text('Protected limit: $limit units. Staying at or below it keeps the cheaper rate.', style: TextStyle(fontSize: 12.5, color: c.mu)),
                  ],
                  if (b.topDevices.isNotEmpty) ...[
                    const SizedBox(height: 10),
                    Text(
                      'Most used this month (estimates): ${b.topDevices.take(3).map((d) => '${d.$1} ~${_units(d.$2)}').join(' · ')}',
                      style: TextStyle(fontSize: 13, color: c.mu),
                    ),
                  ],
                  if (b.lastMonth != null) ...[
                    const SizedBox(height: 4),
                    Text('Last month: ${_units(b.lastMonth!)} units.', style: TextStyle(fontSize: 13, color: c.mu)),
                  ],
                ],
              ),
            ),
          ],
        ),
        const SizedBox(height: 18),
        SectionHeader(
          'Meter readings',
          subtitle: readings.isEmpty ? 'The kWh number on your meter' : 'Tap one to change it',
          action: readings.length > 4 ? (_all ? 'Fewer' : 'All ${readings.length}') : null,
          onAction: () => setState(() => _all = !_all),
        ),
        const SizedBox(height: 10),
        if (readings.isEmpty)
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: Text(
              'None yet. Type the kWh number on your meter, and again whenever you like — the meter reader’s day is the most useful.',
              style: TextStyle(fontSize: 14, color: c.mu),
            ),
          )
        else ...[
          GroupCard(
            radius: 22,
            children: [
              for (final r in shown)
                InkWell(
                  onTap: widget.canEdit ? () => showReadingSheet(context, r) : null,
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                    child: Row(
                      children: [
                        Expanded(
                          child: Text.rich(
                            TextSpan(children: [
                              TextSpan(text: _units(r.kwh), style: const TextStyle(fontWeight: FontWeight.w600)),
                              const TextSpan(text: ' kWh'),
                              if (r.newMeter) TextSpan(text: ' · new meter', style: TextStyle(color: c.acText)),
                            ]),
                            style: TextStyle(fontSize: 15, color: c.tx),
                          ),
                        ),
                        Text(
                          '${DateFormat('EEE d MMM').format(r.readAt)}${r.by != null ? ' · ${r.by!.split(' ').first}' : ''}',
                          style: TextStyle(fontSize: 13, color: c.mu),
                        ),
                        if (widget.canEdit) ...[
                          const SizedBox(width: 6),
                          SbIcon(SbIcons.caretRight, size: 14, color: c.mu),
                        ],
                      ],
                    ),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 10),
        ],
        if (widget.canEdit)
          BigButton(label: 'Add a meter reading', icon: SbIcons.plus, height: 50, onTap: () => showReadingSheet(context, null)),
      ],
    );
  }
}

/// A big number with its unit and a note under it ("151 / units so far / from your meter readings").
class BigFigure extends StatelessWidget {
  const BigFigure({super.key, required this.value, required this.unit, this.note});
  final String value, unit;
  final String? note;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        FittedBox(
          fit: BoxFit.scaleDown,
          alignment: Alignment.centerLeft,
          child: Text(value, maxLines: 1, style: TextStyle(fontSize: 28, fontWeight: FontWeight.w600, letterSpacing: -.8, color: c.tx)),
        ),
        Text(unit, style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w500, color: c.tx)),
        if (note != null) Text(note!, style: TextStyle(fontSize: 12, color: c.mu)),
      ],
    );
  }
}

/// How far through the protected limit: now (solid) and at this pace (light).
class LimitBar extends StatelessWidget {
  const LimitBar({super.key, required this.now, required this.end, required this.over});
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
          fit: StackFit.expand,
          children: [
            ColoredBox(color: c.sf2),
            FractionallySizedBox(alignment: Alignment.centerLeft, widthFactor: end, child: ColoredBox(color: c.ac.withValues(alpha: .3))),
            FractionallySizedBox(alignment: Alignment.centerLeft, widthFactor: now, child: ColoredBox(color: over ? c.bad : c.ac)),
          ],
        ),
      ),
    );
  }
}

// ------------------------------------------------------------------ a meter reading

Future<void> showReadingSheet(BuildContext context, MeterReading? reading) =>
    showSbSheet<void>(context, builder: (_) => _ReadingSheet(reading: reading));

class _ReadingSheet extends ConsumerStatefulWidget {
  const _ReadingSheet({this.reading});
  final MeterReading? reading;

  @override
  ConsumerState<_ReadingSheet> createState() => _ReadingSheetState();
}

class _ReadingSheetState extends ConsumerState<_ReadingSheet> {
  late final _kwh = TextEditingController(text: widget.reading == null ? '' : widget.reading!.kwh.toStringAsFixed(widget.reading!.kwh % 1 == 0 ? 0 : 1));
  late bool _newMeter = widget.reading?.newMeter ?? false;
  late DateTime _day = widget.reading?.readAt ?? DateTime.now();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _kwh.dispose();
    super.dispose();
  }

  bool _sameDay(DateTime a, DateTime b) => a.year == b.year && a.month == b.month && a.day == b.day;

  /// Today: right now. Another day: midday (the meter reader comes in the day). Unchanged: as it was.
  DateTime get _readAt {
    final r = widget.reading;
    if (r != null && _sameDay(r.readAt, _day)) return r.readAt;
    if (r == null && _sameDay(_day, DateTime.now())) return DateTime.now();
    return DateTime(_day.year, _day.month, _day.day, 12);
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
    final kwh = double.tryParse(_kwh.text.trim().replaceAll(',', ''));
    if (kwh == null || kwh < 0) {
      setState(() => _error = 'Type the number on the meter (kWh), e.g. 12345.');
      return;
    }
    final r = widget.reading;
    _run(
      (repo) => r == null
          ? repo.addReading(kwh, _readAt, newMeter: _newMeter)
          : repo.updateReading(r.id, kwh, readAt: _readAt, newMeter: _newMeter),
      r == null ? 'Reading saved' : 'Reading changed',
    );
  }

  Future<void> _pickDay() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _day.isAfter(now) ? now : _day,
      firstDate: now.subtract(const Duration(days: 400)),
      lastDate: now,
      helpText: 'Read on',
    );
    if (picked != null) setState(() => _day = picked);
  }

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final r = widget.reading;
    final today = _sameDay(_day, DateTime.now());
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(r == null ? 'Add a meter reading' : 'Change the reading', style: SbText.title.copyWith(color: c.tx)),
        const SizedBox(height: 4),
        Text('The kWh number on your electricity meter (the number the meter reader writes down).', style: TextStyle(fontSize: 14.5, color: c.mu)),
        const SizedBox(height: 16),
        LabeledField(
          label: 'Meter reading (kWh)',
          controller: _kwh,
          icon: SbIcons.zap,
          hint: 'e.g. 12345',
          autofocus: r == null,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          textInputAction: TextInputAction.done,
          onSubmitted: (_) => _save(),
        ),
        const SizedBox(height: 12),
        Text('Read on', style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w500, color: c.tx)),
        const SizedBox(height: 7),
        OutlinedButton.icon(
          onPressed: _pickDay,
          icon: SbIcon(SbIcons.clock, size: 16, color: c.tx),
          label: Text(today ? 'Today' : DateFormat('EEEE d MMMM').format(_day)),
          style: OutlinedButton.styleFrom(
            foregroundColor: c.tx,
            alignment: Alignment.centerLeft,
            minimumSize: const Size.fromHeight(50),
            side: BorderSide(color: c.ln2),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
            textStyle: const TextStyle(fontFamily: SbFonts.sans, fontSize: 15.5, fontWeight: FontWeight.w500),
          ),
        ),
        CheckboxListTile(
          contentPadding: EdgeInsets.zero,
          value: _newMeter,
          onChanged: (v) => setState(() => _newMeter = v ?? false),
          title: Text('The meter was replaced', style: TextStyle(fontSize: 14.5, color: c.tx)),
          subtitle: Text('A new meter starts from its own number', style: TextStyle(fontSize: 12.5, color: c.mu)),
        ),
        if (_error != null) ...[
          const SizedBox(height: 8),
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

// ------------------------------------------------------------------ rates and the billing day

Future<void> showRatesSheet(BuildContext context, Bill bill) =>
    showSbSheet<void>(context, builder: (_) => _RatesSheet(bill: bill));

class _SlabRow {
  _SlabRow(Slab s)
      : upTo = TextEditingController(text: s.upTo?.toString() ?? ''),
        rate = TextEditingController(text: s.rate > 0 ? _plain(s.rate) : '');
  final TextEditingController upTo, rate;
  void dispose() {
    upTo.dispose();
    rate.dispose();
  }
}

String _plain(double v) => v == v.roundToDouble() ? '${v.round()}' : '$v';

/// The price of a unit (or the bands from the bill), the billing day and the protected limit.
class _RatesSheet extends ConsumerStatefulWidget {
  const _RatesSheet({required this.bill});
  final Bill bill;

  @override
  ConsumerState<_RatesSheet> createState() => _RatesSheetState();
}

class _RatesSheetState extends ConsumerState<_RatesSheet> {
  late final _tariff = TextEditingController(text: widget.bill.tariffSet ? _plain(widget.bill.tariff) : '');
  late final _day = TextEditingController(text: '${widget.bill.billingDay}');
  late final _limit = TextEditingController(text: '${widget.bill.protectedLimit ?? 200}');
  late final List<_SlabRow> _slabs = [for (final s in widget.bill.slabs) _SlabRow(s)];
  late bool _useLimit = widget.bill.protectedLimit != null;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    for (final c in [_tariff, _day, _limit]) {
      c.dispose();
    }
    for (final s in _slabs) {
      s.dispose();
    }
    super.dispose();
  }

  List<Slab> get _read => [
        for (final (i, s) in _slabs.indexed)
          Slab(upTo: i == _slabs.length - 1 ? null : int.tryParse(s.upTo.text.trim()), rate: double.tryParse(s.rate.text.trim()) ?? 0),
      ];

  void _addBand() {
    final next = Slab.addBand(_read, double.tryParse(_tariff.text.trim()) ?? widget.bill.tariff);
    setState(() {
      for (final s in _slabs) {
        s.dispose();
      }
      _slabs
        ..clear()
        ..addAll(next.map(_SlabRow.new));
    });
  }

  Future<void> _save() async {
    final day = int.tryParse(_day.text.trim());
    final tariffText = _tariff.text.trim();
    final tariff = tariffText.isEmpty ? null : double.tryParse(tariffText);
    final limit = int.tryParse(_limit.text.trim());
    final slabs = _read;
    final problem = day == null || day < 1 || day > 31
        ? 'The billing day is a day of the month, 1 to 31.'
        : tariffText.isNotEmpty && (tariff == null || tariff <= 0 || tariff >= 1000)
            ? 'Give the price of one unit in rupees, e.g. 55.'
            : _useLimit && (limit == null || limit < 10 || limit > 2000)
                ? 'The protected limit is between 10 and 2000 units.'
                : slabs.isEmpty
                    ? null
                    : Slab.problem(slabs);
    if (problem != null) {
      setState(() => _error = problem);
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final repo = ref.read(homeRepositoryProvider);
      if (tariff != (widget.bill.tariffSet ? widget.bill.tariff : null)) await repo.setTariff(tariff);
      await repo.setBill(billingDay: day!, slabs: slabs, protectedLimit: _useLimit ? limit : null);
      ref.invalidate(billProvider);
      ref.invalidate(energyForProvider);
      ref.invalidate(homeEnergyProvider);
      if (mounted) Navigator.of(context).pop();
      ref.read(toastProvider.notifier).show('Rates saved');
    } catch (e) {
      if (mounted) {
        setState(() {
          _busy = false;
          _error = ApiException.from(e).message;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final label = TextStyle(fontSize: 13.5, fontWeight: FontWeight.w500, color: c.tx);
    InputDecoration box(String hint) => InputDecoration(hintText: hint, isDense: true, contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12));
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('Rates and billing day', style: SbText.title.copyWith(color: c.tx)),
        const SizedBox(height: 4),
        Text('Look at your electricity bill: the total divided by the units gives your rate, taxes included.', style: TextStyle(fontSize: 14.5, color: c.mu)),
        const SizedBox(height: 16),
        LabeledField(
          label: 'Price of one unit (Rs per kWh)',
          controller: _tariff,
          icon: SbIcons.zap,
          hint: 'Typical: ${_plain(widget.bill.tariffSet ? 60 : widget.bill.tariff)}',
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
        ),
        const SizedBox(height: 4),
        Text('Empty: the typical rate. Used for the estimates, and for the bill when there are no bands below.', style: TextStyle(fontSize: 12.5, color: c.mu)),
        const SizedBox(height: 16),
        Text('Price bands, as on your bill', style: label),
        const SizedBox(height: 4),
        if (_slabs.isEmpty)
          Text('None: one price for every unit.', style: TextStyle(fontSize: 13.5, color: c.mu))
        else
          for (final (i, s) in _slabs.indexed)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Row(
                children: [
                  SizedBox(
                    width: 74,
                    child: Text(i == _slabs.length - 1 ? 'Above that' : 'Up to', style: TextStyle(fontSize: 14, color: c.mu)),
                  ),
                  if (i < _slabs.length - 1) ...[
                    SizedBox(
                      width: 72,
                      child: TextField(
                        controller: s.upTo,
                        keyboardType: TextInputType.number,
                        style: TextStyle(fontSize: 15, color: c.tx),
                        decoration: box('100'),
                      ),
                    ),
                    const SizedBox(width: 6),
                  ],
                  Text(i < _slabs.length - 1 ? 'units, Rs' : 'Rs', style: TextStyle(fontSize: 14, color: c.mu)),
                  const SizedBox(width: 6),
                  Expanded(
                    child: TextField(
                      controller: s.rate,
                      keyboardType: const TextInputType.numberWithOptions(decimal: true),
                      style: TextStyle(fontSize: 15, color: c.tx),
                      decoration: box('22'),
                    ),
                  ),
                  IconButton(
                    tooltip: 'Remove band',
                    onPressed: () => setState(() => _slabs.removeAt(i).dispose()),
                    icon: SbIcon(SbIcons.trash, size: 17, color: c.mu),
                  ),
                ],
              ),
            ),
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          children: [
            _SmallButton(label: 'Add a band', icon: SbIcons.plus, onTap: _addBand),
            if (_slabs.isNotEmpty)
              _SmallButton(
                label: 'One price for all',
                onTap: () => setState(() {
                  for (final s in _slabs) {
                    s.dispose();
                  }
                  _slabs.clear();
                }),
              ),
          ],
        ),
        const SizedBox(height: 16),
        LabeledField(label: 'Billing day (the day the meter reader comes)', controller: _day, icon: SbIcons.clock, keyboardType: TextInputType.number),
        const SizedBox(height: 14),
        Row(
          children: [
            Expanded(child: Text('Warn me before we pass the protected limit', style: label)),
            SbSwitch(value: _useLimit, semanticLabel: 'Protected limit', onChanged: (v) => setState(() => _useLimit = v)),
          ],
        ),
        if (_useLimit) ...[
          const SizedBox(height: 10),
          LabeledField(label: 'Protected limit (units a month)', controller: _limit, icon: SbIcons.shield, keyboardType: TextInputType.number),
        ],
        if (_error != null) ...[
          const SizedBox(height: 12),
          Note(tone: NoteTone.bad, icon: SbIcons.warning, child: Text(_error!)),
        ],
        const SizedBox(height: 16),
        BigButton(label: 'Save', icon: SbIcons.check, busy: _busy, onTap: _save),
      ],
    );
  }
}

class _SmallButton extends StatelessWidget {
  const _SmallButton({required this.label, required this.onTap, this.icon});
  final String label;
  final SbIconData? icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    return OutlinedButton(
      onPressed: onTap,
      style: OutlinedButton.styleFrom(
        foregroundColor: c.tx,
        side: BorderSide(color: c.ln2),
        minimumSize: const Size(44, 40),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        textStyle: const TextStyle(fontFamily: SbFonts.sans, fontSize: 14, fontWeight: FontWeight.w500),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[SbIcon(icon!, size: 14, color: c.tx), const SizedBox(width: 6)],
          Text(label),
        ],
      ),
    );
  }
}

// ------------------------------------------------------------------ a device's power

/// "Power of the geyser": its rating in watts (empty: guessed from its name).
Future<void> showWattsSheet(BuildContext context, {required String deviceId, required String name, int? watts}) =>
    showSbSheet<void>(context, builder: (_) => _WattsSheet(deviceId: deviceId, name: name, watts: watts));

class _WattsSheet extends ConsumerStatefulWidget {
  const _WattsSheet({required this.deviceId, required this.name, this.watts});
  final String deviceId, name;

  /// Set by the owner (null: guessed or unknown).
  final int? watts;

  @override
  ConsumerState<_WattsSheet> createState() => _WattsSheetState();
}

class _WattsSheetState extends ConsumerState<_WattsSheet> {
  late final _watts = TextEditingController(text: widget.watts?.toString() ?? '');
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _watts.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final text = _watts.text.trim();
    final v = int.tryParse(text);
    if (text.isNotEmpty && (v == null || v < 0 || v > 10000)) {
      setState(() => _error = 'Watts are a whole number, e.g. 75.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(devicesRepositoryProvider).update(widget.deviceId, {'watts': v == null || v == 0 ? null : v});
      ref.invalidate(energyForProvider);
      ref.invalidate(homeEnergyProvider);
      ref.invalidate(billProvider);
      ref.invalidate(deviceDetailProvider(widget.deviceId));
      if (mounted) Navigator.of(context).pop();
      ref.read(toastProvider.notifier).show(v == null ? 'Guessed from its name' : 'Saved: $v W');
    } catch (e) {
      if (mounted) {
        setState(() {
          _busy = false;
          _error = ApiException.from(e).message;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('Power of ${widget.name}', style: SbText.title.copyWith(color: c.tx)),
        const SizedBox(height: 4),
        Text(
          'Its rating in watts, on its label or box. A ceiling fan is about 75 W, an LED bulb 10–15 W, a 1-ton AC about 1200 W, a geyser 2000 W.',
          style: TextStyle(fontSize: 14.5, color: c.mu),
        ),
        const SizedBox(height: 16),
        LabeledField(
          label: 'Watts',
          controller: _watts,
          icon: SbIcons.zap,
          hint: 'e.g. 75',
          autofocus: true,
          keyboardType: TextInputType.number,
          onSubmitted: (_) => _save(),
        ),
        const SizedBox(height: 4),
        Text('Empty: guessed from its name.', style: TextStyle(fontSize: 12.5, color: c.mu)),
        if (_error != null) ...[
          const SizedBox(height: 12),
          Note(tone: NoteTone.bad, icon: SbIcons.warning, child: Text(_error!)),
        ],
        const SizedBox(height: 16),
        BigButton(label: 'Save', icon: SbIcons.check, busy: _busy, onTap: _save),
      ],
    );
  }
}

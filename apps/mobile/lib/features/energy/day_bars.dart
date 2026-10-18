import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../core/theme/sb_colors.dart';
import '../../data/models/energy.dart';

/// Units per day as bars, today last (amber). Tap a bar to read its day; plain widgets, no chart library.
class DayBars extends StatefulWidget {
  const DayBars({super.key, required this.days, this.height = 150});
  final List<EnergyDay> days;
  final double height;

  @override
  State<DayBars> createState() => _DayBarsState();
}

class _DayBarsState extends State<DayBars> {
  int? _picked;

  @override
  void didUpdateWidget(DayBars old) {
    super.didUpdateWidget(old);
    if (old.days.length != widget.days.length) _picked = null;
  }

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final days = widget.days;
    if (days.isEmpty) return const SizedBox.shrink();
    final max = days.fold<double>(.01, (m, d) => d.kwh > m ? d.kwh : m);
    final week = days.length <= 7;
    final shown = _picked == null ? null : days[_picked!];
    final total = days.fold<double>(0, (a, d) => a + d.kwh);
    final avg = total / days.length;
    final caption = shown == null
        ? 'About ${Energy.units(avg)} units a day · tap a bar'
        : '${shown.date == null ? shown.day : DateFormat('EEE d MMM').format(shown.date!)}: ${Energy.units(shown.kwh)} units · ${Energy.rupees(shown.cost)}';

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(caption, style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w500, color: shown == null ? c.mu : c.tx)),
        const SizedBox(height: 10),
        Semantics(
          label: 'Units per day: ${days.map((d) => '${d.label(short: true)} ${Energy.units(d.kwh)}').join(', ')}',
          child: SizedBox(
            height: widget.height,
            child: LayoutBuilder(
              builder: (context, box) {
                final slot = box.maxWidth / days.length;
                return GestureDetector(
                  behavior: HitTestBehavior.opaque,
                  onTapDown: (d) {
                    final i = (d.localPosition.dx / slot).floor().clamp(0, days.length - 1);
                    setState(() => _picked = _picked == i ? null : i);
                  },
                  child: CustomPaint(
                    size: Size(box.maxWidth, widget.height),
                    painter: _BarsPainter(
                      values: [for (final d in days) d.kwh / max],
                      picked: _picked,
                      bar: c.ac.withValues(alpha: c.isDark ? .75 : .8),
                      today: c.on,
                      dim: c.sf3,
                      grid: c.ln,
                    ),
                  ),
                );
              },
            ),
          ),
        ),
        const SizedBox(height: 6),
        Row(
          children: [
            for (final (i, d) in days.indexed)
              Expanded(
                child: Text(
                  week || i % 5 == 0 || i == days.length - 1 ? d.label(short: week) : '',
                  textAlign: TextAlign.center,
                  maxLines: 1,
                  overflow: TextOverflow.clip,
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: i == days.length - 1 ? FontWeight.w600 : FontWeight.w400,
                    color: i == _picked || i == days.length - 1 ? c.tx : c.mu,
                  ),
                ),
              ),
          ],
        ),
      ],
    );
  }
}

class _BarsPainter extends CustomPainter {
  _BarsPainter({required this.values, required this.picked, required this.bar, required this.today, required this.dim, required this.grid});

  /// each day's share of the busiest day (0..1)
  final List<double> values;
  final int? picked;
  final Color bar, today, dim, grid;

  @override
  void paint(Canvas canvas, Size size) {
    final line = Paint()
      ..color = grid
      ..strokeWidth = 1;
    for (final f in [0.0, .5, 1.0]) {
      final y = size.height - f * (size.height - 4);
      canvas.drawLine(Offset(0, y), Offset(size.width, y), line);
    }
    final slot = size.width / values.length;
    final w = (slot * .62).clamp(2.0, 28.0);
    for (final (i, v) in values.indexed) {
      final h = v <= 0 ? 2.0 : (v * (size.height - 4)).clamp(3.0, size.height);
      final x = slot * i + (slot - w) / 2;
      final rect = RRect.fromRectAndCorners(
        Rect.fromLTWH(x, size.height - h, w, h),
        topLeft: Radius.circular(w > 8 ? 5 : 2),
        topRight: Radius.circular(w > 8 ? 5 : 2),
      );
      final last = i == values.length - 1;
      final color = picked != null && picked != i ? (last ? today : bar).withValues(alpha: .35) : (last ? today : bar);
      canvas.drawRRect(rect, Paint()..color = v <= 0 ? dim : color);
    }
  }

  @override
  bool shouldRepaint(_BarsPainter old) =>
      old.picked != picked || old.bar != bar || old.today != today || old.values.length != values.length || !_same(old.values, values);

  static bool _same(List<double> a, List<double> b) {
    for (var i = 0; i < a.length; i++) {
      if (a[i] != b[i]) return false;
    }
    return true;
  }
}

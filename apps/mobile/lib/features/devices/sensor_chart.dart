import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../core/theme/sb_colors.dart';
import '../../data/models/device_detail.dart';

/// A sensor reading over time as a line (oldest left), with its low, high and the span it covers.
/// Plain CustomPainter, no chart library. Drag along it to read a point.
class SensorChart extends StatefulWidget {
  const SensorChart({super.key, required this.points, required this.label, this.unit = '', this.height = 130});
  final List<Reading> points;
  final String label, unit;
  final double height;

  @override
  State<SensorChart> createState() => _SensorChartState();
}

class _SensorChartState extends State<SensorChart> {
  int? _at;

  String _value(double v) => '${v.toStringAsFixed(v.abs() < 100 ? 1 : 0)}${widget.unit}';

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final p = widget.points;
    if (p.length < 2) return const SizedBox.shrink();
    var lo = p.first.value, hi = p.first.value;
    for (final x in p) {
      if (x.value < lo) lo = x.value;
      if (x.value > hi) hi = x.value;
    }
    final span = p.last.at.difference(p.first.at);
    final spanText = span.inHours >= 48 ? 'last ${(span.inHours / 24).round()} days' : span.inHours >= 2 ? 'last ${span.inHours} hours' : 'last ${span.inMinutes} min';
    final picked = _at == null ? null : p[_at!];
    final fmt = DateFormat(span.inHours >= 24 ? 'EEE h:mm a' : 'h:mm a');
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(child: Text(widget.label, style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: c.tx))),
            Text(
              picked != null ? '${_value(picked.value)} · ${fmt.format(picked.at).toLowerCase()}' : 'low ${_value(lo)} · high ${_value(hi)}',
              style: TextStyle(fontSize: 12.5, color: picked != null ? c.tx : c.mu, fontWeight: picked != null ? FontWeight.w500 : FontWeight.w400),
            ),
          ],
        ),
        const SizedBox(height: 8),
        Semantics(
          label: '${widget.label}, $spanText: from ${_value(lo)} to ${_value(hi)}, now ${_value(p.last.value)}',
          child: LayoutBuilder(
            builder: (context, box) {
              void pick(Offset o) {
                final t0 = p.first.at.millisecondsSinceEpoch, t1 = p.last.at.millisecondsSinceEpoch;
                final t = t0 + (o.dx / box.maxWidth).clamp(0, 1) * (t1 - t0);
                var best = 0;
                for (var i = 1; i < p.length; i++) {
                  if ((p[i].at.millisecondsSinceEpoch - t).abs() < (p[best].at.millisecondsSinceEpoch - t).abs()) best = i;
                }
                setState(() => _at = best);
              }

              return GestureDetector(
                behavior: HitTestBehavior.opaque,
                onTapDown: (d) => pick(d.localPosition),
                onHorizontalDragUpdate: (d) => pick(d.localPosition),
                onHorizontalDragEnd: (_) => setState(() => _at = null),
                child: CustomPaint(
                  size: Size(box.maxWidth, widget.height),
                  painter: _LinePainter(points: p, lo: lo, hi: hi, line: c.ac, fill: c.ac.withValues(alpha: .10), grid: c.ln, mark: _at, dot: c.tx),
                ),
              );
            },
          ),
        ),
        const SizedBox(height: 4),
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(DateFormat(span.inHours >= 24 ? 'EEE d MMM' : 'h:mm a').format(p.first.at), style: TextStyle(fontSize: 11, color: c.mu)),
            Text('now ${_value(p.last.value)}', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: c.tx)),
          ],
        ),
      ],
    );
  }
}

class _LinePainter extends CustomPainter {
  _LinePainter({required this.points, required this.lo, required this.hi, required this.line, required this.fill, required this.grid, required this.mark, required this.dot});
  final List<Reading> points;
  final double lo, hi;
  final Color line, fill, grid, dot;
  final int? mark;

  @override
  void paint(Canvas canvas, Size size) {
    const pad = 6.0;
    final t0 = points.first.at.millisecondsSinceEpoch.toDouble();
    final t1 = points.last.at.millisecondsSinceEpoch.toDouble();
    final span = (hi - lo).abs() < 1e-9 ? 1.0 : hi - lo;
    Offset at(Reading r) => Offset(
          (t1 - t0) == 0 ? 0 : (r.at.millisecondsSinceEpoch - t0) / (t1 - t0) * size.width,
          size.height - pad - (r.value - lo) / span * (size.height - 2 * pad),
        );
    final g = Paint()
      ..color = grid
      ..strokeWidth = 1;
    for (final f in [0.0, .5, 1.0]) {
      final y = pad + f * (size.height - 2 * pad);
      canvas.drawLine(Offset(0, y), Offset(size.width, y), g);
    }
    final path = Path()..moveTo(at(points.first).dx, at(points.first).dy);
    for (final r in points.skip(1)) {
      final o = at(r);
      path.lineTo(o.dx, o.dy);
    }
    final area = Path.from(path)
      ..lineTo(size.width, size.height)
      ..lineTo(0, size.height)
      ..close();
    canvas.drawPath(area, Paint()..color = fill);
    canvas.drawPath(
      path,
      Paint()
        ..color = line
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2
        ..strokeJoin = StrokeJoin.round,
    );
    if (mark != null) {
      final o = at(points[mark!]);
      canvas.drawLine(Offset(o.dx, 0), Offset(o.dx, size.height), g..color = dot.withValues(alpha: .25));
      canvas.drawCircle(o, 4.5, Paint()..color = dot);
    }
  }

  @override
  bool shouldRepaint(_LinePainter old) => old.points != points || old.mark != mark || old.line != line;
}

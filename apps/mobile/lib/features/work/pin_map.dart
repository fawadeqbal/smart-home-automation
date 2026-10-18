import 'package:flutter/material.dart';

import '../../core/theme/app_theme.dart';
import '../../core/theme/sb_colors.dart';
import '../../data/models/work/board.dart';
import '../../data/models/work/pins.dart';
import '../../shared/widgets/common.dart';
import '../../shared/widgets/pressable.dart';
import '../../shared/widgets/sheet.dart';
import 'work_icons.dart';
import 'work_widgets.dart';

/// The board as printed on its PCB (antenna at the top, USB at the bottom) with every header pin: what's
/// wired to it, free to use, power, or reserved. Tap a pin to see what it can do.
class PinMap extends StatelessWidget {
  const PinMap({super.key, required this.node, required this.catalog});
  final BoardNode node;
  final Catalog catalog;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final map = pinMap(node, catalog);
    final all = [...map.left, ...map.right];
    final used = all.where((p) => p.kind == PinKind.used).length;
    final free = all.where((p) => p.kind == PinKind.free).length;
    final rows = map.left.length > map.right.length ? map.left.length : map.right.length;
    // a side with nothing to label gets no room, so the other side's names fit
    bool labels(List<HeaderPin> side) => side.any((p) => p.kind == PinKind.used || p.kind == PinKind.free);
    final sides = (left: labels(map.left), right: labels(map.right));
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Wrap(
          spacing: 14,
          runSpacing: 6,
          children: [
            _Legend(kind: PinKind.used, text: 'In use ($used)'),
            _Legend(kind: PinKind.free, text: 'Free ($free)'),
            const _Legend(kind: PinKind.power, text: 'Power'),
            const _Legend(kind: PinKind.reserved, text: 'Don’t use'),
          ],
        ),
        const SizedBox(height: 14),
        WorkCard(
          padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 6),
          child: Column(
            children: [
              _cap(context, top: true, text: map.chip, sides: sides),
              for (var i = 0; i < rows; i++)
                _PinRow(
                  left: i < map.left.length ? map.left[i] : null,
                  right: i < map.right.length ? map.right[i] : null,
                  sides: sides,
                ),
              _cap(context, top: false, text: map.usb, sides: sides),
            ],
          ),
        ),
        const SizedBox(height: 10),
        Text(
          'Relays: signal to the pin, VCC to VIN/VU (5 V), GND to G. Sensors take power from 3V. Only green pins are free.',
          style: TextStyle(fontSize: 13, color: c.mu, height: 1.4),
        ),
      ],
    );
  }

  Widget _cap(
    BuildContext context, {
    required bool top,
    required String text,
    required ({bool left, bool right}) sides,
  }) {
    return Row(
      children: [
        _side(sides.left, const SizedBox()),
        Container(
          width: _pcbWidth,
          height: top ? 46 : 34,
          decoration: BoxDecoration(
            color: _pcb,
            borderRadius: top
                ? const BorderRadius.vertical(top: Radius.circular(14))
                : const BorderRadius.vertical(bottom: Radius.circular(14)),
          ),
          alignment: Alignment.center,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            decoration: BoxDecoration(
              color: top ? const Color(0xFF9AA3AE) : const Color(0xFF59606B),
              borderRadius: BorderRadius.circular(4),
            ),
            child: Text(
              text,
              style: TextStyle(
                fontFamily: SbFonts.mono,
                fontSize: 10,
                color: top ? const Color(0xFF111418) : Colors.white,
              ),
            ),
          ),
        ),
        _side(sides.right, const SizedBox()),
      ],
    );
  }
}

/// The room for one side's labels: a share of the width, or a small margin when it has none.
Widget _side(bool labels, Widget child) => labels ? Expanded(child: child) : const SizedBox(width: 10);

const _pcb = Color(0xFF1C2430);
const _pcbWidth = 112.0;

class _PinRow extends StatelessWidget {
  const _PinRow({this.left, this.right, required this.sides});
  final HeaderPin? left, right;
  final ({bool left, bool right}) sides;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 30,
      child: Row(
        children: [
          _side(sides.left, left == null ? const SizedBox() : _Tag(pin: left!, alignRight: true)),
          Container(
            width: _pcbWidth,
            height: 30,
            color: _pcb,
            padding: const EdgeInsets.symmetric(horizontal: 7),
            child: Row(
              children: [
                if (left != null) _PinCell(pin: left!, dotFirst: true) else const Spacer(),
                const Spacer(),
                if (right != null) _PinCell(pin: right!, dotFirst: false) else const Spacer(),
              ],
            ),
          ),
          _side(sides.right, right == null ? const SizedBox() : _Tag(pin: right!, alignRight: false)),
        ],
      ),
    );
  }
}

class _PinCell extends StatelessWidget {
  const _PinCell({required this.pin, required this.dotFirst});
  final HeaderPin pin;
  final bool dotFirst;

  @override
  Widget build(BuildContext context) {
    final label = Text(
      pin.label,
      style: const TextStyle(fontFamily: SbFonts.mono, fontSize: 10.5, color: Color(0xFFE6E8EB)),
    );
    return Pressable(
      onTap: () => _explain(context, pin),
      semanticLabel: '${pin.label}: ${pin.explain}',
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: dotFirst
            ? [PinDot(pin.kind), const SizedBox(width: 5), label]
            : [label, const SizedBox(width: 5), PinDot(pin.kind)],
      ),
    );
  }
}

class _Tag extends StatelessWidget {
  const _Tag({required this.pin, required this.alignRight});
  final HeaderPin pin;
  final bool alignRight;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    Widget? child;
    if (pin.kind == PinKind.used) {
      final (bg, fg) = pin.isButton
          ? (c.onSoft, c.onText)
          : pin.isSensor
          ? (c.okSoft, c.okText)
          : (c.acSoft, c.acText);
      child = Container(
        padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
        decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(6)),
        child: Text(
          pin.what,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w600, color: fg),
        ),
      );
    } else if (pin.kind == PinKind.free) {
      child = Text('free', style: TextStyle(fontSize: 11.5, color: c.okText));
    }
    if (child == null) return const SizedBox();
    return Pressable(
      onTap: () => _explain(context, pin),
      child: Padding(
        padding: EdgeInsets.only(left: alignRight ? 2 : 6, right: alignRight ? 6 : 2),
        child: Align(alignment: alignRight ? Alignment.centerRight : Alignment.centerLeft, child: child),
      ),
    );
  }
}

/// A pin's colour: blue in use, a green ring when free, amber power, grey reserved.
class PinDot extends StatelessWidget {
  const PinDot(this.kind, {super.key, this.size = 11});
  final PinKind kind;
  final double size;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: switch (kind) {
          PinKind.used => c.ac,
          PinKind.free => Colors.transparent,
          PinKind.power => c.on,
          PinKind.reserved => const Color(0xFF59606B),
        },
        border: kind == PinKind.free ? Border.all(color: c.ok, width: 2.2) : null,
      ),
    );
  }
}

class _Legend extends StatelessWidget {
  const _Legend({required this.kind, required this.text});
  final PinKind kind;
  final String text;

  @override
  Widget build(BuildContext context) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      PinDot(kind),
      const SizedBox(width: 6),
      Text(text, style: TextStyle(fontSize: 13, color: context.sb.mu)),
    ],
  );
}

void _explain(BuildContext context, HeaderPin pin) {
  showSbSheet<void>(
    context,
    builder: (ctx) {
      final c = ctx.sb;
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SheetTitle(pin.gpio == null ? pin.label : '${pin.label} · GPIO ${pin.gpio}'),
          const SizedBox(height: 10),
          Row(
            children: [
              PinDot(pin.kind, size: 14),
              const SizedBox(width: 10),
              Expanded(
                child: Text(pin.explain, style: TextStyle(fontSize: 15, color: c.tx, height: 1.45)),
              ),
            ],
          ),
        ],
      );
    },
  );
}

/// Picks a pin for one wire of a device or a button: only the safe, free pins for that use are offered.
class PinPicker extends StatelessWidget {
  const PinPicker({
    super.key,
    required this.choices,
    required this.value,
    required this.onChanged,
    this.enabled = true,
  });
  final List<BoardPin> choices;
  final int value;
  final ValueChanged<int> onChanged;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    if (choices.isEmpty) {
      return const Note(
        tone: NoteTone.warn,
        icon: WorkIcons.cpu,
        child: Text('No free pin on this board suits this. Free one up, or use another board.'),
      );
    }
    final picked = choices.where((p) => p.gpio == value).firstOrNull;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Wrap(
          spacing: 6,
          runSpacing: 6,
          children: [
            for (final p in choices)
              Pressable(
                scale: .95,
                selected: p.gpio == value,
                semanticLabel: '${p.label}, GPIO ${p.gpio}',
                onTap: enabled ? () => onChanged(p.gpio) : null,
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 180),
                  width: 64,
                  padding: const EdgeInsets.symmetric(vertical: 7),
                  decoration: BoxDecoration(
                    color: p.gpio == value ? c.tx : c.sf,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: p.gpio == value ? c.tx : c.ln2),
                  ),
                  child: Column(
                    children: [
                      Text(
                        p.label,
                        style: TextStyle(
                          fontFamily: SbFonts.mono,
                          fontSize: 15,
                          fontWeight: FontWeight.w600,
                          color: p.gpio == value ? c.bg : c.tx,
                        ),
                      ),
                      Text(
                        'GPIO ${p.gpio}',
                        style: TextStyle(fontSize: 10.5, color: p.gpio == value ? c.bg.withValues(alpha: .75) : c.mu),
                      ),
                    ],
                  ),
                ),
              ),
          ],
        ),
        if (picked?.note != null)
          Padding(
            padding: const EdgeInsets.only(top: 8, left: 2),
            child: Text(picked!.note!, style: TextStyle(fontSize: 12.5, color: c.mu, height: 1.35)),
          ),
      ],
    );
  }
}

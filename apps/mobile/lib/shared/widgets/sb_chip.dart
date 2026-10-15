import 'package:flutter/material.dart';

import '../../core/theme/sb_colors.dart';
import '../../core/theme/sb_icons.dart';
import 'pressable.dart';

enum ChipTone { ink, amber, blue }

/// A pill to pick something: ink (black when picked), amber or blue.
class SbChip extends StatelessWidget {
  const SbChip({
    super.key,
    required this.label,
    required this.selected,
    this.onTap,
    this.icon,
    this.tone = ChipTone.ink,
    this.height = 38,
    this.mono = false,
  });

  final String label;
  final bool selected;
  final VoidCallback? onTap;
  final SbIconData? icon;
  final ChipTone tone;
  final double height;
  final bool mono;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final (bg, fg, bd) = switch ((tone, selected)) {
      (_, false) => (c.sf, c.tx, c.ln2),
      (ChipTone.ink, true) => (c.tx, c.bg, c.tx),
      (ChipTone.amber, true) => (c.onSoft, c.tx, c.on),
      (ChipTone.blue, true) => (c.acSoft, c.acText, c.ac),
    };
    return Pressable(
      scale: .96,
      selected: selected,
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        height: height,
        padding: const EdgeInsets.symmetric(horizontal: 14),
        decoration: BoxDecoration(
          color: bg,
          borderRadius: BorderRadius.circular(height >= 42 ? 13 : 999),
          border: Border.all(color: bd),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (icon != null) ...[
              SbIcon(icon!, size: 15, color: fg),
              const SizedBox(width: 7),
            ],
            Text(
              label,
              style: TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.w500,
                color: fg,
                fontFamily: mono ? 'GeistMono' : null,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

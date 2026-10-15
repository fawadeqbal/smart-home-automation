import 'package:flutter/material.dart';

import '../../core/theme/sb_colors.dart';

/// The design's on/off pill: grey when off, green (or amber) when on, with a springy knob.
class SbSwitch extends StatelessWidget {
  const SbSwitch({
    super.key,
    required this.value,
    this.onChanged,
    this.large = false,
    this.amber = false,
    this.semanticLabel,
  });

  final bool value;
  final ValueChanged<bool>? onChanged;
  final bool large;
  final bool amber;
  final String? semanticLabel;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final w = large ? 60.0 : 48.0, h = large ? 34.0 : 28.0, pad = large ? 4.0 : 3.0, knob = h - pad * 2;
    return Semantics(
      toggled: value,
      label: semanticLabel,
      child: GestureDetector(
        onTap: onChanged == null ? null : () => onChanged!(!value),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 300),
          width: w,
          height: h,
          padding: EdgeInsets.all(pad),
          decoration: BoxDecoration(
            color: value ? (amber ? c.on : c.ok) : c.switchOff,
            borderRadius: BorderRadius.circular(999),
          ),
          child: AnimatedAlign(
            duration: const Duration(milliseconds: 380),
            curve: const Cubic(.3, 1.4, .5, 1),
            alignment: value ? Alignment.centerRight : Alignment.centerLeft,
            child: Container(
              width: knob,
              height: knob,
              decoration: const BoxDecoration(
                color: Colors.white,
                shape: BoxShape.circle,
                boxShadow: [
                  BoxShadow(
                    color: Color(0x33000000),
                    blurRadius: 3,
                    offset: Offset(0, 1),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

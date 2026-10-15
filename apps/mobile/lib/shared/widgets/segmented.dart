import 'package:flutter/material.dart';

import '../../core/theme/sb_colors.dart';
import 'pressable.dart';

/// A segmented control (Member | Guest, Turn on | Turn off …).
class Segmented<T> extends StatelessWidget {
  const Segmented({
    super.key,
    required this.options,
    required this.value,
    required this.onChanged,
    this.height = 40,
  });

  final List<(T, String)> options;
  final T value;
  final ValueChanged<T> onChanged;
  final double height;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    return Container(
      padding: const EdgeInsets.all(3),
      decoration: BoxDecoration(
        color: c.sf2,
        borderRadius: BorderRadius.circular(13),
      ),
      child: Row(
        children: [
          for (final (v, label) in options)
            Expanded(
              child: Pressable(
                scale: .97,
                selected: v == value,
                onTap: () => onChanged(v),
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 200),
                  height: height,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: v == value ? c.sf : Colors.transparent,
                    borderRadius: BorderRadius.circular(10),
                    boxShadow: v == value ? c.shadow1 : null,
                  ),
                  child: Text(
                    label,
                    style: TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w500,
                      color: v == value ? c.tx : c.mu,
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

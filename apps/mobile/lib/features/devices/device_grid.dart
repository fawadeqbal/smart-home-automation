import 'package:flutter/material.dart';

/// Two tiles per row (three on wide screens).
class DeviceGrid extends StatelessWidget {
  const DeviceGrid({super.key, required this.children});
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, box) {
        final cols = box.maxWidth > 900
            ? 4
            : box.maxWidth > 560
            ? 3
            : 2;
        const gap = 10.0;
        final w = (box.maxWidth - gap * (cols - 1)) / cols;
        return Wrap(
          spacing: gap,
          runSpacing: gap,
          children: [for (final c in children) SizedBox(width: w, child: c)],
        );
      },
    );
  }
}

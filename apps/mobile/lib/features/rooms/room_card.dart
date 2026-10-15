import 'package:flutter/material.dart';

import '../../core/theme/sb_colors.dart';
import '../../core/theme/sb_icons.dart';
import '../../shared/widgets/pressable.dart';
import '../../state/home_overview.dart';
import 'room_look.dart';

/// A room as a soft coloured card: its icon, a dot (amber if something's on, red if it isn't
/// answering) and how many things are on.
class RoomCard extends StatelessWidget {
  const RoomCard({
    super.key,
    required this.summary,
    required this.onTap,
    this.width,
    this.height = 176,
  });
  final RoomSummary summary;
  final VoidCallback onTap;
  final double? width;
  final double height;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final palette = RoomPalette.at(summary.index);
    final ink = palette.ink(c.isDark);
    final icon = roomIcon(summary.room.name);
    final down = summary.notResponding;
    final dot = down
        ? c.bad
        : summary.onCount > 0
        ? c.on
        : c.switchOff;
    return Pressable(
      onTap: onTap,
      semanticLabel: '${summary.room.name}, ${summary.status}',
      child: Container(
        width: width,
        height: height,
        clipBehavior: Clip.antiAlias,
        decoration: BoxDecoration(
          gradient: palette.gradient(c.isDark),
          borderRadius: BorderRadius.circular(28),
        ),
        child: Stack(
          children: [
            Positioned(
              right: -18,
              bottom: -22,
              child: Opacity(
                opacity: .13,
                child: SbIcon(icon, size: 120, color: ink),
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Row(
                    children: [
                      Container(
                        width: 44,
                        height: 44,
                        decoration: BoxDecoration(
                          color: c.glass,
                          shape: BoxShape.circle,
                        ),
                        child: Center(
                          child: SbIcon(
                            icon,
                            size: 22,
                            color: ink,
                            weight: IconWeight.duotone,
                          ),
                        ),
                      ),
                      const Spacer(),
                      AnimatedContainer(
                        duration: const Duration(milliseconds: 300),
                        width: 9,
                        height: 9,
                        decoration: BoxDecoration(
                          color: dot,
                          shape: BoxShape.circle,
                        ),
                      ),
                    ],
                  ),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        summary.room.name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 15.5,
                          fontWeight: FontWeight.w600,
                          color: c.tx,
                          height: 1.3,
                        ),
                      ),
                      Text(
                        down && !summary.allDown ? 'Part not responding' : summary.status,
                        style: TextStyle(
                          fontSize: 13,
                          color: down ? c.badText : c.mu,
                          height: 1.3,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

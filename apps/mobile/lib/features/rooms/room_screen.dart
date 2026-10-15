import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/sb_colors.dart';
import '../../core/theme/sb_icons.dart';
import '../../shared/widgets/common.dart';
import '../../shared/widgets/pressable.dart';
import '../../state/home_overview.dart';
import '../../state/people.dart';
import '../devices/device_grid.dart';
import '../devices/device_tile.dart';
import '../home/home_actions.dart';
import 'room_look.dart';

/// One room: its card, All on / All off, and every device in it.
class RoomScreen extends ConsumerWidget {
  const RoomScreen({super.key, required this.roomId});
  final String roomId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.sb;
    final summary = ref.watch(roomSummaryProvider(roomId));
    final top = MediaQuery.paddingOf(context).top;
    if (summary == null) {
      return ListView(
        padding: EdgeInsets.fromLTRB(18, top + 4, 18, 130),
        children: [
          BackPill(onTap: () => context.pop()),
          const SizedBox(height: 24),
          const EmptyView(
            icon: SbIcons.rooms,
            title: 'This room isn’t here',
            text: 'It may have been removed, or it’s no longer shared with you.',
          ),
        ],
      );
    }
    final palette = RoomPalette.at(summary.index);
    final ink = palette.ink(c.isDark);
    final icon = roomIcon(summary.room.name);
    final switches = summary.switches.where((d) => d.canControl).toList();
    final expert = ref.watch(homeWelcomeProvider).value?.installer;

    return ListView(
      padding: EdgeInsets.fromLTRB(18, top + 4, 18, 130),
      children: [
        BackPill(onTap: () => context.pop()),
        const SizedBox(height: 18),
        Container(
          constraints: const BoxConstraints(minHeight: 168),
          clipBehavior: Clip.antiAlias,
          decoration: BoxDecoration(
            gradient: palette.gradient(c.isDark),
            borderRadius: BorderRadius.circular(32),
          ),
          child: Stack(
            children: [
              Positioned(
                right: -24,
                top: -20,
                child: Opacity(
                  opacity: .13,
                  child: SbIcon(icon, size: 170, color: ink),
                ),
              ),
              Padding(
                padding: const EdgeInsets.all(20),
                child: SizedBox(
                  height: 128,
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Container(
                        width: 56,
                        height: 56,
                        decoration: BoxDecoration(
                          color: c.glass,
                          shape: BoxShape.circle,
                        ),
                        child: Center(
                          child: SbIcon(
                            icon,
                            size: 26,
                            color: ink,
                            weight: IconWeight.duotone,
                          ),
                        ),
                      ),
                      const SizedBox(width: 14),
                      Expanded(
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Semantics(
                              header: true,
                              child: Text(
                                summary.room.name,
                                style: TextStyle(
                                  fontSize: 28,
                                  fontWeight: FontWeight.w600,
                                  letterSpacing: -.84,
                                  color: c.tx,
                                  height: 1.2,
                                ),
                              ),
                            ),
                            Text(
                              summary.status,
                              style: TextStyle(fontSize: 14, color: c.mu),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 18),
        if (summary.notResponding)
          Padding(
            padding: const EdgeInsets.only(bottom: 18),
            child: Note(
              tone: NoteTone.bad,
              icon: SbIcons.warning,
              child: Text.rich(
                TextSpan(
                  children: [
                    TextSpan(
                      text: summary.allDown ? 'This room isn’t responding. ' : 'Part of this room isn’t responding. ',
                    ),
                    const TextSpan(
                      text: 'The wall switches still work.',
                      style: TextStyle(fontWeight: FontWeight.w600),
                    ),
                    if (expert != null) TextSpan(text: ' $expert has been told.'),
                  ],
                ),
              ),
            ),
          ),
        if (switches.length > 1 && !summary.allDown) ...[
          Row(
            children: [
              Expanded(
                child: _RoomButton(
                  icon: SbIcons.sun,
                  label: 'All on',
                  onTap: () => switchAll(
                    ref,
                    switches,
                    on: true,
                    label: '${summary.room.name} all on',
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _RoomButton(
                  icon: SbIcons.moon,
                  label: 'All off',
                  onTap: () => switchAll(
                    ref,
                    switches,
                    on: false,
                    label: '${summary.room.name} all off',
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 18),
        ],
        if (summary.devices.isEmpty)
          const EmptyView(
            icon: SbIcons.lightbulb,
            title: 'Nothing in this room yet',
            text: 'Devices appear here once your installer connects them.',
          )
        else
          DeviceGrid(
            children: [
              for (final d in summary.devices) LiveDeviceTile(key: ValueKey(d.id), deviceId: d.id),
            ],
          ),
      ],
    );
  }
}

class _RoomButton extends StatelessWidget {
  const _RoomButton({
    required this.icon,
    required this.label,
    required this.onTap,
  });
  final SbIconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    return Pressable(
      onTap: onTap,
      scale: .97,
      child: Container(
        height: 48,
        decoration: BoxDecoration(
          color: c.sf,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: c.ln2),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            SbIcon(icon, size: 16, color: c.tx),
            const SizedBox(width: 8),
            Text(
              label,
              style: TextStyle(
                fontSize: 14.5,
                fontWeight: FontWeight.w600,
                color: c.tx,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

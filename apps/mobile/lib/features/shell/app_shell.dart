import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/routing/routes.dart';
import '../../core/theme/sb_colors.dart';
import '../../core/theme/sb_icons.dart';
import '../../push/push.dart';
import '../../push/push_ask.dart';
import '../../shared/widgets/common.dart';
import '../../shared/widgets/pressable.dart';
import '../../state/home_overview.dart';
import '../../state/local_control.dart';
import '../../state/presence.dart';
import '../../state/session.dart';
import '../../voice/hands_free.dart';
import '../../voice/hands_free_ui.dart';
import 'toast_host.dart';

/// The four tabs under a floating glass bar, with the mic beside it and toasts above it.
class AppShell extends ConsumerWidget {
  const AppShell({super.key, required this.shell});
  final StatefulNavigationShell shell;

  static const _tabs = [
    ('Home', SbIcons.house),
    ('Rooms', SbIcons.rooms),
    ('Routines', SbIcons.routines),
    ('Me', SbIcons.me),
  ];

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.sb;
    final bottom = MediaQuery.paddingOf(context).bottom;
    ref.watch(localSyncProvider); // keeps the passes for switching over Wi‑Fi fresh
    ref.watch(pushSyncProvider); // this phone's push token, and taps on notifications
    ref.watch(presenceSyncProvider); // "who's home", when I share it
    final manages = ref.watch(
      sessionProvider.select((s) => s.value?.home?.manages ?? false),
    );
    final problem = manages && !ref.watch(homeHealthProvider.select((h) => h.ok));
    // "Hey Switchboard" lives as long as the signed-in app does
    final listening = ref.watch(handsFreeProvider.select((h) => h.stage == HandsFreeStage.waiting));
    return Scaffold(
      body: Stack(
        children: [
          Positioned.fill(child: shell),
          const PushAskOnce(),
          Positioned(
            left: 16,
            right: 16,
            bottom: bottom + 98,
            child: Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 520),
                child: const HandsFreeOverlay(),
              ),
            ),
          ),
          Positioned(
            left: 16,
            right: 16,
            bottom: bottom + 104,
            child: Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 420),
                child: const ToastHost(),
              ),
            ),
          ),
          Positioned(
            left: 18,
            right: 18,
            bottom: bottom + 22,
            child: Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 520),
                child: Row(
                  children: [
                    Expanded(
                      child: Glass(
                        radius: 32,
                        color: c.glassBar,
                        border: c.glassBorder,
                        highlight: c.glassHighlight,
                        child: SizedBox(
                          height: 64,
                          child: Padding(
                            padding: const EdgeInsets.all(4),
                            child: LayoutBuilder(
                              builder: (context, box) {
                                final w = box.maxWidth / _tabs.length;
                                return Stack(
                                  children: [
                                    AnimatedPositioned(
                                      duration: const Duration(
                                        milliseconds: 420,
                                      ),
                                      curve: const Cubic(.3, 1.2, .4, 1),
                                      left: w * shell.currentIndex,
                                      top: 0,
                                      bottom: 0,
                                      width: w,
                                      child: Container(
                                        decoration: BoxDecoration(
                                          color: c.lens,
                                          borderRadius: BorderRadius.circular(
                                            28,
                                          ),
                                        ),
                                      ),
                                    ),
                                    Row(
                                      children: [
                                        for (final (i, (label, icon)) in _tabs.indexed)
                                          Expanded(
                                            child: _Tab(
                                              label: label,
                                              icon: icon,
                                              selected: shell.currentIndex == i,
                                              badge: i == 3 && problem,
                                              onTap: () => shell.goBranch(
                                                i,
                                                initialLocation: shell.currentIndex == i,
                                              ),
                                            ),
                                          ),
                                      ],
                                    ),
                                  ],
                                );
                              },
                            ),
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Pressable(
                      onTap: () => context.push(Routes.ask),
                      scale: .9,
                      semanticLabel: 'Ask by voice',
                      child: Glass(
                        radius: 32,
                        color: c.glassBar,
                        border: c.glassBorder,
                        highlight: c.glassHighlight,
                        child: SizedBox(
                          width: 64,
                          height: 64,
                          child: Stack(
                            alignment: Alignment.center,
                            children: [
                              SbIcon(
                                SbIcons.mic,
                                size: 27,
                                color: c.tint,
                                weight: IconWeight.fill,
                              ),
                              // listening for "Hey Switchboard"
                              if (listening)
                                Positioned(
                                  top: 14,
                                  right: 14,
                                  child: Container(
                                    width: 9,
                                    height: 9,
                                    decoration: BoxDecoration(
                                      color: const Color(0xFF3DDC97),
                                      shape: BoxShape.circle,
                                      border: Border.all(color: c.sf, width: 1.5),
                                    ),
                                  ),
                                ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _Tab extends StatelessWidget {
  const _Tab({
    required this.label,
    required this.icon,
    required this.selected,
    required this.badge,
    required this.onTap,
  });
  final String label;
  final SbIconData icon;
  final bool selected, badge;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final color = selected ? c.tint : c.tx;
    return Pressable(
      onTap: onTap,
      scale: .9,
      selected: selected,
      semanticLabel: label,
      child: SizedBox.expand(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Stack(
              clipBehavior: Clip.none,
              children: [
                SbIcon(
                  icon,
                  size: 25,
                  color: color,
                  weight: selected ? IconWeight.fill : IconWeight.regular,
                ),
                if (badge)
                  Positioned(
                    right: -3,
                    top: -1,
                    child: Container(
                      width: 9,
                      height: 9,
                      decoration: BoxDecoration(
                        color: const Color(0xFFFF3B30),
                        shape: BoxShape.circle,
                        border: Border.all(color: c.sf, width: 2),
                      ),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 2),
            Text(
              label,
              style: TextStyle(
                fontSize: 10.5,
                fontWeight: FontWeight.w600,
                letterSpacing: .1,
                color: color,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

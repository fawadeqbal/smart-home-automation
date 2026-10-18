import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/routing/routes.dart';
import '../../core/theme/sb_colors.dart';
import '../../core/theme/sb_icons.dart';
import '../../push/push.dart';
import '../../shared/widgets/common.dart';
import '../../shared/widgets/pressable.dart';
import '../../state/session.dart';
import '../../state/work.dart';
import '../shell/toast_host.dart';
import 'work_icons.dart';

/// The staff tabs — Today · Homes · Tickets · Me — under the same floating glass bar as the home app,
/// with toasts above it. The bar has its own tabs, so work and the home app never mix.
class WorkShell extends ConsumerWidget {
  const WorkShell({super.key, required this.shell});
  final StatefulNavigationShell shell;

  static const _tabs = [
    ('Today', WorkIcons.route),
    ('Homes', SbIcons.house),
    ('Tickets', WorkIcons.ticket),
    ('Me', SbIcons.me),
  ];

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.sb;
    final bottom = MediaQuery.paddingOf(context).bottom;
    ref.watch(pushSyncProvider); // this phone's push token (ticket and board alerts reach staff too)
    final overdue = ref.watch(workTicketsProvider.select((t) => t.value?.overdue ?? 0)) > 0;
    return Scaffold(
      body: Stack(
        // every child is positioned, so the stack fills the screen
        fit: StackFit.expand,
        children: [
          Positioned.fill(child: shell),
          Positioned(
            left: 16,
            right: 16,
            bottom: bottom + 104,
            child: Center(
              child: ConstrainedBox(constraints: const BoxConstraints(maxWidth: 420), child: const ToastHost()),
            ),
          ),
          Positioned(
            left: 18,
            right: 18,
            bottom: bottom + 22,
            child: Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 520),
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
                                duration: const Duration(milliseconds: 420),
                                curve: const Cubic(.3, 1.2, .4, 1),
                                left: w * shell.currentIndex,
                                top: 0,
                                bottom: 0,
                                width: w,
                                child: Container(
                                  decoration: BoxDecoration(color: c.lens, borderRadius: BorderRadius.circular(28)),
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
                                        badge: i == 2 && overdue,
                                        onTap: () => shell.goBranch(i, initialLocation: shell.currentIndex == i),
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
                SbIcon(icon, size: 25, color: color, weight: selected ? IconWeight.fill : IconWeight.regular),
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
              style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w600, letterSpacing: .1, color: color),
            ),
          ],
        ),
      ),
    );
  }
}

/// Wraps the home app while a staff member looks at a customer's home "as the customer sees it": a bar
/// at the top says whose home it is and takes them back to work. Elsewhere it shows the app as it is.
class CustomerViewFrame extends ConsumerWidget {
  const CustomerViewFrame({super.key, required this.child});
  final Widget child;

  static const _bar = 46.0;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final viewing = ref.watch(customerViewProvider);
    final home = ref.watch(sessionProvider.select((s) => s.value?.home));
    if (viewing == null || home?.id != viewing) return child;
    final mq = MediaQuery.of(context);
    final top = mq.padding.top;
    return Stack(
      fit: StackFit.expand,
      children: [
        // the screens below keep their own top padding, pushed down by the bar
        Positioned.fill(
          child: MediaQuery(
            data: mq.copyWith(padding: mq.padding.copyWith(top: top + _bar)),
            child: child,
          ),
        ),
        Positioned(
          left: 0,
          right: 0,
          top: 0,
          height: top + _bar,
          child: Container(
            color: SbColors.ink,
            padding: EdgeInsets.fromLTRB(16, top, 8, 0),
            child: Row(
              children: [
                SbIcon(WorkIcons.eye, size: 17, color: SbColors.inkText.withValues(alpha: .8)),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'As ${home!.name} sees it',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: SbColors.inkText),
                  ),
                ),
                TextButton.icon(
                  onPressed: () {
                    ref.read(customerViewProvider.notifier).close();
                    context.go('/work/today');
                  },
                  style: TextButton.styleFrom(
                    foregroundColor: const Color(0xFFF7C46A),
                    textStyle: const TextStyle(fontFamily: 'Geist', fontSize: 14, fontWeight: FontWeight.w600),
                  ),
                  icon: const SbIcon(WorkIcons.briefcase, size: 16, color: Color(0xFFF7C46A)),
                  label: const Text('Back to work'),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

/// Opens a customer's home in the home app, with the staff member's rights there (X-Home-Id, like the
/// web console's "See what the owner sees").
Future<void> openAsCustomer(BuildContext context, WidgetRef ref, String homeId) async {
  await ref.read(sessionProvider.notifier).openHome(homeId);
  ref.read(customerViewProvider.notifier).open(homeId);
  if (context.mounted) context.go(Routes.home);
}

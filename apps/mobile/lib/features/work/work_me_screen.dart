import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/config/app_settings.dart';
import '../../core/theme/sb_colors.dart';
import '../../core/theme/sb_icons.dart';
import '../../shared/widgets/common.dart';
import '../../state/session.dart';
import '../../state/work.dart';
import '../me/change_password.dart';
import 'work_icons.dart';
import 'work_routes.dart';
import 'work_widgets.dart';

/// Me, at work: who I am on the team, the switch to my own home (for staff who have one), the office
/// lists (stock, visit requests, quotes, power), appearance and signing out.
class WorkMeScreen extends ConsumerWidget {
  const WorkMeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.sb;
    final me = ref.watch(sessionProvider).value;
    final rights = ref.watch(workRightsProvider);
    final theme = ref.watch(themeModeProvider);
    if (me == null || rights == null) return const SizedBox.shrink();
    final staff = me.staff!;

    return WorkPage(
      back: false,
      children: [
        const SizedBox(height: 18),
        Center(
          child: Avatar(me.initials, size: 80, background: c.tx, foreground: c.bg),
        ),
        const SizedBox(height: 10),
        Text(
          me.name,
          textAlign: TextAlign.center,
          style: TextStyle(fontSize: 22, fontWeight: FontWeight.w600, letterSpacing: -.44, color: c.tx),
        ),
        Text(
          '${rights.role.label} · ${staff.orgName}',
          textAlign: TextAlign.center,
          style: TextStyle(fontSize: 14, color: c.mu),
        ),
        if (rights.readOnly) ...[
          const SizedBox(height: 14),
          const ReadOnlyBar(text: 'You can look into every home to help its people. Tickets you can answer.'),
        ],
        if (me.homes.isNotEmpty) ...[
          const SizedBox(height: 20),
          GroupCard(
            children: [
              WorkRow(
                icon: SbIcons.house,
                iconBg: c.onSoft,
                iconFg: c.onText,
                title: 'Switch to My home',
                subtitle: me.homes.length == 1 ? me.homes.first.name : '${me.homes.length} homes',
                onTap: () => switchToMyHome(ref),
              ),
            ],
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(4, 8, 4, 0),
            child: Text('The app remembers which one you used last.', style: TextStyle(fontSize: 13, color: c.mu)),
          ),
        ],
        if (rights.seesStock || rights.seesVisitRequests || rights.seesQuotes) ...[
          const GroupLabel('Office'),
          GroupCard(
            children: [
              if (rights.seesStock)
                WorkRow(
                  icon: WorkIcons.package,
                  iconBg: c.acSoft,
                  iconFg: c.acText,
                  title: 'Stock',
                  subtitle: rights.canAssignStock ? 'Boards in stock, give one to a home' : 'Boards in stock',
                  onTap: () => context.openWork(WorkRoutes.stock),
                ),
              if (rights.seesVisitRequests)
                WorkRow(
                  icon: WorkIcons.calendar,
                  iconBg: c.okSoft,
                  iconFg: c.okText,
                  title: 'Visit requests',
                  subtitle: 'From the website',
                  onTap: () => context.openWork(WorkRoutes.requests),
                ),
              if (rights.seesQuotes)
                WorkRow(
                  icon: WorkIcons.receipt,
                  iconBg: c.onSoft,
                  iconFg: c.onText,
                  title: 'Quotes',
                  onTap: () => context.openWork(WorkRoutes.quotes),
                ),
              WorkRow(
                icon: SbIcons.zap,
                iconBg: c.badSoft,
                iconFg: c.badText,
                title: 'Power & outages',
                subtitle: 'Power cuts and boards down, last 7 days',
                onTap: () => context.openWork(WorkRoutes.outages),
              ),
            ],
          ),
        ],
        const SizedBox(height: 20),
        GroupCard(
          children: [
            WorkRow(
              icon: theme == ThemeMode.dark ? SbIcons.moon : SbIcons.sun,
              title: 'Appearance',
              value: switch (theme) {
                ThemeMode.light => 'Light',
                ThemeMode.dark => 'Dark',
                ThemeMode.system => 'Like my phone',
              },
              onTap: () => ref.read(themeModeProvider.notifier).set(switch (theme) {
                ThemeMode.system => ThemeMode.light,
                ThemeMode.light => ThemeMode.dark,
                ThemeMode.dark => ThemeMode.system,
              }),
            ),
            WorkRow(icon: SbIcons.lock, title: 'Change password', onTap: () => showChangePassword(context)),
            WorkRow(
              icon: SbIcons.globe,
              title: 'Server',
              value: Uri.tryParse(ref.watch(serverUrlProvider) ?? '')?.host ?? '',
            ),
            InkWell(
              onTap: () => ref.read(sessionProvider.notifier).signOut(),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                child: Row(
                  children: [
                    Container(
                      width: 36,
                      height: 36,
                      decoration: BoxDecoration(color: c.badSoft, borderRadius: BorderRadius.circular(11)),
                      child: Center(
                        child: SbIcon(SbIcons.signOut, size: 18, color: c.badText, weight: IconWeight.duotone),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Text(
                      'Sign out',
                      style: TextStyle(fontSize: 15.5, fontWeight: FontWeight.w500, color: c.badText),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ],
    );
  }
}

/// From work to the person's own home (the one they used last, else their first).
Future<void> switchToMyHome(WidgetRef ref) async {
  final me = ref.read(sessionProvider).value;
  if (me == null || me.homes.isEmpty) return;
  ref.read(customerViewProvider.notifier).close();
  final own = me.homes.any((h) => h.id == me.home?.id);
  if (!own) {
    try {
      await ref.read(sessionProvider.notifier).openHome(me.homes.first.id);
    } catch (e) {
      toastError(ref, e);
      return;
    }
  }
  await ref.read(workChoiceProvider.notifier).set(false);
}

/// From the home app to work (staff only).
Future<void> switchToWork(WidgetRef ref) async {
  ref.read(customerViewProvider.notifier).close();
  await ref.read(workChoiceProvider.notifier).set(true);
}

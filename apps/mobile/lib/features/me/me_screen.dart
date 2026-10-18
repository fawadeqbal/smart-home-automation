import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/config/app_settings.dart';
import '../../core/routing/routes.dart';
import '../../core/theme/sb_colors.dart';
import '../../core/theme/sb_icons.dart';
import '../../core/theme/sb_icons_more.dart';
import '../../data/models/alert_groups.dart';
import '../../data/models/energy.dart';
import '../../data/models/session.dart';
import '../../shared/widgets/common.dart';
import '../../shared/widgets/pill.dart';
import '../../state/home_overview.dart';
import '../../state/local_control.dart';
import '../../state/money.dart';
import '../../state/people.dart';
import '../../state/session.dart';
import '../../voice/hands_free_ui.dart';
import '../health/ask_for_help.dart';
import '../home/home_actions.dart';
import 'sharing.dart';

/// The Me tab: a hub for everything that isn't switching things — the home (people, health,
/// activity, summary, installation), electricity and bills, help, and you (account, notifications,
/// appearance, sign out). Grouped so each page is easy to find.
class MeScreen extends ConsumerWidget {
  const MeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.sb;
    final me = ref.watch(meProvider);
    final home = me.home!;
    final manages = home.manages;
    final health = ref.watch(homeHealthProvider);
    final members = ref.watch(membersProvider).value;
    final welcome = ref.watch(homeWelcomeProvider).value;
    final prefs = ref.watch(prefsProvider).value ?? const [];
    final theme = ref.watch(themeModeProvider);
    final bill = ref.watch(billProvider).value;
    final week = ref.watch(homeEnergyProvider).value;
    final billing = ref.watch(billingQuietProvider).value;
    final owner = members?.where((m) => m.role == HomeRole.owner).firstOrNull?.name.split(' ').first;
    final open = context.openInTab;

    // "151 units · ~Rs 9,300" from the meter readings, else this week's estimate
    final electricity = bill != null && bill.loaded && bill.units > 0
        ? '${Energy.units(bill.units)} units · ~${Energy.rupees(bill.costProjected ?? bill.costSoFar)}'
        : week != null && week.loaded && week.kwh >= .05
            ? '~${Energy.units(week.kwh)} units this week'
            : 'Use and load-shedding';
    // short, so the row stays on one line: "Rs 4,300 to pay" (red when one is late), else the plan
    final plan = billing == null || !billing.loaded
        ? null
        : billing.due > 0
            ? '${Energy.rupees(billing.due)} to pay'
            : billing.contract?.plan ?? 'No plan';

    return ListView(
      padding: EdgeInsets.fromLTRB(18, MediaQuery.paddingOf(context).top + 4, 18, 130),
      children: [
        const SizedBox(height: 18),
        Center(child: Avatar(me.initials, size: 80, background: c.on, foreground: SbColors.onInk)),
        const SizedBox(height: 10),
        Text(
          me.name,
          textAlign: TextAlign.center,
          style: TextStyle(fontSize: 22, fontWeight: FontWeight.w600, letterSpacing: -.44, color: c.tx),
        ),
        Text(
          '${home.viaStaff ? 'Looking in as ${me.staff?.role.toLowerCase() ?? 'staff'}' : home.role.label} · ${home.name}',
          textAlign: TextAlign.center,
          style: TextStyle(fontSize: 14, color: c.mu),
        ),
        const SizedBox(height: 22),

        const GroupLabel('Your home'),
        GroupCard(
          children: [
            if (manages)
              InfoRow(
                icon: SbIcons.users,
                title: 'Family',
                tint: (c.acSoft, c.acText),
                trailing: _Value(members == null ? null : '${members.where((m) => !m.disabled).length} people'),
                onTap: () => open(Routes.family),
              ),
            if (manages)
              InfoRow(
                icon: SbIcons.shield,
                title: 'Home health',
                tint: health.ok ? (c.okSoft, c.okText) : (c.badSoft, c.badText),
                trailing: _Value(health.ok ? 'All good' : '${health.down.length} problem${health.down.length == 1 ? '' : 's'}'),
                onTap: () => open(Routes.health),
              ),
            InfoRow(icon: SbIcons.pulse, title: 'Activity', trailing: const _Value(null), onTap: () => open(Routes.activity)),
            InfoRow(icon: MoreIcons.chart, title: 'Summary', trailing: const _Value('Today, this week'), onTap: () => open(Routes.summary)),
            if (manages) InfoRow(icon: MoreIcons.listChecks, title: 'Installation report', trailing: const _Value(null), onTap: () => open(Routes.installation)),
            if (!kIsWeb && (ref.watch(localBundleProvider)?.boards.isNotEmpty ?? false))
              InfoRow(icon: SbIcons.wifiSlash, title: 'Control over home Wi‑Fi', trailing: const _Value('No internet needed'), onTap: () => context.go(Routes.local)),
            if (me.homes.length > 1)
              InfoRow(icon: SbIcons.house, title: 'Switch home', trailing: _Value('${me.homes.length} homes'), onTap: () => showHomePicker(context, ref)),
          ],
        ),
        if (!manages && !home.viaStaff)
          _Hint('Need another room? Ask ${owner ?? 'the home’s owner'} — they can share it with you.'),
        if (home.accessSummary != null && !manages) _Hint('Your access here: ${home.accessSummary}.'),
        if (!home.viaStaff && home.blocked == null) ...[
          const SizedBox(height: 12),
          const ShareWhenHome(),
        ],
        const SizedBox(height: 22),

        GroupLabel(manages ? 'Electricity & bills' : 'Electricity'),
        GroupCard(
          children: [
            InfoRow(icon: SbIcons.zap, title: 'Electricity', tint: (c.onSoft, c.onText), trailing: _Value(electricity), onTap: () => open(Routes.energy)),
            if (manages)
              InfoRow(
                icon: MoreIcons.wallet,
                title: 'Plan & bills',
                tint: billing?.anyLate ?? false ? (c.badSoft, c.badText) : (c.okSoft, c.okText),
                trailing: billing?.due != null && billing!.due > 0
                    ? Row(mainAxisSize: MainAxisSize.min, children: [
                        Pill(plan!, tone: billing.anyLate ? PillTone.bad : PillTone.warn),
                        const SizedBox(width: 6),
                        SbIcon(SbIcons.caretRight, size: 16, color: c.mu),
                      ])
                    : _Value(plan),
                onTap: () => open(Routes.billing),
              ),
          ],
        ),
        const SizedBox(height: 22),

        const GroupLabel('Help'),
        GroupCard(
          children: [
            InfoRow(icon: MoreIcons.book, title: 'Help center', trailing: const _Value('Guides and answers'), onTap: () => open(Routes.help)),
            if (!home.readOnly) InfoRow(icon: SbIcons.envelope, title: 'Help requests', trailing: const _Value(null), onTap: () => showHelpRequests(context)),
            if (manages && welcome?.installer != null && welcome!.installer != me.name)
              InfoRow(
                icon: SbIcons.message,
                title: 'Message your expert',
                tint: (c.onSoft, c.onText),
                trailing: _Value(welcome.installer!.split(' ').first),
                onTap: () => showAskForHelp(context, welcome.installer!),
              ),
          ],
        ),
        const SizedBox(height: 22),

        const GroupLabel('You'),
        GroupCard(
          children: [
            InfoRow(icon: MoreIcons.key, title: 'Account & security', trailing: const _Value(null), onTap: () => open(Routes.account)),
            InfoRow(icon: SbIcons.bell, title: 'Notifications', trailing: _Value(alertsSummary(prefs, staff: me.staff != null)), onTap: () => open(Routes.alerts)),
            InfoRow(
              icon: theme == ThemeMode.dark ? SbIcons.moon : SbIcons.sun,
              title: 'Appearance',
              trailing: _Value(switch (theme) {
                ThemeMode.light => 'Light',
                ThemeMode.dark => 'Dark',
                ThemeMode.system => 'Like my phone',
              }),
              onTap: () => ref.read(themeModeProvider.notifier).set(switch (theme) {
                ThemeMode.system => ThemeMode.light,
                ThemeMode.light => ThemeMode.dark,
                ThemeMode.dark => ThemeMode.system,
              }),
            ),
            InfoRow(icon: SbIcons.globe, title: 'Server', trailing: _Value(Uri.tryParse(ref.watch(serverUrlProvider) ?? '')?.host ?? '', arrow: false)),
          ],
        ),
        const SizedBox(height: 12),
        const HandsFreeSettings(),
        const SizedBox(height: 12),
        GroupCard(
          children: [
            InfoRow(
              icon: SbIcons.signOut,
              title: 'Sign out',
              tint: (c.badSoft, c.badText),
              titleColor: c.badText,
              trailing: const SizedBox.shrink(),
              onTap: () => ref.read(sessionProvider.notifier).signOut(),
            ),
          ],
        ),
      ],
    );
  }
}

/// The grey value on the right of a row, with the arrow.
class _Value extends StatelessWidget {
  const _Value(this.text, {this.arrow = true});
  final String? text;
  final bool arrow;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    return ConstrainedBox(
      constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width * .42),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (text != null && text!.isNotEmpty)
            Flexible(child: Text(text!, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 13.5, color: c.mu))),
          if (arrow) ...[const SizedBox(width: 6), SbIcon(SbIcons.caretRight, size: 16, color: c.mu)],
        ],
      ),
    );
  }
}

class _Hint extends StatelessWidget {
  const _Hint(this.text);
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(4, 8, 4, 0),
        child: Text(text, style: TextStyle(fontSize: 13.5, color: context.sb.mu)),
      );
}

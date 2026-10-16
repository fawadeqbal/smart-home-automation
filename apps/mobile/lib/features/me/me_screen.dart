import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/config/app_settings.dart';
import '../../core/network/api_exception.dart';
import '../../core/routing/routes.dart';
import '../../core/theme/sb_colors.dart';
import '../../core/theme/sb_icons.dart';
import '../../data/models/session.dart';
import '../../shared/widgets/common.dart';
import '../../shared/widgets/sb_switch.dart';
import '../../state/home_overview.dart';
import '../../state/people.dart';
import '../../state/session.dart';
import '../../state/toast.dart';
import '../../voice/hands_free_ui.dart';
import '../health/ask_for_help.dart';
import '../home/home_actions.dart';
import 'change_password.dart';

/// Alerts in the owner's words; each switch covers a few of the real notification settings.
/// People only see the ones the server offers them (board alerts are for owners and admins).
const _alertGroups = [
  (
    'Something stops working',
    ['boardOffline', 'boardHealth', 'scheduleFailed'],
  ),
  ('Water, doors and heat', ['leak', 'doorAtNight', 'temperature']),
  ('Movement at night', ['motionAtNight']),
];

/// The Me tab: you, your home, alerts, appearance, sign out.
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
    final owner = members?.where((m) => m.role == HomeRole.owner).firstOrNull?.name.split(' ').first;

    Widget row(
      SbIconData icon,
      String title, {
      String? value,
      Color? bg,
      Color? fg,
      VoidCallback? onTap,
      Color? text,
    }) => InkWell(
      onTap: onTap,
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: 56),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
          child: Row(
            children: [
              Container(
                width: 34,
                height: 34,
                decoration: BoxDecoration(
                  color: bg ?? c.sf2,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Center(
                  child: SbIcon(
                    icon,
                    size: 18,
                    color: fg ?? c.tx,
                    weight: IconWeight.duotone,
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  title,
                  style: TextStyle(
                    fontSize: 15.5,
                    fontWeight: FontWeight.w500,
                    color: text ?? c.tx,
                  ),
                ),
              ),
              if (value != null) Text(value, style: TextStyle(fontSize: 13.5, color: c.mu)),
              if (onTap != null && text == null) ...[
                const SizedBox(width: 6),
                SbIcon(SbIcons.caretRight, size: 16, color: c.mu),
              ],
            ],
          ),
        ),
      ),
    );

    return ListView(
      padding: EdgeInsets.fromLTRB(
        18,
        MediaQuery.paddingOf(context).top + 4,
        18,
        130,
      ),
      children: [
        const SizedBox(height: 18),
        Center(
          child: Avatar(
            me.initials,
            size: 80,
            background: c.on,
            foreground: SbColors.onInk,
          ),
        ),
        const SizedBox(height: 10),
        Text(
          me.name,
          textAlign: TextAlign.center,
          style: TextStyle(
            fontSize: 22,
            fontWeight: FontWeight.w600,
            letterSpacing: -.44,
            color: c.tx,
          ),
        ),
        Text(
          '${home.viaStaff ? 'Looking in as ${me.staff?.role.toLowerCase() ?? 'staff'}' : home.role.label} · ${home.name}',
          textAlign: TextAlign.center,
          style: TextStyle(fontSize: 14, color: c.mu),
        ),
        const SizedBox(height: 20),
        GroupCard(
          children: [
            if (manages)
              row(
                SbIcons.users,
                'Family',
                value: members == null ? null : '${members.where((m) => !m.disabled).length} people',
                bg: c.acSoft,
                fg: c.acText,
                onTap: () => context.openInTab(Routes.family),
              ),
            if (manages)
              row(
                SbIcons.shield,
                'Home health',
                value: health.ok ? 'All good' : '${health.down.length} problem${health.down.length == 1 ? '' : 's'}',
                bg: health.ok ? c.okSoft : c.badSoft,
                fg: health.ok ? c.okText : c.badText,
                onTap: () => context.openInTab(Routes.health),
              ),
            row(
              SbIcons.pulse,
              'Activity',
              onTap: () => context.openInTab(Routes.activity),
            ),
            if (manages && welcome?.installer != null && welcome!.installer != me.name)
              row(
                SbIcons.message,
                'Message your expert',
                value: welcome.installer!.split(' ').first,
                bg: c.onSoft,
                fg: c.onText,
                onTap: () => showAskForHelp(context, welcome.installer!),
              ),
            if (!home.readOnly)
              row(
                SbIcons.envelope,
                'Help requests',
                onTap: () => showHelpRequests(context),
              ),
            if (me.homes.length > 1)
              row(
                SbIcons.house,
                'Switch home',
                value: '${me.homes.length} homes',
                onTap: () => showHomePicker(context, ref),
              ),
          ],
        ),
        if (!manages && !home.viaStaff)
          Padding(
            padding: const EdgeInsets.fromLTRB(4, 8, 4, 0),
            child: Text(
              'Need another room? Ask ${owner ?? 'the home’s owner'} — they can share it with you.',
              style: TextStyle(fontSize: 13.5, color: c.mu),
            ),
          ),
        if (prefs.isNotEmpty) ...[
          const SizedBox(height: 20),
          Padding(
            padding: const EdgeInsets.only(left: 4, bottom: 8),
            child: Text(
              'NOTIFY ME WHEN',
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w600,
                color: c.mu,
              ),
            ),
          ),
          GroupCard(
            children: [
              for (final (title, keys) in _alertGroups)
                if (prefs.any((p) => keys.contains(p.key))) _AlertRow(title: title, keys: keys),
            ],
          ),
        ],
        const SizedBox(height: 20),
        const HandsFreeSettings(),
        const SizedBox(height: 20),
        GroupCard(
          children: [
            row(
              theme == ThemeMode.dark ? SbIcons.moon : SbIcons.sun,
              'Appearance',
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
            row(
              SbIcons.lock,
              'Change password',
              onTap: () => showChangePassword(context),
            ),
            row(
              SbIcons.globe,
              'Server',
              value: Uri.tryParse(ref.watch(serverUrlProvider) ?? '')?.host ?? '',
            ),
            row(
              SbIcons.signOut,
              'Sign out',
              bg: c.badSoft,
              fg: c.badText,
              text: c.badText,
              onTap: () => ref.read(sessionProvider.notifier).signOut(),
            ),
          ],
        ),
      ],
    );
  }
}

class _AlertRow extends ConsumerWidget {
  const _AlertRow({required this.title, required this.keys});
  final String title;
  final List<String> keys;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.sb;
    final prefs = (ref.watch(prefsProvider).value ?? const []).where((p) => keys.contains(p.key)).toList();
    final on = prefs.any((p) => p.enabled);
    Future<void> toggle() async {
      try {
        await ref.read(prefsProvider.notifier).set({
          for (final p in prefs) p.key: !on,
        });
      } catch (e) {
        ref.read(toastProvider.notifier).show(ApiException.from(e).message, error: true);
      }
    }

    return InkWell(
      onTap: toggle,
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: 56),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  title,
                  style: TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w500,
                    color: c.tx,
                  ),
                ),
              ),
              SbSwitch(
                value: on,
                onChanged: (_) => toggle(),
                semanticLabel: title,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

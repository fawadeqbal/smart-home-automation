import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/network/api_exception.dart';
import '../../core/theme/sb_colors.dart';
import '../../data/models/alert_groups.dart';
import '../../data/models/people.dart';
import '../../shared/widgets/common.dart';
import '../../shared/widgets/pill.dart';
import '../../shared/widgets/sb_switch.dart';
import '../../state/people.dart';
import '../../state/session.dart';
import '../../state/toast.dart';
import '../me/sharing.dart';

/// Notification settings, like the web's /notifications side panel: every kind of notice, by topic,
/// each with its own switch, and alerts on this phone.
class AlertSettingsScreen extends ConsumerWidget {
  const AlertSettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.sb;
    final prefs = ref.watch(prefsProvider);
    final staff = ref.watch(meProvider.select((m) => m.staff != null));
    return RefreshIndicator(
      color: c.on,
      onRefresh: () => ref.refresh(prefsProvider.future),
      child: ListView(
        padding: EdgeInsets.fromLTRB(18, MediaQuery.paddingOf(context).top + 4, 18, 130),
        children: [
          BackPill(onTap: () => context.pop()),
          const SizedBox(height: 12),
          const PageTitle('Notifications', subtitle: 'Choose what you hear about. These are yours alone — everyone in the home chooses their own.'),
          const SizedBox(height: 18),
          const PhoneAlertsRow(),
          const SizedBox(height: 18),
          prefs.when(
            loading: () => const LoadingView(),
            error: (e, _) => ErrorView(error: e, onRetry: () => ref.invalidate(prefsProvider)),
            data: (list) => Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                for (final (title, items) in groupAlerts(list, staff: staff)) ...[
                  GroupLabel(title),
                  GroupCard(children: [for (final p in items) _PrefRow(pref: p)]),
                  const SizedBox(height: 18),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _PrefRow extends ConsumerWidget {
  const _PrefRow({required this.pref});
  final NotificationPref pref;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.sb;
    Future<void> toggle() async {
      try {
        await ref.read(prefsProvider.notifier).set({pref.key: !pref.enabled});
      } catch (e) {
        ref.read(toastProvider.notifier).show(ApiException.from(e).message, error: true);
      }
    }

    return InkWell(
      onTap: toggle,
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: 56),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          child: Row(
            children: [
              Expanded(child: Text(pref.label, style: TextStyle(fontSize: 15, fontWeight: FontWeight.w500, color: c.tx, height: 1.3))),
              const SizedBox(width: 10),
              SbSwitch(value: pref.enabled, onChanged: (_) => toggle(), semanticLabel: pref.label),
            ],
          ),
        ),
      ),
    );
  }
}

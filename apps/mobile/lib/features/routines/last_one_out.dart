import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_exception.dart';
import '../../core/theme/sb_colors.dart';
import '../../core/theme/sb_icons.dart';
import '../../data/models/presence.dart';
import '../../data/repositories/notices_repository.dart';
import '../../shared/widgets/common.dart';
import '../../shared/widgets/sb_switch.dart';
import '../../state/session.dart';
import '../../state/toast.dart';

/// The home's "when everyone leaves" rule (owners and admins).
final presenceRuleProvider = FutureProvider<PresenceRuleState?>((ref) async {
  final home = ref.watch(sessionProvider.select((s) => s.value?.home));
  if (home == null || !home.manages) return null;
  try {
    return await ref.read(noticesRepositoryProvider).rule();
  } catch (_) {
    return null; // an older server
  }
});

/// Routines → "When everyone leaves": lights and fans off, away mode, tell me; a scene when someone's back.
/// Picking exact devices is on the web (Automations).
class LastOneOutCard extends ConsumerWidget {
  const LastOneOutCard({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.sb;
    final s = ref.watch(presenceRuleProvider).value;
    if (s == null) return const SizedBox.shrink();
    final r = s.rule;
    Future<void> save(Map<String, Object?> change) async {
      try {
        final body = <String, Object?>{
          'enabled': r?.enabled ?? true,
          'switchOff': r?.switchOff ?? 'lights',
          'awayMode': r?.awayMode ?? true,
          'notify': r?.notify ?? true,
          ...change,
        };
        await ref.read(noticesRepositoryProvider).setRule(body);
        ref.invalidate(presenceRuleProvider);
      } catch (e) {
        ref.read(toastProvider.notifier).show(ApiException.from(e).message, error: true);
      }
    }

    Widget row(String title, bool value, ValueChanged<bool> onChanged, {String? sub}) => Padding(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: TextStyle(fontSize: 15, fontWeight: FontWeight.w500, color: c.tx)),
                if (sub != null) Text(sub, style: TextStyle(fontSize: 12.5, color: c.mu)),
              ],
            ),
          ),
          SbSwitch(value: value, onChanged: onChanged, semanticLabel: title),
        ],
      ),
    );

    final lights = s.lightsAndFans.isEmpty ? 'Nothing is named a light or fan yet' : s.lightsAndFans.join(', ');
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SectionHeader('When everyone leaves', subtitle: 'Counts the people who share when they’re home'),
        const SizedBox(height: 10),
        if (s.sharers == 0)
          const Padding(
            padding: EdgeInsets.only(bottom: 10),
            child: Note(
              tone: NoteTone.info,
              icon: SbIcons.users,
              child: Text('Nobody shares when they’re home yet. Each person turns it on in Me → Share when I’m home.'),
            ),
          ),
        GroupCard(
          children: [
            row('Do something when the last one leaves', r?.enabled ?? false, (v) => save({'enabled': v})),
            if (r != null && r.enabled) ...[
              if (r.switchOff != 'chosen')
                row('Switch off lights and fans', r.switchOff == 'lights', (v) => save({'switchOff': v ? 'lights' : 'none'}), sub: lights)
              else
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                  child: Text('Switches off the devices picked on the web (Automations).', style: TextStyle(fontSize: 14, color: c.mu)),
                ),
              row('Turn on away mode', r.awayMode, (v) => save({'awayMode': v}), sub: 'Off again when someone comes home'),
              row('Tell me', r.notify, (v) => save({'notify': v})),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                child: Row(
                  children: [
                    Expanded(child: Text('When someone comes home', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w500, color: c.tx))),
                    DropdownButton<String?>(
                      value: s.scenes.any((x) => x.id == r.arriveSceneId) ? r.arriveSceneId : null,
                      underline: const SizedBox.shrink(),
                      items: [
                        const DropdownMenuItem<String?>(value: null, child: Text('Nothing')),
                        for (final sc in s.scenes) DropdownMenuItem<String?>(value: sc.id, child: Text(sc.name)),
                      ],
                      onChanged: (v) => save({'arriveSceneId': v}),
                    ),
                  ],
                ),
              ),
              if (r.lastResult != null)
                Padding(
                  padding: const EdgeInsets.fromLTRB(14, 4, 14, 12),
                  child: Text('Last time: ${r.lastResult}', style: TextStyle(fontSize: 12.5, color: c.mu)),
                ),
            ],
          ],
        ),
      ],
    );
  }
}

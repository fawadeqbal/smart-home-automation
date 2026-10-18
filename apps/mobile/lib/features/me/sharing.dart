import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_exception.dart';
import '../../core/theme/sb_colors.dart';
import '../../core/theme/sb_icons.dart';
import '../../push/push.dart';
import '../../shared/widgets/common.dart';
import '../../shared/widgets/sb_switch.dart';
import '../../state/presence.dart';
import '../../state/toast.dart';

/// Me: "Share when I'm home" (off until turned on). One line says what it does.
class ShareWhenHome extends ConsumerWidget {
  const ShareWhenHome({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.sb;
    final s = ref.watch(sharingProvider).value;
    if (s == null || !s.canShare || kIsWeb) return const SizedBox.shrink();
    Future<void> toggle(bool on) async {
      try {
        await ref.read(sharingProvider.notifier).set(on);
      } catch (e) {
        ref.read(toastProvider.notifier).show(ApiException.from(e).message, error: true);
      }
    }

    return GroupCard(
      children: [
        InkWell(
          onTap: () => toggle(!s.sharing),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            child: Row(
              children: [
                Container(
                  width: 34,
                  height: 34,
                  decoration: BoxDecoration(color: s.sharing ? c.okSoft : c.sf2, borderRadius: BorderRadius.circular(10)),
                  child: Center(child: SbIcon(SbIcons.house, size: 18, color: s.sharing ? c.okText : c.tx, weight: IconWeight.duotone)),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Share when I’m home', style: TextStyle(fontSize: 15.5, fontWeight: FontWeight.w500, color: c.tx)),
                      const SizedBox(height: 2),
                      Text(
                        'This phone tells the home when it’s on your home Wi‑Fi, so lights can go off when the last one leaves. No location is used.',
                        style: TextStyle(fontSize: 13, color: c.mu, height: 1.35),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 10),
                SbSwitch(value: s.sharing, onChanged: toggle, semanticLabel: 'Share when I’m home'),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

/// Me: are alerts on for this phone? Offers to turn them on when they're off.
class PhoneAlertsRow extends ConsumerStatefulWidget {
  const PhoneAlertsRow({super.key});

  @override
  ConsumerState<PhoneAlertsRow> createState() => _PhoneAlertsRowState();
}

class _PhoneAlertsRowState extends ConsumerState<PhoneAlertsRow> {
  PushAsk? _status;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final s = await ref.read(pushControllerProvider).status();
    if (mounted) setState(() => _status = s);
  }

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final s = _status;
    if (s == null || s == PushAsk.notAvailable) return const SizedBox.shrink();
    final on = s == PushAsk.granted;
    return GroupCard(
      children: [
        InkWell(
          onTap: on
              ? null
              : () async {
                  final ok = await ref.read(pushControllerProvider).ask();
                  if (!ok) {
                    ref.read(toastProvider.notifier).show('Alerts are off for Switchboard. Turn them on in the phone’s Settings → Apps → Switchboard → Notifications.');
                  }
                  await _load();
                },
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            child: Row(
              children: [
                Container(
                  width: 34,
                  height: 34,
                  decoration: BoxDecoration(color: on ? c.okSoft : c.onSoft, borderRadius: BorderRadius.circular(10)),
                  child: Center(child: SbIcon(SbIcons.bell, size: 18, color: on ? c.okText : c.onText, weight: IconWeight.duotone)),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    on ? 'Alerts on this phone are on' : 'Get alerts on this phone',
                    style: TextStyle(fontSize: 15.5, fontWeight: FontWeight.w500, color: c.tx),
                  ),
                ),
                if (!on) Text('Turn on', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: c.acText)),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:share_plus/share_plus.dart';

import '../../core/network/api_exception.dart';
import '../../core/theme/sb_colors.dart';
import '../../core/theme/sb_icons.dart';
import '../../core/theme/sb_icons_more.dart';
import '../../data/models/energy.dart';
import '../../data/repositories/home_repository.dart';
import '../../shared/widgets/common.dart';
import '../../shared/widgets/segmented.dart';
import '../../state/money.dart';
import '../../state/session.dart';
import '../../state/toast.dart';

SbIconData _iconFor(String head) => switch (head) {
      'Power' => SbIcons.zap,
      'Internet' => SbIcons.wifiSlash,
      'Electricity' => SbIcons.lightbulb,
      'Automations' => SbIcons.clock,
      'Alerts' => SbIcons.bell,
      'Boards' => MoreIcons.cpu,
      _ => SbIcons.pulse,
    };

/// How the home did today or this week, in a few lines — to read here or send to the family
/// (like the web's /summary).
class SummaryScreen extends ConsumerStatefulWidget {
  const SummaryScreen({super.key});

  @override
  ConsumerState<SummaryScreen> createState() => _SummaryScreenState();
}

class _SummaryScreenState extends ConsumerState<SummaryScreen> {
  String _period = 'week';
  bool _sending = false;

  Future<void> _email() async {
    setState(() => _sending = true);
    try {
      final to = await ref.read(homeRepositoryProvider).emailSummary(_period);
      ref.read(toastProvider.notifier).show('Sent to $to');
    } catch (e) {
      ref.read(toastProvider.notifier).show(ApiException.from(e).message, error: true);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final summary = ref.watch(summaryForProvider(_period));
    final manages = ref.watch(meProvider.select((m) => m.home?.manages ?? false));
    final s = summary.value;
    return RefreshIndicator(
      color: c.on,
      onRefresh: () => ref.refresh(summaryForProvider(_period).future),
      child: ListView(
        padding: EdgeInsets.fromLTRB(18, MediaQuery.paddingOf(context).top + 4, 18, 130),
        children: [
          BackPill(onTap: () => context.pop()),
          const SizedBox(height: 12),
          const PageTitle('Summary', subtitle: 'How the home did, in a few lines — to read here or send to the family.'),
          const SizedBox(height: 16),
          Segmented<String>(options: const [('day', 'Today'), ('week', 'This week')], value: _period, onChanged: (v) => setState(() => _period = v)),
          const SizedBox(height: 14),
          if (s == null)
            summary.hasError ? ErrorView(error: summary.error!, onRetry: () => ref.invalidate(summaryForProvider(_period))) : const LoadingView()
          else ...[
            GroupCard(
              radius: 22,
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 14, 16, 6),
                  child: Row(
                    children: [
                      Expanded(child: Text(s.home, style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600, color: c.tx))),
                      Text(s.range, style: TextStyle(fontSize: 13, color: c.mu)),
                    ],
                  ),
                ),
                for (final line in s.lines)
                  Builder(builder: (context) {
                    final (head, rest) = HomeSummary.split(line);
                    return Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Container(
                            width: 32,
                            height: 32,
                            decoration: BoxDecoration(color: c.sf2, borderRadius: BorderRadius.circular(10)),
                            child: Center(child: SbIcon(_iconFor(head), size: 16, color: c.tx)),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Padding(
                              padding: const EdgeInsets.only(top: 5),
                              child: Text.rich(
                                TextSpan(children: [
                                  if (head.isNotEmpty) TextSpan(text: '$head: ', style: const TextStyle(fontWeight: FontWeight.w600)),
                                  TextSpan(text: rest),
                                ]),
                                style: TextStyle(fontSize: 14.5, color: c.tx, height: 1.35),
                              ),
                            ),
                          ),
                        ],
                      ),
                    );
                  }),
              ],
            ),
            const SizedBox(height: 14),
            BigButton(label: 'Send to the family', icon: SbIcons.share, onTap: () => SharePlus.instance.share(ShareParams(text: s.text))),
            if (s.mail) ...[
              const SizedBox(height: 10),
              BigButton(label: 'Email it to me', icon: SbIcons.envelope, busy: _sending, color: c.sf2, foreground: c.tx, height: 50, onTap: _email),
            ],
            const SizedBox(height: 12),
            Text(
              manages ? 'Owners and admins get the week’s summary every Sunday evening. Turn the daily one on in Notifications.' : 'It counts the rooms you can see.',
              style: TextStyle(fontSize: 13, color: c.mu),
            ),
          ],
        ],
      ),
    );
  }
}

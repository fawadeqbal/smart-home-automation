import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/network/api_exception.dart';
import '../../core/theme/sb_colors.dart';
import '../../core/theme/sb_icons.dart';
import '../../data/models/outages.dart';
import '../../shared/widgets/common.dart';
import '../../state/devices.dart';
import '../../state/home_overview.dart';
import '../../state/people.dart';
import '../../state/session.dart';
import '../../state/toast.dart';
import 'ask_for_help.dart';
import 'boards_section.dart';

/// Is everything answering? Which rooms aren't, what to try, and who to ask.
class HealthScreen extends ConsumerStatefulWidget {
  const HealthScreen({super.key});

  @override
  ConsumerState<HealthScreen> createState() => _HealthScreenState();
}

class _HealthScreenState extends ConsumerState<HealthScreen> {
  bool _checking = false;

  Future<void> _checkAgain() async {
    setState(() => _checking = true);
    final before = ref.read(homeHealthProvider).down.length;
    try {
      await ref.read(devicesProvider.notifier).refresh();
      ref.invalidate(boardsProvider);
      final after = ref.read(homeHealthProvider).down.length;
      ref
          .read(toastProvider.notifier)
          .show(
            after == 0
                ? 'Everything is back online'
                : after < before
                ? 'Some of it is back online'
                : 'Still not responding — try the steps above',
          );
    } catch (e) {
      ref.read(toastProvider.notifier).show(ApiException.from(e).message, error: true);
    } finally {
      if (mounted) setState(() => _checking = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final health = ref.watch(homeHealthProvider);
    final welcome = ref.watch(homeWelcomeProvider).value;
    final ok = health.ok;
    final names = health.down.map((r) => r.room.name.toLowerCase()).toList();
    final title = ok
        ? 'Everything is working'
        : names.length == 1
        ? 'The ${names.first} isn’t responding'
        : '${names.length} rooms aren’t responding';
    final detail = ok
        ? 'All ${health.rooms.length} room${health.rooms.length == 1 ? ' is' : 's are'} online and answering. You’ll hear from us if that changes.'
        : 'The lights still work from the wall.${welcome?.installer != null ? ' ${welcome!.installer} has been told automatically.' : ''}';

    return ListView(
      padding: EdgeInsets.fromLTRB(
        18,
        MediaQuery.paddingOf(context).top + 4,
        18,
        130,
      ),
      children: [
        BackPill(onTap: () => context.pop()),
        const SizedBox(height: 16),
        Container(
          padding: const EdgeInsets.symmetric(vertical: 26, horizontal: 18),
          decoration: BoxDecoration(
            color: ok ? c.okSoft : c.badSoft,
            borderRadius: BorderRadius.circular(26),
          ),
          child: Column(
            children: [
              _Beacon(ok: ok),
              const SizedBox(height: 12),
              Text(
                title,
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 24,
                  fontWeight: FontWeight.w600,
                  letterSpacing: -.7,
                  color: c.tx,
                  height: 1.15,
                ),
              ),
              const SizedBox(height: 6),
              ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 290),
                child: Text(
                  detail,
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 14.5, color: c.mu),
                ),
              ),
            ],
          ),
        ),
        if (!ok) ...[
          const SizedBox(height: 16),
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: c.sf,
              borderRadius: BorderRadius.circular(22),
              border: Border.all(color: c.ln2),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  'What you can try',
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w600,
                    color: c.tx,
                  ),
                ),
                const SizedBox(height: 12),
                for (final (i, t) in [
                  'Check that the ${names.length == 1 ? names.first : 'rooms'}’ main power is on.',
                  'Restart your Wi‑Fi router — the switchboards reconnect by themselves.',
                ].indexed)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Container(
                          width: 26,
                          height: 26,
                          decoration: BoxDecoration(
                            color: c.sf2,
                            shape: BoxShape.circle,
                          ),
                          child: Center(
                            child: Text(
                              '${i + 1}',
                              style: const TextStyle(
                                fontSize: 13,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Text(
                            t,
                            style: TextStyle(
                              fontSize: 14.5,
                              height: 1.45,
                              color: c.tx,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                const SizedBox(height: 4),
                BigButton(
                  label: _checking ? 'Checking…' : 'Check again',
                  icon: SbIcons.pulse,
                  busy: _checking,
                  height: 50,
                  onTap: _checkAgain,
                ),
              ],
            ),
          ),
        ],
        const SizedBox(height: 16),
        if (health.rooms.isNotEmpty)
          GroupCard(
            radius: 22,
            children: [
              for (final r in health.rooms)
                Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 14,
                    vertical: 13,
                  ),
                  child: Row(
                    children: [
                      _Dot(down: r.notResponding),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Text(
                          r.room.name,
                          style: TextStyle(
                            fontSize: 15,
                            fontWeight: FontWeight.w500,
                            color: c.tx,
                          ),
                        ),
                      ),
                      Text(
                        r.allDown
                            ? 'Not responding'
                            : r.notResponding
                            ? 'Partly responding'
                            : 'Working',
                        style: TextStyle(
                          fontSize: 13,
                          color: r.notResponding ? c.badText : c.mu,
                        ),
                      ),
                    ],
                  ),
                ),
            ],
          ),
        const BoardsSection(),
        const SizedBox(height: 16),
        const _PowerAndInternet(),
        if (welcome?.installer != null && welcome!.installer != ref.watch(meProvider).name) ...[
          const SizedBox(height: 16),
          ExpertCard(name: welcome.installer!, company: welcome.orgName),
        ],
      ],
    );
  }
}

class _Beacon extends StatefulWidget {
  const _Beacon({required this.ok});
  final bool ok;

  @override
  State<_Beacon> createState() => _BeaconState();
}

class _BeaconState extends State<_Beacon> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
    vsync: this,
    duration: const Duration(seconds: 2),
  )..repeat();

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final color = widget.ok ? context.sb.ok : context.sb.bad;
    return SizedBox(
      width: 72,
      height: 72,
      child: Stack(
        alignment: Alignment.center,
        children: [
          AnimatedBuilder(
            animation: _c,
            builder: (_, _) => Transform.scale(
              scale: 1 + _c.value * .9,
              child: Opacity(
                opacity: (1 - _c.value) * .5,
                child: Container(
                  decoration: BoxDecoration(
                    color: color,
                    shape: BoxShape.circle,
                  ),
                ),
              ),
            ),
          ),
          Container(
            width: 72,
            height: 72,
            decoration: BoxDecoration(color: color, shape: BoxShape.circle),
            child: Center(
              child: SbIcon(
                widget.ok ? SbIcons.check : SbIcons.warning,
                size: 32,
                color: Colors.white,
                weight: IconWeight.bold,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _Dot extends StatelessWidget {
  const _Dot({required this.down});
  final bool down;

  @override
  Widget build(BuildContext context) => Container(
    width: 10,
    height: 10,
    decoration: BoxDecoration(
      color: down ? context.sb.bad : context.sb.ok,
      shape: BoxShape.circle,
    ),
  );
}


/// This week's power cuts and Wi-Fi / internet outages (from what the boards report when they come back).
class _PowerAndInternet extends ConsumerWidget {
  const _PowerAndInternet();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.sb;
    final data = ref.watch(homeOutagesProvider).value;
    if (data == null) return const SizedBox.shrink();
    final shown = data.outages.where((o) => o.counts).take(8).toList();
    String when(DateTime d) {
      final now = DateTime.now();
      final day = DateTime(d.year, d.month, d.day);
      final today = DateTime(now.year, now.month, now.day);
      final h = d.hour % 12 == 0 ? 12 : d.hour % 12;
      final time = '$h:${d.minute.toString().padLeft(2, '0')} ${d.hour < 12 ? 'am' : 'pm'}';
      if (day == today) return time;
      if (day == today.subtract(const Duration(days: 1))) return 'Yesterday $time';
      const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      return '${days[d.weekday - 1]} $time';
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.only(left: 4, bottom: 8),
          child: Text('POWER AND INTERNET THIS WEEK', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: c.mu)),
        ),
        GroupCard(
          radius: 22,
          children: [
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
              child: Text(
                data.powerCuts == 0 && data.networkOuts == 0
                    ? 'No power cuts or internet outages this week.'
                    : '${data.powerCuts} power cut${data.powerCuts == 1 ? '' : 's'} (${outageDuration(data.powerSeconds)} without power)'
                        '${data.networkOuts > 0 ? ' · internet down ${data.networkOuts}×' : ''}',
                style: TextStyle(fontSize: 14.5, color: c.tx, fontWeight: FontWeight.w500),
              ),
            ),
            for (final o in shown)
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
                child: Row(
                  children: [
                    SbIcon(o.isPower ? SbIcons.zap : SbIcons.wifiSlash, size: 18, color: o.isPower ? c.badText : c.onText),
                    const SizedBox(width: 12),
                    Expanded(child: Text(o.label, style: TextStyle(fontSize: 14.5, color: c.tx))),
                    Text('${when(o.startedAt)} · ${outageDuration(o.seconds)}', style: TextStyle(fontSize: 13, color: c.mu)),
                  ],
                ),
              ),
          ],
        ),
      ],
    );
  }
}

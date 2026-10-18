import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:share_plus/share_plus.dart';

import '../../core/network/api_exception.dart';
import '../../core/realtime/live_client.dart';
import '../../core/routing/routes.dart';
import '../../core/theme/app_theme.dart';
import '../../core/theme/sb_colors.dart';
import '../../core/theme/sb_icons.dart';
import '../../core/util/format.dart';
import '../../data/models/energy.dart';
import '../../data/models/session.dart';
import '../../shared/widgets/common.dart';
import '../../shared/widgets/pressable.dart';
import '../../shared/widgets/sb_switch.dart';
import '../../shared/widgets/sheet.dart';
import '../../state/activity.dart';
import '../../state/automation.dart';
import '../../state/clock.dart';
import '../../state/devices.dart';
import '../../state/favourites.dart';
import '../../state/home_overview.dart';
import '../../state/local_control.dart';
import '../../state/people.dart';
import '../../state/presence.dart';
import '../../state/session.dart';
import '../../state/toast.dart';
import '../activity/activity_row.dart';
import '../devices/device_grid.dart';
import '../devices/device_tile.dart';
import '../notices/notifications_screen.dart';
import '../rooms/room_card.dart';
import '../routines/scene_card.dart';
import 'home_actions.dart';

/// The Home tab: a greeting over your living room, what's on, how the home is doing, scenes,
/// favourites, rooms and what just happened.
class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final blocked = ref.watch(meProvider.select((m) => m.home?.blocked));
    if (blocked != null) return AccessPausedView(message: blocked);
    final devices = ref.watch(devicesProvider);
    if (devices.value == null) {
      return devices.hasError
          ? Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    ErrorView(
                      error: devices.error!,
                      onRetry: () => ref.invalidate(devicesProvider),
                    ),
                    if (!kIsWeb && (ref.watch(localBundleProvider)?.boards.isNotEmpty ?? false)) ...[
                      const SizedBox(height: 20),
                      BigButton(
                        label: 'Control over home Wi‑Fi',
                        icon: SbIcons.wifiSlash,
                        onTap: () => context.go(Routes.local),
                      ),
                    ],
                  ],
                ),
              ),
            )
          : const LoadingView(label: 'Opening your home…');
    }
    return RefreshIndicator(
      color: context.sb.on,
      onRefresh: () async {
        ref.invalidate(roomsProvider);
        ref.invalidate(scenesProvider);
        ref.invalidate(activityProvider);
        ref.invalidate(powerStatusProvider);
        await ref.read(devicesProvider.notifier).refresh();
      },
      child: ListView(
        padding: EdgeInsets.fromLTRB(
          18,
          MediaQuery.paddingOf(context).top + 8,
          18,
          130,
        ),
        children: const [
          _Header(),
          SizedBox(height: 22),
          _Hero(),
          _GuestBanner(),
          _OfflineBanner(),
          SizedBox(height: 22),
          _StatusPill(),
          _PowerCard(),
          _Away(),
          _WhoIsHome(),
          _EnergyCard(),
          _Scenes(),
          _Favourites(),
          _Rooms(),
          _JustNow(),
        ],
      ),
    );
  }
}

class _Header extends ConsumerWidget {
  const _Header();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.sb;
    final me = ref.watch(meProvider);
    final home = me.home!;
    return Row(
      children: [
        Expanded(
          child: Align(
            alignment: Alignment.centerLeft,
            child: Pressable(
              onTap: () => me.homes.length > 1 ? showHomePicker(context, ref) : context.go(Routes.me),
              semanticLabel: me.homes.length > 1 ? 'Switch home, now ${home.name}' : home.name,
              child: SizedBox(
                height: 44,
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(
                      width: 30,
                      height: 30,
                      decoration: BoxDecoration(
                        color: c.on,
                        borderRadius: BorderRadius.circular(9),
                      ),
                      child: const Center(
                        child: SbIcon(
                          SbIcons.house,
                          size: 17,
                          color: SbColors.onInk,
                          weight: IconWeight.fill,
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Flexible(
                      child: Text(
                        home.name,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 15,
                          fontWeight: FontWeight.w600,
                          color: c.tx,
                        ),
                      ),
                    ),
                    if (me.homes.length > 1) ...[
                      const SizedBox(width: 4),
                      SbIcon(SbIcons.caretDown, size: 15, color: c.tx),
                    ],
                  ],
                ),
              ),
            ),
          ),
        ),
        const NoticeBell(),
        const SizedBox(width: 8),
        Pressable(
          onTap: () => context.go(Routes.me),
          semanticLabel: 'Me',
          child: Avatar(me.initials),
        ),
      ],
    );
  }
}

/// Outside a guest's hours (or after their end): the app opens, the home doesn't — and says why.
class AccessPausedView extends ConsumerWidget {
  const AccessPausedView({super.key, required this.message});
  final String message;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return RefreshIndicator(
      onRefresh: () => ref.read(sessionProvider.notifier).reload(),
      child: ListView(
        padding: EdgeInsets.fromLTRB(18, MediaQuery.paddingOf(context).top + 8, 18, 130),
        children: [
          const _Header(),
          const SizedBox(height: 40),
          EmptyView(
            icon: SbIcons.clock,
            title: 'Not right now',
            text: message,
            action: TextButton(
              onPressed: () => ref.read(sessionProvider.notifier).reload(),
              child: const Text('Check again'),
            ),
          ),
        ],
      ),
    );
  }
}

/// Who's home, for owners and admins and for the people who share it.
class _WhoIsHome extends ConsumerWidget {
  const _WhoIsHome();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.sb;
    final who = ref.watch(whoIsHomeProvider).value;
    final manages = ref.watch(meProvider.select((m) => m.home?.manages ?? false));
    if (who == null || who.people.isEmpty || (!manages && !who.sharing)) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: GroupCard(
        radius: 22,
        children: [
          Padding(
            padding: const EdgeInsets.all(14),
            child: Row(
              children: [
                Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(color: c.sf2, borderRadius: BorderRadius.circular(12)),
                  child: Center(child: SbIcon(SbIcons.users, size: 18, color: c.tx)),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(who.line ?? 'Who’s home', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: c.tx)),
                      const SizedBox(height: 2),
                      Text(
                        who.people.map((p) => '${p.name.split(' ').first}${p.me ? ' (you)' : ''}: ${p.status.label.toLowerCase()}').join(' · '),
                        style: TextStyle(fontSize: 13, color: c.mu),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _Hero extends ConsumerWidget {
  const _Hero();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final me = ref.watch(meProvider);
    final now = ref.watch(nowProvider).value ?? DateTime.now();
    final on = ref.watch(homeHealthProvider).on;
    final many = on.length;
    return Container(
      height: 330,
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: const Color(0xFF1A1D22),
        borderRadius: BorderRadius.circular(32),
        boxShadow: const [
          BoxShadow(
            color: Color(0x8C000000),
            blurRadius: 60,
            spreadRadius: -30,
            offset: Offset(0, 30),
          ),
        ],
      ),
      child: Stack(
        fit: StackFit.expand,
        children: [
          Image.asset(
            'assets/images/hero.jpg',
            fit: BoxFit.cover,
            semanticLabel: 'Your living room',
          ),
          const DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                stops: [0, .38, .55, 1],
                colors: [
                  Color(0x990A0B0E),
                  Color(0x000A0B0E),
                  Color(0x1A0A0B0E),
                  Color(0xCC0A0B0E),
                ],
              ),
            ),
          ),
          Positioned(
            left: 22,
            right: 22,
            top: 20,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '${Fmt.weekday(now)} · ${Fmt.clock(now)}',
                  style: const TextStyle(
                    fontSize: 13.5,
                    fontWeight: FontWeight.w500,
                    color: Color(0xD9FFFFFF),
                  ),
                ),
                const SizedBox(height: 4),
                Text.rich(
                  TextSpan(
                    children: [
                      TextSpan(text: '${Fmt.greeting(now)},\n'),
                      TextSpan(
                        text: '${me.firstName}.',
                        style: SbText.serif.copyWith(
                          color: const Color(0xFFFFD98A),
                          fontSize: 38,
                        ),
                      ),
                    ],
                  ),
                  style: SbText.hero.copyWith(color: Colors.white),
                ),
              ],
            ),
          ),
          Positioned(
            left: 10,
            right: 10,
            bottom: 10,
            child: Glass(
              radius: 24,
              blur: 18,
              color: const Color(0x80121418),
              border: const Color(0x24FFFFFF),
              child: Padding(
                padding: const EdgeInsets.fromLTRB(18, 14, 12, 14),
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            many == 0 ? 'Everything is off' : '$many thing${many == 1 ? ' is' : 's are'} on',
                            style: const TextStyle(
                              fontSize: 19,
                              fontWeight: FontWeight.w600,
                              letterSpacing: -.4,
                              color: SbColors.inkText,
                              height: 1.15,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            many == 0 ? 'Nothing is using power right now' : on.map((d) => d.name).join(', '),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              fontSize: 13,
                              color: Color(0xBFFFFFFF),
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 12),
                    Pressable(
                      onTap: many == 0
                          ? () => context.go(Routes.routines)
                          : () => switchAll(ref, on, on: false, label: 'All off'),
                      child: Container(
                        height: 46,
                        padding: const EdgeInsets.symmetric(horizontal: 16),
                        decoration: BoxDecoration(
                          color: many == 0 ? const Color(0x1FFFFFFF) : const Color(0xFFF59E0B),
                          borderRadius: BorderRadius.circular(999),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            SbIcon(
                              many == 0 ? SbIcons.sparkle : SbIcons.moon,
                              size: 16,
                              color: many == 0 ? SbColors.inkText : SbColors.onInk,
                            ),
                            const SizedBox(width: 8),
                            Text(
                              many == 0 ? 'Scenes' : 'All off',
                              style: TextStyle(
                                fontSize: 14.5,
                                fontWeight: FontWeight.w600,
                                color: many == 0 ? SbColors.inkText : SbColors.onInk,
                              ),
                            ),
                          ],
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

class _GuestBanner extends ConsumerWidget {
  const _GuestBanner();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final me = ref.watch(meProvider);
    if (me.home?.role != HomeRole.guest) return const SizedBox.shrink();
    final rooms = ref.watch(roomSummariesProvider).map((r) => r.room.name.toLowerCase()).toList();
    final shared = rooms.isEmpty
        ? 'no rooms yet'
        : rooms.length == 1
        ? 'the ${rooms.first}'
        : '${rooms.length} rooms';
    return Padding(
      padding: const EdgeInsets.only(top: 22),
      child: Note(
        tone: NoteTone.info,
        icon: SbIcons.clock,
        child: Text(
          'You’re a guest here. ${me.home!.name} shared $shared with you.',
        ),
      ),
    );
  }
}

/// The server is out of reach (the home's internet is down?): offer switching over the Wi‑Fi.
class _OfflineBanner extends ConsumerStatefulWidget {
  const _OfflineBanner();

  @override
  ConsumerState<_OfflineBanner> createState() => _OfflineBannerState();
}

class _OfflineBannerState extends ConsumerState<_OfflineBanner> {
  Timer? _timer;
  bool _show = false;
  ValueNotifier<bool>? _connected;

  void _changed() {
    _timer?.cancel();
    if (_connected!.value) {
      if (_show) setState(() => _show = false);
    } else {
      // a short blip (switching networks) is not worth a banner
      _timer = Timer(const Duration(seconds: 8), () {
        if (mounted) setState(() => _show = true);
      });
    }
  }

  @override
  void initState() {
    super.initState();
    _connected = ref.read(liveClientProvider).connected..addListener(_changed);
  }

  @override
  void dispose() {
    _timer?.cancel();
    _connected?.removeListener(_changed);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final boards = ref.watch(localBundleProvider)?.boards ?? const [];
    // (a browser can't reach the boards over plain http on the Wi‑Fi)
    if (kIsWeb || !_show || boards.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: 22),
      child: Pressable(
        onTap: () => context.go(Routes.local),
        semanticLabel: 'Control over home Wi‑Fi',
        child: const Note(
          tone: NoteTone.warn,
          icon: SbIcons.wifiSlash,
          child: Text('Can’t reach the internet. Tap to switch things over your home’s Wi‑Fi.'),
        ),
      ),
    );
  }
}

/// "On UPS/solar since 2:03 pm" while the grid is off, or "Next expected cut: today around 2:00 pm".
class _PowerCard extends ConsumerWidget {
  const _PowerCard();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.sb;
    final p = ref.watch(powerStatusProvider).value;
    final headline = p?.headline;
    if (p == null || headline == null) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: 14),
      child: GroupCard(
        radius: 22,
        children: [
          InkWell(
            onTap: () => context.openInTab(Routes.energy),
            child: Container(
              color: p.gridOff ? c.onSoft : null,
              padding: const EdgeInsets.all(14),
              child: Row(
                children: [
                  Container(
                    width: 40,
                    height: 40,
                    decoration: BoxDecoration(color: p.gridOff ? c.on : c.sf2, borderRadius: BorderRadius.circular(12)),
                    child: Center(child: SbIcon(p.gridOff ? SbIcons.zap : SbIcons.clock, size: 18, color: p.gridOff ? SbColors.onInk : c.tx)),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(headline, style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: c.tx)),
                        Text(p.detail, style: TextStyle(fontSize: 13, color: c.mu)),
                      ],
                    ),
                  ),
                  SbIcon(SbIcons.caretRight, size: 16, color: c.mu),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Away mode: one switch. While on, doors and motion alert at any hour.
class _Away extends ConsumerWidget {
  const _Away();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.sb;
    final away = ref.watch(awayProvider).value;
    final me = ref.watch(meProvider);
    if (away == null || !away.loaded) return const SizedBox.shrink();
    final text = away.on
        ? 'Doors and motion alert everyone at any hour'
              '${away.lights.isNotEmpty ? '; ${away.lights.join(', ')} go on and off in the evening' : ''}.'
              '${away.by != null ? ' Turned on by ${away.by}.' : ''}'
        : 'Going away? Doors and motion will alert you at any hour.';
    return Padding(
      padding: const EdgeInsets.only(top: 14),
      child: GroupCard(
        radius: 22,
        children: [
          Padding(
            padding: const EdgeInsets.all(14),
            child: Row(
              children: [
                Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    color: away.on ? c.ac : c.sf2,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Center(child: SbIcon(SbIcons.shield, size: 18, color: away.on ? Colors.white : c.tx)),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        away.on ? 'Away mode is on' : 'Away mode',
                        style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: c.tx),
                      ),
                      Text(text, style: TextStyle(fontSize: 13, color: c.mu)),
                    ],
                  ),
                ),
                if (me.home?.readOnly != true)
                  SbSwitch(
                    value: away.on,
                    semanticLabel: 'Away mode',
                    onChanged: (v) async {
                      try {
                        await ref.read(awayProvider.notifier).set(v);
                        ref.read(toastProvider.notifier).show(v ? 'Away mode on' : 'Welcome home');
                      } catch (e) {
                        ref.read(toastProvider.notifier).show(ApiException.from(e).message, error: true);
                      }
                    },
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// This week's electricity, roughly; tap for the devices that used the most.
class _EnergyCard extends ConsumerWidget {
  const _EnergyCard();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.sb;
    final e = ref.watch(homeEnergyProvider).value;
    if (e == null || !e.loaded || e.kwh < 0.05) return const SizedBox.shrink();
    final top = e.devices.where((d) => d.kwh > 0).firstOrNull;
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: GroupCard(
        radius: 22,
        children: [
          InkWell(
            onTap: () => _showEnergy(context, e),
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Row(
                children: [
                  Container(
                    width: 40,
                    height: 40,
                    decoration: BoxDecoration(color: c.sf2, borderRadius: BorderRadius.circular(12)),
                    child: Center(child: SbIcon(SbIcons.zap, size: 18, color: c.tx)),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'This week: ~${Energy.units(e.kwh)} units · ${Energy.rupees(e.cost)}',
                          style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: c.tx),
                        ),
                        Text(
                          '${top != null ? 'Most from ${top.name} · ' : ''}a month ≈ ${Energy.rupees(e.monthCost)}',
                          style: TextStyle(fontSize: 13, color: c.mu),
                        ),
                      ],
                    ),
                  ),
                  SbIcon(SbIcons.caretRight, size: 16, color: c.mu),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  void _showEnergy(BuildContext context, Energy e) {
    showSbSheet<void>(
      context,
      builder: (ctx) {
        final c = ctx.sb;
        final rows = e.devices.where((d) => d.hours > 0).toList();
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const _WeekSummary(),
            Text('Electricity this week', style: SbText.title.copyWith(color: c.tx)),
            const SizedBox(height: 6),
            Text(
              'About ${Energy.units(e.kwh)} units, ${Energy.rupees(e.cost)} at Rs ${e.tariff.toStringAsFixed(0)} a unit. '
              'An estimate from how long each switch was on — your meter is the real number.',
              style: TextStyle(fontSize: 14, color: c.mu),
            ),
            const SizedBox(height: 14),
            for (final d in rows)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(d.name, style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: c.tx)),
                          Text(
                            '${d.hours < 1 ? '${(d.hours * 60).round()} min' : '${d.hours.toStringAsFixed(1)} h'} on · ${Energy.units(d.kwh)} units'
                            '${d.wattsSource == 'unknown' ? ' · power not set' : ''}',
                            style: TextStyle(fontSize: 13, color: c.mu),
                          ),
                        ],
                      ),
                    ),
                    Text(Energy.rupees(d.cost), style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: c.tx)),
                  ],
                ),
              ),
            if (rows.isEmpty) Text('Nothing was on this week.', style: TextStyle(color: c.mu)),
            const SizedBox(height: 14),
            BigButton(
              label: 'Bill, meter readings and load-shedding',
              icon: SbIcons.zap,
              height: 50,
              color: c.sf2,
              foreground: c.tx,
              onTap: () {
                Navigator.of(ctx).pop();
                context.openInTab(Routes.energy);
              },
            ),
          ],
        );
      },
    );
  }
}

/// The week in a few lines, with a button to send it to the family (WhatsApp or anything else).
class _WeekSummary extends ConsumerWidget {
  const _WeekSummary();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.sb;
    final s = ref.watch(homeSummaryProvider).value;
    if (s == null || !s.loaded) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: 20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('This week', style: SbText.title.copyWith(color: c.tx)),
          Text(s.range, style: TextStyle(fontSize: 13, color: c.mu)),
          const SizedBox(height: 10),
          for (final l in s.lines)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 3),
              child: Text('• $l', style: TextStyle(fontSize: 14.5, color: c.tx, height: 1.35)),
            ),
          const SizedBox(height: 12),
          BigButton(
            label: 'Send to the family',
            icon: SbIcons.share,
            onTap: () => SharePlus.instance.share(ShareParams(text: s.text)),
          ),
        ],
      ),
    );
  }
}

class _StatusPill extends ConsumerWidget {
  const _StatusPill();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.sb;
    final health = ref.watch(homeHealthProvider);
    final manages = ref.watch(meProvider.select((m) => m.home!.manages));
    final ok = health.ok;
    final first = ok ? null : health.down.first;
    final title = ok
        ? 'Everything is working'
        : health.down.length == 1
        ? '${_the(first!.room.name)} isn’t responding'
        : '${health.down.length} rooms aren’t responding';
    final detail = ok
        ? '${Fmt.plural(health.rooms.length, 'room')} online · live'
        : 'The wall switches still work.${manages ? ' See what to try.' : ''}';
    return Pressable(
      onTap: () => manages
          ? context.openInTab('health')
          : ref
                .read(toastProvider.notifier)
                .show(
                  ok ? 'All good — nothing to do.' : 'The wall switches still work. Your home’s owner has been told.',
                ),
      scale: .98,
      child: Container(
        constraints: const BoxConstraints(minHeight: 56),
        padding: const EdgeInsets.fromLTRB(8, 8, 16, 8),
        decoration: BoxDecoration(
          color: ok ? c.sf : c.badSoft,
          borderRadius: BorderRadius.circular(999),
          border: Border.all(color: ok ? c.ln2 : Colors.transparent),
        ),
        child: Row(
          children: [
            Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(
                color: ok ? c.okSoft : c.bad,
                shape: BoxShape.circle,
              ),
              child: Center(
                child: SbIcon(
                  ok ? SbIcons.check : SbIcons.warning,
                  size: 20,
                  color: ok ? c.okText : Colors.white,
                  weight: IconWeight.fill,
                ),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: TextStyle(
                      fontSize: 14.5,
                      fontWeight: FontWeight.w600,
                      color: ok ? c.tx : c.badText,
                    ),
                  ),
                  Text(
                    detail,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(fontSize: 12.5, color: c.mu),
                  ),
                ],
              ),
            ),
            SbIcon(SbIcons.caretRight, size: 16, color: c.mu),
          ],
        ),
      ),
    );
  }
}

String _the(String room) => 'The ${room.toLowerCase()}';

class _Scenes extends ConsumerWidget {
  const _Scenes();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scenes = ref.watch(scenesProvider).value ?? const [];
    final visible = scenes.where((s) => s.canRun).toList();
    if (visible.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: 22),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const SectionHeader('Scenes'),
          const SizedBox(height: 10),
          SizedBox(
            height: 160,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              clipBehavior: Clip.none,
              itemCount: visible.length,
              separatorBuilder: (_, _) => const SizedBox(width: 10),
              itemBuilder: (_, i) => SceneCard(
                scene: visible[i],
                index: i,
                compact: true,
                subtitle: Fmt.plural(visible[i].actions.length, 'thing'),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _Favourites extends ConsumerWidget {
  const _Favourites();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final favs = ref.watch(favouriteDevicesProvider);
    if (favs.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: 22),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const SectionHeader('Favourites'),
          const SizedBox(height: 10),
          DeviceGrid(
            children: [
              for (final d in favs)
                LiveDeviceTile(
                  key: ValueKey(d.id),
                  deviceId: d.id,
                  showRoom: true,
                ),
            ],
          ),
        ],
      ),
    );
  }
}

class _Rooms extends ConsumerWidget {
  const _Rooms();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final rooms = ref.watch(roomSummariesProvider);
    if (rooms.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: 22),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SectionHeader(
            'Rooms',
            action: 'See all',
            onAction: () => context.go(Routes.rooms),
          ),
          const SizedBox(height: 10),
          SizedBox(
            height: 176,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              clipBehavior: Clip.none,
              itemCount: rooms.length,
              separatorBuilder: (_, _) => const SizedBox(width: 10),
              itemBuilder: (_, i) => RoomCard(
                summary: rooms[i],
                width: 148,
                onTap: () => context.openInTab('room/${rooms[i].room.id}'),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _JustNow extends ConsumerWidget {
  const _JustNow();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final events = ref.watch(activityProvider).value ?? const [];
    ref.watch(nowProvider);
    return Padding(
      padding: const EdgeInsets.only(top: 22),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SectionHeader(
            'Just now',
            action: events.isEmpty ? null : 'All activity',
            onAction: () => context.openInTab('activity'),
          ),
          const SizedBox(height: 6),
          if (events.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Text(
                'Nothing has happened yet today.',
                style: TextStyle(color: context.sb.mu),
              ),
            )
          else
            for (final e in events.take(3)) ActivityRow(event: e),
        ],
      ),
    );
  }
}

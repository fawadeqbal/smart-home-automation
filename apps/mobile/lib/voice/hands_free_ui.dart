import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/theme/sb_colors.dart';
import '../core/theme/sb_icons.dart';
import '../shared/widgets/common.dart';
import '../shared/widgets/sb_switch.dart';
import 'background_service.dart';
import 'hands_free.dart';

/// Siri-style card over every screen while a hands-free request is going on.
class HandsFreeOverlay extends ConsumerWidget {
  const HandsFreeOverlay({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final hf = ref.watch(handsFreeProvider);
    final c = context.sb;
    final text = switch (hf.stage) {
      HandsFreeStage.listening || HandsFreeStage.hearing => 'Listening…',
      HandsFreeStage.thinking => 'Working on it…',
      HandsFreeStage.speaking => hf.reply ?? '',
      _ => '',
    };
    return AnimatedSwitcher(
      duration: const Duration(milliseconds: 220),
      switchInCurve: const Cubic(.2, .9, .3, 1.2),
      transitionBuilder: (child, a) => FadeTransition(
        opacity: a,
        child: SlideTransition(position: Tween(begin: const Offset(0, .25), end: Offset.zero).animate(a), child: child),
      ),
      child: !hf.active
          ? const SizedBox.shrink()
          : Semantics(
              key: const ValueKey('hands-free'),
              liveRegion: true,
              label: text,
              child: Glass(
                radius: 24,
                color: c.glassBar,
                border: c.glassBorder,
                highlight: c.glassHighlight,
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(14, 12, 6, 12),
                  child: Row(
                    children: [
                      _Orb(level: hf.stage == HandsFreeStage.hearing ? hf.level : .15, busy: hf.stage == HandsFreeStage.thinking),
                      const SizedBox(width: 14),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            if (hf.heard != null && hf.stage == HandsFreeStage.speaking)
                              Text(
                                '“${hf.heard}”',
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(fontSize: 12.5, color: c.mu),
                              ),
                            Text(
                              text,
                              style: TextStyle(fontSize: 15.5, fontWeight: FontWeight.w600, letterSpacing: -.15, color: c.tx),
                            ),
                          ],
                        ),
                      ),
                      IconButton(
                        onPressed: ref.read(handsFreeProvider.notifier).dismiss,
                        tooltip: 'Stop',
                        icon: SbIcon(SbIcons.x, size: 18, color: c.mu),
                      ),
                    ],
                  ),
                ),
              ),
            ),
    );
  }
}

/// The glowing ring: grows with the voice while listening, breathes while working.
class _Orb extends StatefulWidget {
  const _Orb({required this.level, required this.busy});
  final double level;
  final bool busy;

  @override
  State<_Orb> createState() => _OrbState();
}

class _OrbState extends State<_Orb> with SingleTickerProviderStateMixin {
  late final _spin = AnimationController(vsync: this, duration: const Duration(milliseconds: 2400))..repeat();

  @override
  void dispose() {
    _spin.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    return AnimatedBuilder(
      animation: _spin,
      builder: (context, _) {
        final breathe = widget.busy ? .9 + .1 * math.sin(_spin.value * 2 * math.pi * 2) : 1.0;
        final scale = (.82 + widget.level * .4) * breathe;
        return SizedBox(
          width: 44,
          height: 44,
          child: Transform.scale(
            scale: scale,
            child: Transform.rotate(
              angle: _spin.value * 2 * math.pi,
              child: Container(
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  gradient: SweepGradient(colors: [c.ac, const Color(0xFF7A5CFF), const Color(0xFF3DDC97), c.ac]),
                ),
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: DecoratedBox(decoration: BoxDecoration(shape: BoxShape.circle, color: c.sf.withValues(alpha: .9))),
                ),
              ),
            ),
          ),
        );
      },
    );
  }
}

/// The "Hey Switchboard" switches (Me screen). Hidden in builds without a wake-word model.
class HandsFreeSettings extends ConsumerWidget {
  const HandsFreeSettings({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final hf = ref.watch(handsFreeProvider);
    if (!hf.available) return const SizedBox.shrink();
    final ctl = ref.read(handsFreeProvider.notifier);
    final c = context.sb;
    final status = switch (hf.stage) {
      HandsFreeStage.denied => 'Allow the microphone for Switchboard in your phone’s settings',
      HandsFreeStage.error => hf.error ?? 'Stopped. Turn it off and on again.',
      HandsFreeStage.starting => 'Getting ready…',
      _ when hf.enabled => 'Say “${hf.phrase}” any time the app is open',
      _ => 'Talk to Switchboard without touching the phone',
    };

    Widget toggle(String title, String subtitle, bool value, ValueChanged<bool> onChanged) => InkWell(
      onTap: () => onChanged(!value),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: TextStyle(fontSize: 15, fontWeight: FontWeight.w500, color: c.tx)),
                  const SizedBox(height: 2),
                  Text(subtitle, style: TextStyle(fontSize: 13, color: c.mu)),
                ],
              ),
            ),
            const SizedBox(width: 12),
            SbSwitch(value: value, onChanged: onChanged, semanticLabel: title),
          ],
        ),
      ),
    );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.only(left: 4, bottom: 8),
          child: Text('HANDS-FREE', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: c.mu)),
        ),
        GroupCard(
          children: [
            toggle('“${hf.phrase}”', status, hf.enabled, ctl.setEnabled),
            if (hf.enabled && BackgroundListening.supported)
              toggle(
                'Keep listening in the background',
                'Works with the screen off. Android shows a notification while it listens, and it uses more battery.',
                hf.background,
                ctl.setBackground,
              ),
          ],
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(4, 8, 4, 0),
          child: Text(
            'The wake word is recognised on this phone. Only what you say after it is sent to Switchboard.',
            style: TextStyle(fontSize: 12.5, color: c.mu),
          ),
        ),
      ],
    );
  }
}

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/app_theme.dart';
import '../../core/theme/sb_colors.dart';
import '../../core/theme/sb_icons.dart';
import '../../data/models/device.dart';
import '../../shared/widgets/pressable.dart';
import '../../state/automation.dart';
import '../../state/devices.dart';
import '../../voice/hands_free.dart';
import '../devices/device_kinds.dart';
import 'assistant_controller.dart';
import 'voice_capture.dart';

/// "Ask Switchboard": tap the mic and say it (Urdu, English or both), or type.
class AskScreen extends ConsumerStatefulWidget {
  const AskScreen({super.key});

  @override
  ConsumerState<AskScreen> createState() => _AskScreenState();
}

class _AskScreenState extends ConsumerState<AskScreen> {
  final VoiceCapture _voice = VoiceCapture.create();
  final _text = TextEditingController();
  final _scroll = ScrollController();
  StreamSubscription<double>? _levelSub;
  double _level = 0;
  late bool _typing = !_voice.supported;
  late final HandsFreeController _handsFree;

  @override
  void initState() {
    super.initState();
    _handsFree = ref.read(handsFreeProvider.notifier); // read here: `ref` can't be used in dispose
  }

  @override
  void dispose() {
    unawaited(_handsFree.resume()); // in case the screen closed in the middle of tap-to-talk
    _levelSub?.cancel();
    _voice.dispose();
    _text.dispose();
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _mic() async {
    final ctl = ref.read(assistantProvider.notifier);
    final phase = ref.read(assistantProvider).phase;
    if (phase == AskPhase.thinking) return;
    if (phase == AskPhase.listening) {
      await _levelSub?.cancel();
      ctl.setListening(false);
      setState(() => _level = 0);
      final audio = await _voice.stop();
      unawaited(_handsFree.resume());
      if (audio == null) {
        _hint('I didn’t catch that — hold on a little longer.');
        return;
      }
      await ctl.askByVoice(audio);
      return;
    }
    unawaited(HapticFeedback.mediumImpact());
    // tap-to-talk needs the microphone to itself
    await _handsFree.pause();
    if (!await _voice.start()) {
      unawaited(_handsFree.resume());
      _hint(
        'Allow the microphone for Switchboard in your phone’s settings — or type instead.',
      );
      setState(() => _typing = true);
      return;
    }
    ctl.setListening(true);
    await _levelSub?.cancel();
    _levelSub = _voice.level.listen((v) => setState(() => _level = v));
  }

  void _hint(String text) => ScaffoldMessenger.of(context).showSnackBar(
    SnackBar(content: Text(text), behavior: SnackBarBehavior.floating),
  );

  Future<void> _send([String? text]) async {
    final q = text ?? _text.text;
    if (q.trim().isEmpty) return;
    _text.clear();
    await ref.read(assistantProvider.notifier).ask(q);
  }

  /// Suggestions from this home: switch off something that's on, ask about a device, run a scene.
  List<String> _suggestions() {
    final devices = (ref.read(devicesProvider).value ?? const <Device>[]).where((d) => d.canControl).toList();
    final scenes = ref.read(scenesProvider).value ?? const [];
    final out = <String>[];
    final on = devices.where((d) => d.isOn).firstOrNull;
    if (on != null) out.add('Turn off the ${on.name.toLowerCase()}');
    for (final d in devices) {
      final p = DeviceKinds.of(d).phrases(d);
      if (p.length > 2 && out.length < 2) out.add(p.last);
    }
    if (devices.isNotEmpty) out.add('Kya ${devices.first.name.toLowerCase()} on hai?');
    if (scenes.isNotEmpty) out.add(scenes.first.name);
    if (out.length < 4 && devices.isNotEmpty) out.add('Turn on the ${devices.last.name.toLowerCase()} for 10 minutes');
    return out.toSet().take(4).toList();
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(assistantProvider);
    ref.listen(assistantProvider.select((s) => s.messages.length), (_, _) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (_scroll.hasClients) {
          _scroll.animateTo(
            _scroll.position.maxScrollExtent,
            duration: const Duration(milliseconds: 300),
            curve: Curves.easeOut,
          );
        }
      });
    });
    final listening = state.phase == AskPhase.listening;
    final thinking = state.phase == AskPhase.thinking;
    final pad = MediaQuery.paddingOf(context);
    const ink = SbColors.ink, text = SbColors.inkText, muted = Color(0xFFA3A6AD);

    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.light,
      child: Material(
        color: ink,
        child: Stack(
          children: [
            const Positioned(
              left: 0,
              right: 0,
              top: 120,
              child: Center(
                child: SizedBox(
                  width: 420,
                  height: 420,
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      gradient: RadialGradient(
                        colors: [Color(0x38F59E0B), Color(0x00F59E0B)],
                      ),
                    ),
                  ),
                ),
              ),
            ),
            Padding(
              padding: EdgeInsets.fromLTRB(
                20,
                pad.top + 12,
                20,
                pad.bottom + 20 + MediaQuery.viewInsetsOf(context).bottom,
              ),
              child: Column(
                children: [
                  Row(
                    children: [
                      const Expanded(
                        child: Text(
                          'Ask Switchboard',
                          style: TextStyle(
                            fontSize: 17,
                            fontWeight: FontWeight.w600,
                            color: text,
                          ),
                        ),
                      ),
                      _DarkButton(
                        icon: state.speak ? SbIcons.speaker : SbIcons.speakerOff,
                        label: state.speak ? 'Stop reading answers aloud' : 'Read answers aloud',
                        onTap: () => ref.read(assistantProvider.notifier).toggleSpeak(),
                      ),
                      const SizedBox(width: 8),
                      _DarkButton(
                        icon: SbIcons.x,
                        label: 'Close',
                        onTap: () => context.pop(),
                      ),
                    ],
                  ),
                  Expanded(
                    child: state.messages.isEmpty
                        ? Align(
                            alignment: Alignment.bottomLeft,
                            child: Padding(
                              padding: const EdgeInsets.only(bottom: 22),
                              child: Column(
                                mainAxisSize: MainAxisSize.min,
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    'Just say it.',
                                    style: SbText.serif.copyWith(
                                      fontSize: 38,
                                      color: text,
                                      height: 1.1,
                                      fontStyle: FontStyle.normal,
                                    ),
                                  ),
                                  const SizedBox(height: 8),
                                  const Text(
                                    'In Urdu or English — or both mixed together.',
                                    style: TextStyle(
                                      fontSize: 15,
                                      color: muted,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          )
                        : ListView(
                            controller: _scroll,
                            padding: const EdgeInsets.symmetric(vertical: 20),
                            children: [
                              for (final m in state.messages) _Bubble(message: m),
                              if (thinking)
                                const _Bubble(
                                  message: ChatMessage('…', mine: false),
                                ),
                            ],
                          ),
                  ),
                  if (state.messages.length < 2)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 22),
                      child: Wrap(
                        alignment: WrapAlignment.center,
                        spacing: 8,
                        runSpacing: 8,
                        children: [
                          for (final s in _suggestions())
                            Pressable(
                              onTap: thinking || listening ? null : () => _send(s),
                              child: Container(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 14,
                                  vertical: 10,
                                ),
                                decoration: BoxDecoration(
                                  color: const Color(0x0AFFFFFF),
                                  borderRadius: BorderRadius.circular(999),
                                  border: Border.all(
                                    color: const Color(0xFF2F333B),
                                  ),
                                ),
                                child: Text(
                                  s,
                                  style: const TextStyle(
                                    fontSize: 14,
                                    color: Color(0xFFE6E7EA),
                                  ),
                                ),
                              ),
                            ),
                        ],
                      ),
                    ),
                  if (_typing)
                    _TypeBox(
                      controller: _text,
                      busy: thinking,
                      onSend: _send,
                      onVoice: _voice.supported ? () => setState(() => _typing = false) : null,
                    )
                  else ...[
                    _Wave(active: listening, level: _level),
                    const SizedBox(height: 12),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        const SizedBox(width: 56),
                        _MicButton(
                          listening: listening,
                          thinking: thinking,
                          onTap: _mic,
                        ),
                        const SizedBox(width: 12),
                        _DarkButton(
                          icon: SbIcons.keyboard,
                          label: 'Type instead',
                          onTap: () => setState(() => _typing = true),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    Text(
                      thinking
                          ? 'Thinking…'
                          : listening
                          ? 'Listening… tap again when you’re done'
                          : 'Tap the mic, or pick one above',
                      style: const TextStyle(fontSize: 14, color: muted),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Bubble extends StatelessWidget {
  const _Bubble({required this.message});
  final ChatMessage message;

  @override
  Widget build(BuildContext context) {
    final mine = message.mine;
    return Align(
      alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.only(bottom: 10),
        constraints: BoxConstraints(
          maxWidth: MediaQuery.sizeOf(context).width * .78,
        ),
        padding: const EdgeInsets.symmetric(horizontal: 15, vertical: 11),
        decoration: BoxDecoration(
          color: mine
              ? const Color(0xFFF59E0B)
              : message.error
              ? const Color(0xFF3A1C1E)
              : const Color(0xFF1D2025),
          borderRadius: BorderRadius.only(
            topLeft: const Radius.circular(20),
            topRight: const Radius.circular(20),
            bottomLeft: Radius.circular(mine ? 20 : 6),
            bottomRight: Radius.circular(mine ? 6 : 20),
          ),
        ),
        child: Text(
          message.text,
          style: TextStyle(
            fontSize: 15,
            height: 1.4,
            color: mine
                ? SbColors.onInk
                : message.error
                ? const Color(0xFFFF8A8F)
                : SbColors.inkText,
          ),
        ),
      ),
    );
  }
}

class _Wave extends StatefulWidget {
  const _Wave({required this.active, required this.level});
  final bool active;
  final double level;

  @override
  State<_Wave> createState() => _WaveState();
}

class _WaveState extends State<_Wave> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 900),
  );
  static const _delays = [0.0, .15, .3, .45, .3, .15, 0.0];

  @override
  void didUpdateWidget(_Wave old) {
    super.didUpdateWidget(old);
    if (widget.active && !_c.isAnimating) _c.repeat();
    if (!widget.active) _c.stop();
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 44,
      child: AnimatedBuilder(
        animation: _c,
        builder: (_, _) => Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            for (final (i, d) in _delays.indexed) ...[
              if (i > 0) const SizedBox(width: 5),
              Builder(
                builder: (_) {
                  // the design's wave, pushed up by how loud you are
                  final phase = ((_c.value + d) % 1);
                  final wave = widget.active ? .18 + .82 * (0.5 - (phase - .5).abs()) * 2 : .18;
                  final h = (wave * (.5 + widget.level * .5)).clamp(.18, 1.0);
                  return Container(
                    width: 5,
                    height: 40 * h,
                    decoration: BoxDecoration(
                      color: i.isEven ? const Color(0xFFF59E0B) : const Color(0xFFFFD27A),
                      borderRadius: BorderRadius.circular(999),
                    ),
                  );
                },
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _MicButton extends StatefulWidget {
  const _MicButton({
    required this.listening,
    required this.thinking,
    required this.onTap,
  });
  final bool listening, thinking;
  final VoidCallback onTap;

  @override
  State<_MicButton> createState() => _MicButtonState();
}

class _MicButtonState extends State<_MicButton> with SingleTickerProviderStateMixin {
  late final AnimationController _ring = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1200),
  );

  @override
  void didUpdateWidget(_MicButton old) {
    super.didUpdateWidget(old);
    if (widget.listening && !_ring.isAnimating) _ring.repeat();
    if (!widget.listening) _ring.reset();
  }

  @override
  void dispose() {
    _ring.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final color = widget.listening ? const Color(0xFFE5484D) : const Color(0xFFF59E0B);
    return Pressable(
      onTap: widget.thinking ? null : widget.onTap,
      scale: .92,
      semanticLabel: widget.listening ? 'Stop and send' : 'Speak',
      child: SizedBox(
        width: 84,
        height: 84,
        child: Stack(
          alignment: Alignment.center,
          children: [
            AnimatedBuilder(
              animation: _ring,
              builder: (_, _) => Transform.scale(
                scale: 1 + _ring.value * .9,
                child: Opacity(
                  opacity: widget.listening ? (1 - _ring.value) * .5 : 0,
                  child: Container(
                    decoration: BoxDecoration(
                      color: color,
                      shape: BoxShape.circle,
                    ),
                  ),
                ),
              ),
            ),
            AnimatedContainer(
              duration: const Duration(milliseconds: 250),
              width: 84,
              height: 84,
              decoration: BoxDecoration(color: color, shape: BoxShape.circle),
              child: Center(
                child: widget.thinking
                    ? const SizedBox(
                        width: 28,
                        height: 28,
                        child: CircularProgressIndicator(
                          strokeWidth: 2.5,
                          color: Colors.white,
                        ),
                      )
                    : const SbIcon(
                        SbIcons.mic,
                        size: 36,
                        color: Colors.white,
                        weight: IconWeight.fill,
                      ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _DarkButton extends StatelessWidget {
  const _DarkButton({
    required this.icon,
    required this.label,
    required this.onTap,
  });
  final SbIconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Pressable(
    onTap: onTap,
    semanticLabel: label,
    scale: .9,
    child: Container(
      width: 44,
      height: 44,
      decoration: const BoxDecoration(
        color: Color(0x1AFFFFFF),
        shape: BoxShape.circle,
      ),
      child: Center(child: SbIcon(icon, size: 18, color: SbColors.inkText)),
    ),
  );
}

class _TypeBox extends StatelessWidget {
  const _TypeBox({
    required this.controller,
    required this.busy,
    required this.onSend,
    this.onVoice,
  });
  final TextEditingController controller;
  final bool busy;
  final Future<void> Function([String?]) onSend;
  final VoidCallback? onVoice;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        if (onVoice != null) ...[
          _DarkButton(
            icon: SbIcons.mic,
            label: 'Speak instead',
            onTap: onVoice!,
          ),
          const SizedBox(width: 8),
        ],
        Expanded(
          child: TextField(
            controller: controller,
            autofocus: true,
            enabled: !busy,
            textInputAction: TextInputAction.send,
            onSubmitted: (_) => onSend(),
            style: const TextStyle(color: SbColors.inkText, fontSize: 15.5),
            cursorColor: const Color(0xFFF59E0B),
            decoration: InputDecoration(
              hintText: busy ? 'Thinking…' : 'Bedroom ka pankha band karo',
              hintStyle: const TextStyle(color: Color(0xFF7D818A)),
              filled: true,
              fillColor: const Color(0xFF1D2025),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(999),
                borderSide: BorderSide.none,
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(999),
                borderSide: BorderSide.none,
              ),
              focusedBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(999),
                borderSide: const BorderSide(color: Color(0xFFF59E0B)),
              ),
              contentPadding: const EdgeInsets.symmetric(
                horizontal: 18,
                vertical: 14,
              ),
            ),
          ),
        ),
        const SizedBox(width: 8),
        Pressable(
          onTap: busy ? null : () => onSend(),
          semanticLabel: 'Send',
          child: Container(
            width: 50,
            height: 50,
            decoration: const BoxDecoration(
              color: Color(0xFFF59E0B),
              shape: BoxShape.circle,
            ),
            child: const Center(
              child: SbIcon(
                SbIcons.paperPlane,
                size: 20,
                color: SbColors.onInk,
                weight: IconWeight.fill,
              ),
            ),
          ),
        ),
      ],
    );
  }
}

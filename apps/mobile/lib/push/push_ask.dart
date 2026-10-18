import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/theme/app_theme.dart';
import '../core/theme/sb_colors.dart';
import '../core/theme/sb_icons.dart';
import '../shared/widgets/common.dart';
import '../shared/widgets/sheet.dart';
import 'push.dart';

/// Once, a few seconds after the app opens signed in: says what notifications are for, then lets
/// Android ask (13+ needs a yes). "Not now" doesn't ask again on this phone.
class PushAskOnce extends ConsumerStatefulWidget {
  const PushAskOnce({super.key});

  @override
  ConsumerState<PushAskOnce> createState() => _PushAskOnceState();
}

class _PushAskOnceState extends ConsumerState<PushAskOnce> {
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _timer = Timer(const Duration(seconds: 3), _maybeAsk);
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _maybeAsk() async {
    final push = ref.read(pushControllerProvider);
    if (await push.status() != PushAsk.ask || !mounted) return;
    await showSbSheet<void>(context, builder: (_) => const PushAskSheet());
  }

  @override
  Widget build(BuildContext context) => const SizedBox.shrink();
}

class PushAskSheet extends ConsumerWidget {
  const PushAskSheet({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.sb;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Container(
          width: 56,
          height: 56,
          decoration: BoxDecoration(color: c.acSoft, shape: BoxShape.circle),
          child: Center(child: SbIcon(SbIcons.bell, size: 26, color: c.acText)),
        ),
        const SizedBox(height: 14),
        Text('Get alerts on this phone?', style: SbText.title.copyWith(color: c.tx)),
        const SizedBox(height: 6),
        Text(
          'A water leak, a door opening while you’re away, a board going offline — even when the app is closed. '
          'You choose which ones on the Me tab.',
          style: TextStyle(fontSize: 15, color: c.mu, height: 1.4),
        ),
        const SizedBox(height: 18),
        BigButton(
          label: 'Turn on alerts',
          icon: SbIcons.bell,
          onTap: () async {
            Navigator.of(context).pop();
            await ref.read(pushControllerProvider).ask();
          },
        ),
        const SizedBox(height: 8),
        TextButton(
          onPressed: () {
            Navigator.of(context).pop();
            ref.read(pushControllerProvider).later();
          },
          child: Text('Not now', style: TextStyle(color: c.mu, fontWeight: FontWeight.w600)),
        ),
      ],
    );
  }
}

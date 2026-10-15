import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme/sb_colors.dart';
import '../../core/theme/sb_icons.dart';
import '../../state/toast.dart';

/// Shows the current toast: a dark pill with a tick (or a warning) and Undo when it can.
class ToastHost extends ConsumerWidget {
  const ToastHost({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final toast = ref.watch(toastProvider);
    return AnimatedSwitcher(
      duration: const Duration(milliseconds: 280),
      switchInCurve: const Cubic(.2, .9, .3, 1),
      transitionBuilder: (child, a) => FadeTransition(
        opacity: a,
        child: SlideTransition(
          position: Tween(
            begin: const Offset(0, .4),
            end: Offset.zero,
          ).animate(a),
          child: child,
        ),
      ),
      child: toast == null
          ? const SizedBox.shrink(key: ValueKey(0))
          : _ToastCard(key: ValueKey(toast.id), toast: toast),
    );
  }
}

class _ToastCard extends ConsumerWidget {
  const _ToastCard({super.key, required this.toast});
  final Toast toast;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Semantics(
      liveRegion: true,
      child: Material(
        color: const Color(0xFF0F1115),
        borderRadius: BorderRadius.circular(16),
        elevation: 12,
        shadowColor: const Color(0x73000000),
        child: Padding(
          padding: EdgeInsets.fromLTRB(
            16,
            10,
            toast.undo != null ? 10 : 16,
            10,
          ),
          child: Row(
            children: [
              Container(
                width: 24,
                height: 24,
                decoration: BoxDecoration(
                  color: toast.error ? const Color(0xFFFF6369) : const Color(0xFF3CCF8E),
                  shape: BoxShape.circle,
                ),
                child: Center(
                  child: SbIcon(
                    toast.error ? SbIcons.x : SbIcons.check,
                    size: 13,
                    color: SbColors.ink,
                    weight: IconWeight.bold,
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  toast.text,
                  style: const TextStyle(
                    fontSize: 14,
                    height: 1.35,
                    color: SbColors.inkText,
                  ),
                ),
              ),
              if (toast.undo != null)
                TextButton(
                  onPressed: () {
                    ref.read(toastProvider.notifier).hide();
                    toast.undo!();
                  },
                  style: TextButton.styleFrom(
                    backgroundColor: const Color(0x1FFFFFFF),
                    foregroundColor: const Color(0xFFF7C46A),
                    minimumSize: const Size(64, 36),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(10),
                    ),
                  ),
                  child: const Text(
                    'Undo',
                    style: TextStyle(fontWeight: FontWeight.w600, fontSize: 14),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

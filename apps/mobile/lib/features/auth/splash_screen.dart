import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme/sb_colors.dart';
import '../../shared/widgets/common.dart';
import '../../state/session.dart';
import 'auth_widgets.dart';

/// While the app finds out who's signed in (or when the server can't be reached).
class SplashScreen extends ConsumerWidget {
  const SplashScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(sessionProvider);
    return Scaffold(
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Brand(size: 40),
              const SizedBox(height: 28),
              if (session.hasError)
                ErrorView(
                  error: session.error!,
                  onRetry: () => ref.invalidate(sessionProvider),
                )
              else
                SizedBox(
                  width: 26,
                  height: 26,
                  child: CircularProgressIndicator(
                    strokeWidth: 2.5,
                    color: context.sb.on,
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

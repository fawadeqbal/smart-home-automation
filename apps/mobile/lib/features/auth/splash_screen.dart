import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/routing/routes.dart';
import '../../core/theme/sb_colors.dart';
import '../../core/theme/sb_icons.dart';
import '../../shared/widgets/common.dart';
import '../../state/local_control.dart';
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
              if (session.hasError) ...[
                ErrorView(
                  error: session.error!,
                  onRetry: () => ref.invalidate(sessionProvider),
                ),
                // no internet, but the boards are on the Wi‑Fi: switch them straight
                if (!kIsWeb && (ref.watch(localBundleProvider)?.boards.isNotEmpty ?? false)) ...[
                  const SizedBox(height: 20),
                  BigButton(
                    label: 'Control over home Wi‑Fi',
                    icon: SbIcons.wifiSlash,
                    onTap: () => context.go(Routes.local),
                  ),
                ],
              ] else
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

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme/sb_colors.dart';
import '../../core/theme/sb_icons.dart';
import '../../shared/widgets/common.dart';
import '../../state/session.dart';
import 'auth_widgets.dart';

/// Signed in, but no home to show: someone on an installer's team, or a home that was removed.
class NoHomeScreen extends ConsumerWidget {
  const NoHomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.sb;
    final me = ref.watch(sessionProvider).value;
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Align(alignment: Alignment.centerLeft, child: Brand()),
                  const SizedBox(height: 40),
                  const SerifHeading('No home', 'yet.'),
                  const SizedBox(height: 10),
                  Text(
                    me?.staff != null
                        ? 'You’re on the ${me!.staff!.orgName} team. This app is for the homes you belong to — use the console on the web for your customers’ homes.'
                        : 'You’re signed in as ${me?.email ?? 'you'}, but no home is shared with you yet. Ask the home’s owner to invite you.',
                    style: TextStyle(fontSize: 16, color: c.mu, height: 1.45),
                  ),
                  const SizedBox(height: 24),
                  BigButton(
                    label: 'Check again',
                    icon: SbIcons.pulse,
                    onTap: () => ref.read(sessionProvider.notifier).reload(),
                  ),
                  const SizedBox(height: 8),
                  TextButton(
                    onPressed: () => ref.read(sessionProvider.notifier).signOut(),
                    child: Text('Sign out', style: TextStyle(color: c.badText)),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

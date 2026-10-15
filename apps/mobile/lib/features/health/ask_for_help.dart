import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_exception.dart';
import '../../core/theme/app_theme.dart';
import '../../core/theme/sb_colors.dart';
import '../../core/theme/sb_icons.dart';
import '../../data/repositories/home_repository.dart';
import '../../shared/widgets/common.dart';
import '../../shared/widgets/pressable.dart';
import '../../shared/widgets/sheet.dart';
import '../../state/session.dart';
import '../../state/toast.dart';

/// "Usman Tariq · Your home expert   [Message]".
class ExpertCard extends ConsumerWidget {
  const ExpertCard({super.key, required this.name, this.company});
  final String name;
  final String? company;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.sb;
    final canAsk = ref.watch(
      meProvider.select((m) => m.home?.manages ?? false),
    );
    final initials = name
        .trim()
        .split(RegExp(r'\s+'))
        .where((p) => p.isNotEmpty)
        .take(2)
        .map((p) => p[0].toUpperCase())
        .join();
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: c.sf,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: c.ln2),
      ),
      child: Row(
        children: [
          Avatar(initials, background: c.ok, foreground: Colors.white),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  name,
                  style: TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w600,
                    color: c.tx,
                  ),
                ),
                Text(
                  ['Your home expert', ?company].join(' · '),
                  style: TextStyle(fontSize: 13, color: c.mu),
                ),
              ],
            ),
          ),
          if (canAsk)
            Pressable(
              onTap: () => showAskForHelp(context, name),
              child: Container(
                height: 44,
                padding: const EdgeInsets.symmetric(horizontal: 14),
                decoration: BoxDecoration(
                  color: c.acSoft,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Row(
                  children: [
                    SbIcon(SbIcons.message, size: 16, color: c.acText),
                    const SizedBox(width: 6),
                    Text(
                      'Message',
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                        color: c.acText,
                      ),
                    ),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// Writes to the installer and support ("Send to support" on the web).
Future<void> showAskForHelp(BuildContext context, String expert) =>
    showSbSheet<void>(context, builder: (_) => _AskForHelp(expert: expert));

class _AskForHelp extends ConsumerStatefulWidget {
  const _AskForHelp({required this.expert});
  final String expert;

  @override
  ConsumerState<_AskForHelp> createState() => _AskForHelpState();
}

class _AskForHelpState extends ConsumerState<_AskForHelp> {
  final _text = TextEditingController();
  bool _sending = false;

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final message = _text.text.trim();
    if (message.isEmpty) return;
    setState(() => _sending = true);
    final toast = ref.read(toastProvider.notifier);
    try {
      await ref.read(homeRepositoryProvider).askForHelp(message);
      if (mounted) Navigator.of(context).pop();
      toast.show(
        'Sent to ${widget.expert.split(' ').first}. You’ll hear back in the app.',
      );
    } catch (e) {
      toast.show(ApiException.from(e).message, error: true);
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          'Message ${widget.expert.split(' ').first}',
          style: SbText.title.copyWith(color: c.tx),
        ),
        const SizedBox(height: 4),
        Text(
          'What’s wrong? A sentence is enough.',
          style: TextStyle(fontSize: 14.5, color: c.mu),
        ),
        const SizedBox(height: 14),
        TextField(
          controller: _text,
          autofocus: true,
          minLines: 3,
          maxLines: 6,
          maxLength: 1000,
          decoration: const InputDecoration(
            hintText: 'The kitchen lights don’t switch from the app since this morning.',
          ),
        ),
        const SizedBox(height: 8),
        BigButton(
          label: 'Send',
          icon: SbIcons.paperPlane,
          busy: _sending,
          onTap: _send,
        ),
      ],
    );
  }
}

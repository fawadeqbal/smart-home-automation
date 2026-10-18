import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_exception.dart';
import '../../core/theme/app_theme.dart';
import '../../core/theme/sb_colors.dart';
import '../../core/theme/sb_icons.dart';
import '../../data/models/ticket.dart';
import '../../data/repositories/home_repository.dart';
import '../../shared/widgets/common.dart';
import '../../shared/widgets/pressable.dart';
import '../../shared/widgets/sheet.dart';
import '../../state/people.dart';
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
      final t = await ref.read(homeRepositoryProvider).askForHelp(message);
      ref.invalidate(ticketsProvider);
      if (mounted) Navigator.of(context).pop();
      toast.show(
        'Request #${t.number} sent to ${widget.expert.split(' ').first}. Answers come to Help requests.',
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


/// The home's help requests; tap one for its conversation.
Future<void> showHelpRequests(BuildContext context) => showSbSheet<void>(context, builder: (_) => const _Requests());

class _Requests extends ConsumerWidget {
  const _Requests();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.sb;
    final list = ref.watch(ticketsProvider);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('Help requests', style: SbText.title.copyWith(color: c.tx)),
        const SizedBox(height: 12),
        list.when(
          loading: () => const LoadingView(),
          error: (e, _) => ErrorView(error: e, onRetry: () => ref.invalidate(ticketsProvider)),
          data: (rows) => rows.isEmpty
              ? Text('No requests yet. “Message your expert” starts one.', style: TextStyle(color: c.mu))
              : Column(
                  children: [
                    for (final t in rows)
                      InkWell(
                        onTap: () => showSbSheet<void>(context, builder: (_) => _Request(id: t.id)),
                        child: Padding(
                          padding: const EdgeInsets.symmetric(vertical: 10),
                          child: Row(
                            children: [
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text('#${t.number} · ${t.title}', maxLines: 1, overflow: TextOverflow.ellipsis,
                                        style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: c.tx)),
                                    Text(t.statusText,
                                        style: TextStyle(fontSize: 13, color: t.waitingForYou ? c.badText : t.done ? c.okText : c.mu)),
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
        ),
      ],
    );
  }
}

final _ticketProvider = FutureProvider.autoDispose.family<Ticket, String>((ref, id) => ref.read(homeRepositoryProvider).ticket(id));

class _Request extends ConsumerStatefulWidget {
  const _Request({required this.id});
  final String id;

  @override
  ConsumerState<_Request> createState() => _RequestState();
}

class _RequestState extends ConsumerState<_Request> {
  final _text = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  Future<void> _reply({bool? solved}) async {
    final body = _text.text.trim();
    if (body.isEmpty && solved == null) return;
    setState(() => _busy = true);
    try {
      await ref.read(homeRepositoryProvider).replyToTicket(widget.id, body, solved: solved);
      _text.clear();
      ref.invalidate(_ticketProvider(widget.id));
      ref.invalidate(ticketsProvider);
    } catch (e) {
      ref.read(toastProvider.notifier).show(ApiException.from(e).message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final t = ref.watch(_ticketProvider(widget.id));
    return t.when(
      loading: () => const LoadingView(),
      error: (e, _) => ErrorView(error: e, onRetry: () => ref.invalidate(_ticketProvider(widget.id))),
      data: (t) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('#${t.number} · ${t.title}', style: SbText.title.copyWith(color: c.tx)),
          Text(t.statusText, style: TextStyle(fontSize: 13.5, color: c.mu)),
          const SizedBox(height: 12),
          for (final m in t.messages)
            m.event
                ? Padding(
                    padding: const EdgeInsets.symmetric(vertical: 4),
                    child: Text(m.body, textAlign: TextAlign.center, style: TextStyle(fontSize: 12.5, color: c.mu)),
                  )
                : Align(
                    alignment: m.staff ? Alignment.centerRight : Alignment.centerLeft,
                    child: Container(
                      margin: const EdgeInsets.symmetric(vertical: 4),
                      padding: const EdgeInsets.all(10),
                      constraints: const BoxConstraints(maxWidth: 320),
                      decoration: BoxDecoration(color: m.staff ? c.acSoft : c.sf2, borderRadius: BorderRadius.circular(12)),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(m.by ?? '', style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: c.tx)),
                          const SizedBox(height: 2),
                          Text(m.body, style: TextStyle(fontSize: 14.5, color: c.tx, height: 1.35)),
                        ],
                      ),
                    ),
                  ),
          const SizedBox(height: 12),
          if (t.done && (t.canRate || t.rating != null)) ...[
            _RateHelp(ticket: t, onRated: () {
              ref.invalidate(_ticketProvider(widget.id));
              ref.invalidate(ticketsProvider);
            }),
            const SizedBox(height: 12),
          ],
          if (t.done)
            BigButton(label: 'Still a problem? Open it again', busy: _busy, onTap: () => _reply(solved: false))
          else ...[
            TextField(controller: _text, minLines: 2, maxLines: 5, maxLength: 4000, decoration: const InputDecoration(hintText: 'Write a reply…')),
            BigButton(label: 'Send', icon: SbIcons.paperPlane, busy: _busy, onTap: _reply),
            const SizedBox(height: 6),
            TextButton(onPressed: _busy ? null : () => _reply(solved: true), child: Text('It’s solved', style: TextStyle(color: c.okText))),
          ],
        ],
      ),
    );
  }
}

/// "How was the help you got?": 1 to 5 stars and a few words, once the request is solved.
/// Only the person who asked can rate it; they can change it for 7 days.
class _RateHelp extends ConsumerStatefulWidget {
  const _RateHelp({required this.ticket, required this.onRated});
  final Ticket ticket;
  final VoidCallback onRated;

  @override
  ConsumerState<_RateHelp> createState() => _RateHelpState();
}

class _RateHelpState extends ConsumerState<_RateHelp> {
  late int _stars = widget.ticket.rating ?? 0;
  late final _comment = TextEditingController(text: widget.ticket.ratingComment ?? '');
  late bool _editing = widget.ticket.rating == null;
  bool _busy = false;

  static const _words = ['', 'Poor', 'Not great', 'Okay', 'Good', 'Excellent'];

  @override
  void dispose() {
    _comment.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    if (_stars == 0) return;
    setState(() => _busy = true);
    final toast = ref.read(toastProvider.notifier);
    try {
      await ref.read(homeRepositoryProvider).rateTicket(widget.ticket.id, _stars, comment: _comment.text);
      if (mounted) setState(() => _editing = false);
      toast.show('Thank you for rating the help.');
      widget.onRated();
    } catch (e) {
      toast.show(ApiException.from(e).message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Widget _starRow(BuildContext context, {required bool editable}) {
    final c = context.sb;
    return Row(
      children: [
        for (var n = 1; n <= 5; n++)
          Semantics(
            button: editable,
            selected: n == _stars,
            label: '$n star${n == 1 ? '' : 's'}: ${_words[n]}',
            child: InkResponse(
              onTap: editable && !_busy ? () => setState(() => _stars = n) : null,
              radius: 24,
              child: Padding(
                padding: const EdgeInsets.all(4),
                child: SbIcon(SbIcons.star, size: 30, color: n <= _stars ? c.on : c.mu, weight: n <= _stars ? IconWeight.fill : IconWeight.regular),
              ),
            ),
          ),
        const SizedBox(width: 8),
        if (_stars > 0) Text(_words[_stars], style: TextStyle(fontSize: 14, color: c.mu)),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final t = widget.ticket;
    final until = t.rateUntil;
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(color: c.sf2, borderRadius: BorderRadius.circular(16)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(_editing ? 'How was the help you got?' : 'Your rating', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: c.tx)),
          const SizedBox(height: 6),
          _starRow(context, editable: _editing),
          if (_editing) ...[
            TextField(
              controller: _comment,
              minLines: 1,
              maxLines: 3,
              maxLength: 500,
              decoration: const InputDecoration(hintText: 'A few words (optional)'),
            ),
            BigButton(label: t.rating == null ? 'Send rating' : 'Save rating', busy: _busy, onTap: _stars == 0 ? null : _send),
          ] else ...[
            if ((t.ratingComment ?? '').isNotEmpty)
              Text('“${t.ratingComment}”', style: TextStyle(fontSize: 14, color: c.mu)),
            if (t.canRate)
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton(
                  onPressed: () => setState(() => _editing = true),
                  child: Text(until == null ? 'Change it' : 'Change it (until ${until.day}/${until.month})', style: TextStyle(color: c.acText)),
                ),
              ),
          ],
        ],
      ),
    );
  }
}

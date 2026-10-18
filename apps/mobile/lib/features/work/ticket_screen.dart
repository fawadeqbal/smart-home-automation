import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../core/theme/app_theme.dart';
import '../../core/theme/sb_colors.dart';
import '../../core/theme/sb_icons.dart';
import '../../core/util/format.dart';
import '../../data/models/work/tickets.dart';
import '../../data/repositories/work_repository.dart';
import '../../shared/widgets/common.dart';
import '../../shared/widgets/sb_switch.dart';
import '../../state/session.dart';
import '../../state/work.dart';
import 'work_icons.dart';
import 'work_routes.dart';
import 'work_widgets.dart';

/// One ticket: the conversation, a reply (or a team-only note), and its status, priority and who has
/// it — as far as this person may change them (installers can take a ticket, not hand it on).
class TicketScreen extends ConsumerStatefulWidget {
  const TicketScreen({super.key, required this.ticketId});
  final String ticketId;

  @override
  ConsumerState<TicketScreen> createState() => _TicketScreenState();
}

class _TicketScreenState extends ConsumerState<TicketScreen> {
  final _reply = TextEditingController();
  bool _internal = false;
  bool _busy = false;

  @override
  void dispose() {
    _reply.dispose();
    super.dispose();
  }

  Future<void> _do(Future<StaffTicket> Function(WorkRepository repo) action, {bool clear = false}) async {
    setState(() => _busy = true);
    try {
      await action(ref.read(workRepositoryProvider));
      if (clear) _reply.clear();
      ref.invalidate(workTicketProvider(widget.ticketId));
      ref.invalidate(workTicketsProvider);
    } catch (e) {
      toastError(ref, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final ticket = ref.watch(workTicketProvider(widget.ticketId));
    final rights = ref.watch(workRightsProvider);
    final me = ref.watch(sessionProvider).value;
    final t = ticket.value;
    if (t == null) {
      return WorkPage(
        children: [
          if (ticket.hasError)
            ErrorView(error: ticket.error!, onRetry: () => ref.invalidate(workTicketProvider(widget.ticketId)))
          else
            const LoadingView(),
        ],
      );
    }
    final canWork = rights?.canWorkTickets ?? false;
    final firstName = t.contactName?.split(' ').first;

    return WorkPage(
      onRefresh: () => ref.refresh(workTicketProvider(widget.ticketId).future),
      children: [
        Text('#${t.number} · ${t.title}', style: SbText.title.copyWith(color: c.tx)),
        const SizedBox(height: 6),
        Text(
          '${t.home}${t.city.isNotEmpty ? ', ${t.city}' : ''} · ${t.categoryLabel} · opened by ${t.openedBy ?? 'someone'}${t.createdAt != null ? ' ${Fmt.ago(t.createdAt!).toLowerCase()}' : ''}',
          style: TextStyle(fontSize: 13.5, color: c.mu, height: 1.35),
        ),
        const SizedBox(height: 10),
        Wrap(
          spacing: 6,
          runSpacing: 6,
          children: [
            ToneBadge(t.state.label, t.state.tone),
            ToneBadge(t.priority.label, t.priority.tone),
            if (t.overdue) const ToneBadge('Overdue', Tone.bad),
          ],
        ),
        const SizedBox(height: 14),
        GroupCard(
          children: [
            WorkRow(
              icon: WorkIcons.checkCircle,
              title: 'Status',
              value: t.state.label,
              onTap: !canWork || _busy
                  ? null
                  : () async {
                      final s = await pickOne<TicketState>(
                        context,
                        title: 'Status',
                        value: t.state,
                        options: [for (final s in TicketState.values) (s, s.label)],
                      );
                      if (s != null && s.$1 != t.state) await _do((r) => r.reply(t.id, status: s.$1));
                    },
            ),
            WorkRow(
              icon: WorkIcons.lightning,
              title: 'Priority',
              value: t.priority.label,
              onTap: !canWork || _busy
                  ? null
                  : () async {
                      final p = await pickOne<TicketPriority>(
                        context,
                        title: 'Priority',
                        value: t.priority,
                        options: [for (final p in TicketPriority.values) (p, p.label)],
                      );
                      if (p != null && p.$1 != t.priority) await _do((r) => r.updateTicket(t.id, priority: p.$1));
                    },
            ),
            WorkRow(
              icon: SbIcons.users,
              title: 'With',
              value: t.assignee ?? 'Nobody',
              onTap: !canWork || _busy
                  ? null
                  : rights!.canAssignTickets
                  ? () async {
                      final who = await pickOne<String>(
                        context,
                        title: 'Who has it?',
                        value: t.assigneeId ?? '',
                        options: [
                          ('', 'Nobody'),
                          for (final s in t.team) (s.id, '${s.name} · ${s.role.label.toLowerCase()}'),
                        ],
                      );
                      if (who == null || who.$1 == (t.assigneeId ?? '')) return;
                      await _do(
                        (r) => who.$1.isEmpty
                            ? r.updateTicket(t.id, unassign: true)
                            : r.updateTicket(t.id, assigneeId: who.$1),
                      );
                    }
                  : t.assigneeId == me?.id
                  ? null
                  : () => _do((r) => r.updateTicket(t.id, assigneeId: me!.id)),
              trailing: canWork && !(rights?.canAssignTickets ?? false) && t.assigneeId != me?.id
                  ? const Padding(padding: EdgeInsets.only(left: 8), child: ToneBadge('Take it', Tone.info))
                  : null,
            ),
            if (t.dueAt != null)
              WorkRow(
                icon: SbIcons.clock,
                title: 'Answer by',
                value: '${DateFormat('EEE d MMM, HH:mm').format(t.dueAt!)}${t.overdue ? ' (overdue)' : ''}',
              ),
          ],
        ),
        const SizedBox(height: 10),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            PillButton(
              label: 'Open the home',
              icon: SbIcons.house,
              onTap: () => context.openWork(WorkRoutes.home(t.homeId)),
            ),
            if (t.node != null)
              PillButton(
                label: '${t.node!.name} · ${t.node!.online ? 'online' : 'offline'}',
                icon: WorkIcons.cpu,
                onTap: () => context.openWork(WorkRoutes.board(t.homeId, t.node!.id)),
              ),
            PillButton(
              label: 'Tell ${firstName ?? 'the home'} on WhatsApp',
              icon: WorkIcons.whatsapp,
              green: true,
              onTap: () => whatsApp(
                ref,
                t.contactWhatsapp,
                WorkMessages.ticketUpdate(
                  name: t.contactName,
                  number: t.number,
                  title: t.title,
                  status: t.state.label,
                  reply: t.lastReply,
                  company: t.company,
                ),
              ),
            ),
          ],
        ),
        const GroupLabel('Conversation'),
        if (t.messages.isEmpty) Text('No messages yet.', style: TextStyle(fontSize: 14, color: c.mu)),
        for (final m in t.messages) _Message(m: m),
        if (t.rating != null) ...[
          const SizedBox(height: 8),
          Note(
            tone: NoteTone.warn,
            icon: SbIcons.star,
            child: Text(
              'Rated ${t.rating} of 5 by ${t.openedBy ?? 'the home'}${t.ratingComment != null ? ': “${t.ratingComment}”' : ''}',
            ),
          ),
        ],
        if (canWork) ...[
          const SizedBox(height: 16),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: _internal ? c.onSoft : c.sf,
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: _internal ? c.onBorder : c.ln2),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                TextField(
                  controller: _reply,
                  minLines: 2,
                  maxLines: 6,
                  maxLength: 4000,
                  onChanged: (_) => setState(() {}),
                  decoration: InputDecoration(
                    hintText: _internal ? 'A note only your team sees…' : 'Reply to ${t.home}…',
                    counterText: '',
                    filled: false,
                    border: InputBorder.none,
                    enabledBorder: InputBorder.none,
                    focusedBorder: InputBorder.none,
                  ),
                ),
                Row(
                  children: [
                    SbSwitch(
                      value: _internal,
                      onChanged: (v) => setState(() => _internal = v),
                      semanticLabel: 'Staff only',
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        'Staff only',
                        style: TextStyle(fontSize: 14, fontWeight: FontWeight.w500, color: c.tx),
                      ),
                    ),
                    PillButton(
                      label: _internal ? 'Save note' : 'Send',
                      icon: WorkIcons.send,
                      primary: true,
                      onTap: _busy || _reply.text.trim().isEmpty
                          ? null
                          : () => _do((r) => r.reply(t.id, body: _reply.text.trim(), internal: _internal), clear: true),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ],
    );
  }
}

class _Message extends StatelessWidget {
  const _Message({required this.m});
  final StaffMessage m;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    if (m.event) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Center(
          child: Text(
            '${m.body}${m.by != null ? ' · ${m.by}' : ''}${m.at != null ? ' · ${Fmt.ago(m.at!).toLowerCase()}' : ''}',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 12.5, color: c.mu),
          ),
        ),
      );
    }
    final team = m.staff;
    return Align(
      alignment: team ? Alignment.centerRight : Alignment.centerLeft,
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width * .8),
        child: Container(
          margin: const EdgeInsets.symmetric(vertical: 4),
          padding: const EdgeInsets.fromLTRB(12, 9, 12, 10),
          decoration: BoxDecoration(
            color: m.internal
                ? c.onSoft
                : team
                ? c.acSoft
                : c.sf,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(
              color: m.internal
                  ? c.onBorder
                  : team
                  ? Colors.transparent
                  : c.ln2,
            ),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Flexible(
                    child: Text(
                      m.by ?? 'Someone',
                      style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: c.tx),
                    ),
                  ),
                  if (m.internal) ...[
                    const SizedBox(width: 6),
                    SbIcon(SbIcons.lock, size: 11, color: c.onText),
                    const SizedBox(width: 3),
                    Text(
                      'Team only',
                      style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w600, color: c.onText),
                    ),
                  ],
                  if (m.at != null) ...[
                    const SizedBox(width: 8),
                    Text(Fmt.ago(m.at!), style: TextStyle(fontSize: 11.5, color: c.mu)),
                  ],
                ],
              ),
              const SizedBox(height: 3),
              Text(m.body, style: TextStyle(fontSize: 14.5, color: c.tx, height: 1.4)),
            ],
          ),
        ),
      ),
    );
  }
}

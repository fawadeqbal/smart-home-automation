import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme/app_theme.dart';
import '../../core/theme/sb_colors.dart';
import '../../core/theme/sb_icons.dart';
import '../../core/util/format.dart';
import '../../data/models/work/tickets.dart';
import '../../shared/widgets/common.dart';
import '../../shared/widgets/pressable.dart';
import '../../shared/widgets/sb_chip.dart';
import '../../shared/widgets/segmented.dart';
import '../../state/work.dart';
import 'work_icons.dart';
import 'work_routes.dart';
import 'work_widgets.dart';

/// The team's tickets: mine or all, open or solved — overdue and urgent ones first.
class TicketsScreen extends ConsumerStatefulWidget {
  const TicketsScreen({super.key});

  @override
  ConsumerState<TicketsScreen> createState() => _TicketsScreenState();
}

class _TicketsScreenState extends ConsumerState<TicketsScreen> {
  final _search = TextEditingController();

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final rights = ref.watch(workRightsProvider);
    final filter = ref.watch(ticketFilterProvider);
    final queue = ref.watch(workTicketsProvider);
    final q = queue.value;
    final shown = sortTickets((q?.tickets ?? const <StaffTicket>[]).where((t) => t.matches(_search.text)).toList());
    final installer = rights?.isInstaller ?? false;

    return WorkPage(
      back: false,
      onRefresh: () => ref.refresh(workTicketsProvider.future),
      children: [
        PageTitle(
          'Tickets',
          subtitle: q == null
              ? 'Requests from homes.'
              : '${q.open} open${q.overdue > 0 ? ' · ${q.overdue} overdue' : ''}. Urgent ones within 4 hours, high within a day.',
        ),
        const SizedBox(height: 14),
        Segmented<bool>(
          options: [(true, 'Mine'), (false, installer ? 'All my homes' : 'Everyone’s')],
          value: filter.mine,
          onChanged: (v) => ref.read(ticketFilterProvider.notifier).set(mine: v),
        ),
        const SizedBox(height: 10),
        Row(
          children: [
            for (final (v, label) in const [('open', 'Open'), ('done', 'Solved'), ('all', 'All')])
              Padding(
                padding: const EdgeInsets.only(right: 6),
                child: SbChip(
                  label: label,
                  height: 34,
                  selected: filter.status == v,
                  onTap: () => ref.read(ticketFilterProvider.notifier).set(status: v),
                ),
              ),
          ],
        ),
        const SizedBox(height: 10),
        TextField(
          controller: _search,
          onChanged: (_) => setState(() {}),
          decoration: InputDecoration(
            hintText: 'Number, title or home',
            prefixIcon: Padding(
              padding: const EdgeInsets.only(left: 12, right: 6),
              child: SbIcon(WorkIcons.search, size: 18, color: c.mu),
            ),
            prefixIconConstraints: const BoxConstraints(minWidth: 36),
          ),
        ),
        const SizedBox(height: 14),
        if (q == null && queue.hasError)
          ErrorView(error: queue.error!, onRetry: () => ref.invalidate(workTicketsProvider))
        else if (q == null)
          const LoadingView(label: 'Loading tickets…')
        else if (shown.isEmpty)
          EmptyView(
            icon: WorkIcons.ticket,
            title: filter.status == 'open' ? 'Nothing open' : 'Nothing here',
            text: filter.status == 'open'
                ? 'Requests from homes, and “Send to support” from the app, land here.'
                : null,
          )
        else
          for (final t in shown)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: _TicketCard(t: t),
            ),
      ],
    );
  }
}

class _TicketCard extends StatelessWidget {
  const _TicketCard({required this.t});
  final StaffTicket t;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final last = t.last;
    return Pressable(
      scale: .98,
      onTap: () => context.openWork(WorkRoutes.ticket(t.id)),
      child: WorkCard(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Text(
                    '#${t.number} · ${t.title}',
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: SbText.cardTitle.copyWith(fontSize: 15.5, color: c.tx),
                  ),
                ),
                if (t.updatedAt != null)
                  Padding(
                    padding: const EdgeInsets.only(left: 8, top: 2),
                    child: Text(Fmt.ago(t.updatedAt!), style: TextStyle(fontSize: 12, color: c.mu)),
                  ),
              ],
            ),
            const SizedBox(height: 2),
            Text(
              '${t.home}${t.city.isNotEmpty ? ' · ${t.city}' : ''}',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(fontSize: 13.5, color: c.mu),
            ),
            if (last != null)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text(
                  '${last.internal ? 'Team note · ' : ''}${last.by != null ? '${last.by}: ' : ''}${last.body}',
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(fontSize: 13.5, color: c.tx, height: 1.35),
                ),
              ),
            const SizedBox(height: 10),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                ToneBadge(t.priority.label, t.priority.tone),
                ToneBadge(t.state.label, t.state.tone),
                if (t.overdue) const ToneBadge('Overdue', Tone.bad),
                ToneBadge(t.assignee != null ? 'With ${t.assignee}' : 'Nobody has it', Tone.mute),
                if (t.rating != null) ToneBadge('Rated ${t.rating} of 5', Tone.warn),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../core/theme/app_theme.dart';
import '../../core/theme/sb_colors.dart';
import '../../core/theme/sb_icons.dart';
import '../../core/util/format.dart';
import '../../data/models/work/day.dart';
import '../../data/models/work/office.dart';
import '../../data/repositories/work_repository.dart';
import '../../shared/widgets/common.dart';
import '../../shared/widgets/sb_chip.dart';
import '../../state/session.dart';
import '../../state/toast.dart';
import '../../state/work.dart';
import 'work_icons.dart';
import 'work_routes.dart';
import 'work_widgets.dart';

// ---------------------------------------------------------------- stock

/// Boards in the company's inventory: in stock, given to a home, installed, faulty. Super admins give a
/// board in stock to a home (its installer then installs it on site); support only looks.
class StockScreen extends ConsumerStatefulWidget {
  const StockScreen({super.key});

  @override
  ConsumerState<StockScreen> createState() => _StockScreenState();
}

class _StockScreenState extends ConsumerState<StockScreen> {
  String _filter = 'STOCK';

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final inv = ref.watch(inventoryProvider);
    final rights = ref.watch(workRightsProvider);
    final data = inv.value;
    final boards = (data?.boards ?? const <StockBoard>[])
        .where((b) => _filter == 'all' || b.status == _filter)
        .toList();
    int n(String s) => (data?.boards ?? const <StockBoard>[]).where((b) => b.status == s).length;

    Future<void> assign(StockBoard b) async {
      final home = await pickOne<String>(
        context,
        title: 'Give ${b.id} to a home',
        subtitle: 'Its installer then installs it on site.',
        options: [for (final h in data!.homes) (h.id, h.name)],
      );
      if (home == null) return;
      try {
        await ref.read(workRepositoryProvider).assignBoard(b.id, home.$1);
        ref
            .read(toastProvider.notifier)
            .show('${b.id} is waiting at ${data.homes.firstWhere((h) => h.id == home.$1).name}');
        ref.invalidate(inventoryProvider);
      } catch (e) {
        toastError(ref, e);
      }
    }

    return WorkPage(
      onRefresh: () => ref.refresh(inventoryProvider.future),
      children: [
        PageTitle(
          'Stock',
          subtitle: data == null
              ? 'Boards of the company.'
              : '${data.inStock} in stock${data.low ? ' — fewer than ${data.min}, order more' : ''}',
        ),
        if (!(rights?.canAssignStock ?? false)) ...[
          const SizedBox(height: 12),
          const ReadOnlyBar(text: 'A super admin adds boards and gives them to homes.'),
        ],
        const SizedBox(height: 14),
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Row(
            children: [
              for (final (s, label) in const [
                ('STOCK', 'In stock'),
                ('ASSIGNED', 'Given to a home'),
                ('ADOPTED', 'Installed'),
                ('FAULTY', 'Faulty'),
                ('all', 'All'),
              ])
                Padding(
                  padding: const EdgeInsets.only(right: 6),
                  child: SbChip(
                    label: s == 'all' ? label : '$label ${n(s)}',
                    height: 34,
                    selected: _filter == s,
                    onTap: () => setState(() => _filter = s),
                  ),
                ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        if (data == null && inv.hasError)
          ErrorView(error: inv.error!, onRetry: () => ref.invalidate(inventoryProvider))
        else if (data == null)
          const LoadingView()
        else if (boards.isEmpty)
          EmptyView(
            icon: WorkIcons.package,
            title: 'No boards here',
            text: _filter == 'STOCK'
                ? 'New boards are added to stock by their ID in the web console (or they arrive by themselves when first powered).'
                : null,
          )
        else
          GroupCard(
            children: [
              for (final b in boards)
                WorkRow(
                  icon: WorkIcons.cpu,
                  iconBg: toneColors(context, b.tone).bg,
                  iconFg: toneColors(context, b.tone).fg,
                  title: b.id,
                  subtitle: [
                    b.model,
                    if (b.homeName != null) '${b.homeName}${b.location != null ? ' · ${b.location}' : ''}',
                    b.condText,
                    if (b.note != null) b.note!,
                  ].where((x) => x.isNotEmpty).join(' · '),
                  trailing: b.status == 'STOCK' && (rights?.canAssignStock ?? false) && data.homes.isNotEmpty
                      ? TextButton(
                          onPressed: () => assign(b),
                          style: TextButton.styleFrom(
                            textStyle: const TextStyle(
                              fontFamily: SbFonts.sans,
                              fontSize: 14,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          child: const Text('Give to a home'),
                        )
                      : null,
                  onTap: b.homeId != null && b.status != 'STOCK'
                      ? () => context.openWork(WorkRoutes.home(b.homeId!))
                      : null,
                ),
            ],
          ),
        const SizedBox(height: 8),
        Text(
          'A board appears in stock by itself the first time it is powered and online.',
          style: TextStyle(fontSize: 13, color: c.mu),
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------- visit requests

/// People who asked for a home visit on the website: call or WhatsApp them. Booking and turning one
/// into a home happen in the web console.
class VisitRequestsScreen extends ConsumerStatefulWidget {
  const VisitRequestsScreen({super.key});

  @override
  ConsumerState<VisitRequestsScreen> createState() => _VisitRequestsScreenState();
}

class _VisitRequestsScreenState extends ConsumerState<VisitRequestsScreen> {
  String _filter = 'open';

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final list = ref.watch(visitRequestsProvider);
    final rows = (list.value ?? const <VisitRequest>[])
        .where(
          (v) =>
              _filter == 'all' ||
              (_filter == 'open'
                  ? v.status == 'NEW' || v.status == 'CONTACTED' || v.status == 'SCHEDULED'
                  : v.status == _filter),
        )
        .toList();
    final company = ref.watch(sessionProvider.select((s) => s.value?.staff?.orgName)) ?? 'us';
    return WorkPage(
      onRefresh: () => ref.refresh(visitRequestsProvider.future),
      children: [
        const PageTitle('Visit requests', subtitle: 'From the website’s “Book a free visit”.'),
        const SizedBox(height: 14),
        Row(
          children: [
            for (final (s, label) in const [('open', 'Open'), ('NEW', 'New'), ('SCHEDULED', 'Booked'), ('all', 'All')])
              Padding(
                padding: const EdgeInsets.only(right: 6),
                child: SbChip(
                  label: label,
                  height: 34,
                  selected: _filter == s,
                  onTap: () => setState(() => _filter = s),
                ),
              ),
          ],
        ),
        const SizedBox(height: 14),
        if (list.value == null && list.hasError)
          ErrorView(error: list.error!, onRetry: () => ref.invalidate(visitRequestsProvider))
        else if (list.value == null)
          const LoadingView()
        else if (rows.isEmpty)
          const EmptyView(icon: WorkIcons.calendar, title: 'Nothing here')
        else
          for (final v in rows)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: WorkCard(
                padding: const EdgeInsets.all(14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(v.name, style: SbText.cardTitle.copyWith(fontSize: 16, color: c.tx)),
                        ),
                        ToneBadge(v.statusLabel.isEmpty ? v.status : v.statusLabel, v.tone),
                      ],
                    ),
                    const SizedBox(height: 2),
                    Text(
                      [
                        v.city,
                        v.homeSize,
                        if (v.createdAt != null) 'asked ${Fmt.ago(v.createdAt!).toLowerCase()}',
                      ].where((x) => x.isNotEmpty).join(' · '),
                      style: TextStyle(fontSize: 13.5, color: c.mu),
                    ),
                    if (v.visitAt != null)
                      Padding(
                        padding: const EdgeInsets.only(top: 6),
                        child: Text(
                          'Visit ${DateFormat('EEE d MMM, h:mm a').format(WorkDays.inPakistan(v.visitAt!))}${v.assignee != null ? ' · ${v.assignee}' : ''}',
                          style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: c.acText),
                        ),
                      ),
                    if (v.note.isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(top: 6),
                        child: Text(v.note, style: TextStyle(fontSize: 13.5, color: c.tx, height: 1.4)),
                      ),
                    const SizedBox(height: 10),
                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: [
                        PillButton(label: 'Call', icon: WorkIcons.phone, onTap: () => callNumber(ref, v.phone)),
                        PillButton(
                          label: 'WhatsApp',
                          icon: WorkIcons.whatsapp,
                          green: true,
                          onTap: () => whatsApp(ref, v.whatsapp, WorkMessages.hello(v.name, company)),
                        ),
                        Text(
                          v.phone,
                          style: TextStyle(fontFamily: SbFonts.mono, fontSize: 13, color: c.mu),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
      ],
    );
  }
}

// ---------------------------------------------------------------- quotes

/// Quotes for customers: what's in them, where they stand, and the customer a call or a WhatsApp away.
class QuotesScreen extends ConsumerWidget {
  const QuotesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.sb;
    final list = ref.watch(quotesProvider);
    final rows = list.value ?? const <QuoteRow>[];
    final company = ref.watch(sessionProvider.select((s) => s.value?.staff?.orgName)) ?? 'us';
    return WorkPage(
      onRefresh: () => ref.refresh(quotesProvider.future),
      children: [
        const PageTitle('Quotes', subtitle: 'Made and sent from the web console.'),
        const SizedBox(height: 14),
        if (list.value == null && list.hasError)
          ErrorView(error: list.error!, onRetry: () => ref.invalidate(quotesProvider))
        else if (list.value == null)
          const LoadingView()
        else if (rows.isEmpty)
          const EmptyView(icon: WorkIcons.receipt, title: 'No quotes yet')
        else
          for (final q in rows)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: WorkCard(
                padding: const EdgeInsets.all(14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            '${q.ref} · ${q.customerName}',
                            style: SbText.cardTitle.copyWith(fontSize: 15.5, color: c.tx),
                          ),
                        ),
                        ToneBadge(q.statusLabel, q.tone),
                      ],
                    ),
                    const SizedBox(height: 2),
                    Text(
                      [
                        rupees(q.total),
                        if (q.city.isNotEmpty) q.city,
                        if (q.homeName != null) q.homeName!,
                        if (q.validUntil != null) 'valid until ${q.validUntil}',
                      ].join(' · '),
                      style: TextStyle(fontSize: 13.5, color: c.mu),
                    ),
                    if (q.items.isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(top: 6),
                        child: Text(
                          q.items.take(4).map((i) => '${i.qty} × ${i.name}').join(', ') +
                              (q.items.length > 4 ? ' +${q.items.length - 4} more' : ''),
                          style: TextStyle(fontSize: 13.5, color: c.tx, height: 1.35),
                        ),
                      ),
                    if (q.whatsapp != null) ...[
                      const SizedBox(height: 10),
                      Wrap(
                        spacing: 8,
                        children: [
                          PillButton(label: 'Call', icon: WorkIcons.phone, onTap: () => callNumber(ref, q.whatsapp!)),
                          PillButton(
                            label: 'WhatsApp',
                            icon: WorkIcons.whatsapp,
                            green: true,
                            onTap: () => whatsApp(ref, q.whatsapp, WorkMessages.hello(q.customerName, company)),
                          ),
                        ],
                      ),
                    ],
                  ],
                ),
              ),
            ),
      ],
    );
  }
}

// ---------------------------------------------------------------- power and outages

/// Power cuts and internet outages in the homes this person looks after, last 7 days: areas where
/// several homes went down together, boards down now, and each home's total.
class StaffOutagesScreen extends ConsumerWidget {
  const StaffOutagesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.sb;
    final data = ref.watch(staffOutagesProvider);
    final o = data.value;
    return WorkPage(
      onRefresh: () => ref.refresh(staffOutagesProvider.future),
      children: [
        const PageTitle('Power & outages', subtitle: 'The homes you look after, last 7 days.'),
        const SizedBox(height: 14),
        if (o == null && data.hasError)
          ErrorView(error: data.error!, onRetry: () => ref.invalidate(staffOutagesProvider))
        else if (o == null)
          const LoadingView()
        else ...[
          GroupLabel(
            'Boards down now',
            trailing: Text('${o.down.length}', style: TextStyle(fontSize: 13, color: c.mu)),
          ),
          if (o.down.isEmpty)
            const Note(tone: NoteTone.ok, icon: SbIcons.check, child: Text('Every installed board is online.'))
          else
            GroupCard(
              children: [
                for (final d in o.down)
                  WorkRow(
                    icon: WorkIcons.cpu,
                    iconBg: c.badSoft,
                    iconFg: c.badText,
                    title: '${d.board} · ${d.home}',
                    subtitle: [
                      if (d.since != null) 'down since ${Fmt.when(d.since!)}',
                      if (d.place != null) d.place!,
                    ].join(' · '),
                    onTap: () => context.openWork(WorkRoutes.home(d.homeId)),
                  ),
              ],
            ),
          if (o.areas.isNotEmpty) ...[
            const GroupLabel('Areas that went down together'),
            GroupCard(
              children: [
                for (final a in o.areas)
                  WorkRow(
                    icon: SbIcons.zap,
                    iconBg: c.onSoft,
                    iconFg: c.onText,
                    title: a.place,
                    subtitle:
                        '${a.homes.length} homes · ${durationText(a.seconds)}${a.startedAt != null ? ' · ${Fmt.when(a.startedAt!)}' : ''} — probably the area’s electricity',
                  ),
              ],
            ),
          ],
          const GroupLabel('By home'),
          if (o.homes.isEmpty)
            const Note(
              tone: NoteTone.ok,
              icon: SbIcons.check,
              child: Text('No power cuts or internet outages recorded this week.'),
            )
          else
            GroupCard(
              children: [
                for (final h in o.homes)
                  WorkRow(
                    icon: SbIcons.house,
                    title: h.home,
                    subtitle: [
                      if (h.power > 0) '${Fmt.plural(h.power, 'power cut')} (${durationText(h.powerSeconds)})',
                      if (h.network > 0)
                        '${Fmt.plural(h.network, 'internet outage')} (${durationText(h.networkSeconds)})',
                    ].join(' · '),
                    onTap: () => context.openWork(WorkRoutes.home(h.homeId)),
                  ),
              ],
            ),
        ],
      ],
    );
  }
}

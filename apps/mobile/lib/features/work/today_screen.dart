import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../core/theme/app_theme.dart';
import '../../core/theme/sb_colors.dart';
import '../../core/theme/sb_icons.dart';
import '../../data/models/work/day.dart';
import '../../shared/widgets/common.dart';
import '../../shared/widgets/pressable.dart';
import '../../shared/widgets/sheet.dart';
import '../../state/session.dart';
import '../../state/work.dart';
import 'work_icons.dart';
import 'work_routes.dart';
import 'work_widgets.dart';

/// "Today": the installer's day from the planner — visits, installations and open tickets, as stops
/// in a driving order, with directions, the whole route in Google Maps, and a call or WhatsApp away.
/// Super admins and support can look at anyone's day, on any date.
class TodayScreen extends ConsumerWidget {
  const TodayScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.sb;
    final rights = ref.watch(workRightsProvider);
    final me = ref.watch(sessionProvider).value;
    final date = ref.watch(workDayDateProvider);
    final day = ref.watch(workDayProvider);
    final d = day.value;
    final isToday = date == WorkDays.today();
    final mine = d?.installer == null || d!.installer!.id == me?.id;
    final title = !isToday
        ? DateFormat('EEEE').format(WorkDays.parse(date))
        : mine
        ? 'Today'
        : '${d.installer!.name.split(' ').first}’s day';

    return WorkPage(
      back: false,
      onRefresh: () => ref.refresh(workDayProvider.future),
      children: [
        PageTitle(title, subtitle: DateFormat('EEEE d MMMM').format(WorkDays.parse(date))),
        const SizedBox(height: 14),
        _DayBar(date: date, isToday: isToday, day: d, canPick: rights?.canPickInstaller ?? false),
        const SizedBox(height: 14),
        if (d == null && day.hasError)
          ErrorView(error: day.error!, onRetry: () => ref.invalidate(workDayProvider))
        else if (d == null)
          const LoadingView(label: 'Planning the day…')
        else ...[
          if (d.stops.isNotEmpty) _Summary(day: d),
          if (!d.baseSet && d.stops.isNotEmpty) ...[
            const SizedBox(height: 10),
            Note(
              tone: NoteTone.info,
              icon: WorkIcons.info,
              child: Text(
                rights?.isSuper ?? false
                    ? 'The route starts from the first stop because the company’s base isn’t set. Add it in the web console’s Company settings.'
                    : 'The route starts from the first stop because the company’s base isn’t set.',
              ),
            ),
          ],
          const SizedBox(height: 6),
          if (d.stops.isEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: EmptyView(
                icon: WorkIcons.route,
                title: 'Nothing for ${isToday ? 'today' : 'this day'}',
                text: mine
                    ? 'Visits booked for you, homes you’re installing and tickets you hold show here.'
                    : 'Visits booked for them, homes they’re installing and tickets they hold show here.',
              ),
            )
          else
            for (final (i, s) in d.stops.indexed) ...[
              if (s.legKm != null) _Leg(text: '${s.n == 1 && d.baseSet ? 'From the base' : 'Then'} · ${_km(s.legKm!)}'),
              if (s.legKm == null && i > 0) const SizedBox(height: 12),
              _StopCard(
                stop: s,
                installer: d.installer?.name ?? me?.name,
                mine: mine,
                company: me?.staff?.orgName ?? 'us',
              ),
            ],
          if (d.stops.any((s) => !s.located))
            Padding(
              padding: const EdgeInsets.fromLTRB(4, 12, 4, 0),
              child: Text(
                'Stops without a location on the map come last, by city.',
                style: TextStyle(fontSize: 13, color: c.mu),
              ),
            ),
        ],
      ],
    );
  }
}

String _km(double km) => '${km < 10 ? km.toStringAsFixed(1) : km.round()} km';

class _DayBar extends ConsumerWidget {
  const _DayBar({required this.date, required this.isToday, required this.day, required this.canPick});
  final String date;
  final bool isToday;
  final InstallerDay? day;
  final bool canPick;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.sb;
    final dates = ref.read(workDayDateProvider.notifier);
    Widget arrow(SbIconData icon, String label, int by) =>
        RoundButton(icon: icon, label: label, size: 40, onTap: () => dates.set(WorkDays.shift(date, by)));
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            arrow(WorkIcons.caretLeft, 'Day before', -1),
            const SizedBox(width: 6),
            Pressable(
              onTap: () async {
                final picked = await showDatePicker(
                  context: context,
                  initialDate: WorkDays.parse(date),
                  firstDate: DateTime(2024),
                  lastDate: DateTime.now().add(const Duration(days: 365)),
                );
                if (picked != null) dates.set(WorkDays.format(picked));
              },
              semanticLabel: 'Pick a day',
              child: Container(
                height: 40,
                padding: const EdgeInsets.symmetric(horizontal: 14),
                decoration: BoxDecoration(
                  color: c.sf,
                  borderRadius: BorderRadius.circular(999),
                  border: Border.all(color: c.ln2),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    SbIcon(WorkIcons.calendar, size: 16, color: c.tx),
                    const SizedBox(width: 7),
                    Text(
                      DateFormat('EEE d MMM').format(WorkDays.parse(date)),
                      style: TextStyle(fontSize: 14.5, fontWeight: FontWeight.w600, color: c.tx),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(width: 6),
            arrow(SbIcons.caretRight, 'Day after', 1),
          ],
        ),
        if (!isToday) PillButton(label: 'Today', icon: SbIcons.sun, onTap: () => dates.set(WorkDays.today())),
        if (canPick && day != null && day!.installers.isNotEmpty)
          PillButton(
            label: day!.installer?.name ?? 'Pick an installer',
            icon: SbIcons.users,
            onTap: () async {
              final picked = await pickOne<String>(
                context,
                title: 'Whose day?',
                value: day!.installer?.id,
                options: [
                  for (final i in day!.installers)
                    (i.id, '${i.name}${i.role.label == 'Super admin' ? ' (super admin)' : ''}'),
                ],
              );
              if (picked != null) ref.read(workDayWhoProvider.notifier).set(picked.$1);
            },
          ),
      ],
    );
  }
}

class _Summary extends ConsumerWidget {
  const _Summary({required this.day});
  final InstallerDay day;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.sb;
    final n = day.stops.length;
    return WorkCard(
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('$n stop${n == 1 ? '' : 's'}', style: SbText.cardTitle.copyWith(fontSize: 17, color: c.tx)),
                const SizedBox(height: 2),
                Text(
                  day.totalKm > 0 ? 'About ${_km(day.totalKm)} in a straight line (roads are longer)' : 'Nearest first',
                  style: TextStyle(fontSize: 13.5, color: c.mu, height: 1.3),
                ),
              ],
            ),
          ),
          if (day.mapsUrl != null) ...[
            const SizedBox(width: 10),
            PillButton(
              label: 'Whole route',
              icon: WorkIcons.mapPin,
              primary: true,
              onTap: () => openExternal(ref, day.mapsUrl!),
            ),
          ],
        ],
      ),
    );
  }
}

class _Leg extends StatelessWidget {
  const _Leg({required this.text});
  final String text;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    return Padding(
      padding: const EdgeInsets.fromLTRB(26, 6, 0, 6),
      child: Row(
        children: [
          Container(width: 2, height: 22, color: c.ln2),
          const SizedBox(width: 14),
          SbIcon(SbIcons.car, size: 14, color: c.mu),
          const SizedBox(width: 6),
          Text(text, style: TextStyle(fontSize: 13, color: c.mu)),
        ],
      ),
    );
  }
}

class _StopCard extends ConsumerWidget {
  const _StopCard({required this.stop, this.installer, this.mine = true, this.company = 'us'});
  final DayStop stop;
  final String? installer;

  /// My own day ("On my way"), or someone else's I look at (a plain hello).
  final bool mine;
  final String company;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.sb;
    final s = stop;
    final installJob = s.jobs.any((j) => j.type == DayJobType.install);
    return WorkCard(
      padding: const EdgeInsets.fromLTRB(14, 14, 14, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 30,
                height: 30,
                decoration: BoxDecoration(color: s.isVisit ? c.ac : c.on, shape: BoxShape.circle),
                alignment: Alignment.center,
                child: Text(
                  '${s.n}',
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                    color: s.isVisit ? Colors.white : SbColors.onInk,
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Pressable(
                  scale: .99,
                  onTap: s.homeId == null ? null : () => context.openWork(WorkRoutes.home(s.homeId!)),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(s.name, style: SbText.cardTitle.copyWith(fontSize: 16.5, color: c.tx)),
                      const SizedBox(height: 2),
                      Text(
                        '${s.city.isEmpty ? 'No city' : s.city}${s.located ? '' : ' · no location set'}',
                        style: TextStyle(fontSize: 13.5, color: c.mu),
                      ),
                    ],
                  ),
                ),
              ),
              if (s.isVisit) ...[const SizedBox(width: 8), const ToneBadge('New customer', Tone.info)],
            ],
          ),
          const SizedBox(height: 10),
          for (final j in s.jobs) _JobRow(job: j, stop: s, installer: installer),
          const SizedBox(height: 10),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              if (s.directions != null)
                PillButton(
                  label: 'Directions',
                  icon: WorkIcons.navigate,
                  onTap: () => openExternal(ref, s.directions!),
                ),
              if (s.phone != null)
                PillButton(label: 'Call', icon: WorkIcons.phone, onTap: () => callNumber(ref, s.phone!)),
              if (s.whatsapp != null || s.phone != null)
                PillButton(
                  label: mine ? 'On my way' : 'WhatsApp',
                  icon: WorkIcons.whatsapp,
                  green: true,
                  onTap: () => whatsApp(
                    ref,
                    s.whatsapp,
                    mine ? WorkMessages.onMyWay(installer) : WorkMessages.hello(s.name, company),
                  ),
                ),
              if (s.homeId != null && installJob)
                PillButton(
                  label: 'Checklist',
                  icon: WorkIcons.checklist,
                  primary: true,
                  onTap: () => context.openWork(WorkRoutes.install(s.homeId!)),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

class _JobRow extends ConsumerWidget {
  const _JobRow({required this.job, required this.stop, this.installer});
  final DayJob job;
  final DayStop stop;
  final String? installer;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.sb;
    final (icon, tone) = switch (job.type) {
      DayJobType.visit => (WorkIcons.phone, Tone.info),
      DayJobType.install => (WorkIcons.wrench, Tone.ok),
      DayJobType.ticket => (WorkIcons.ticket, job.priority == 'URGENT' ? Tone.bad : Tone.warn),
    };
    final t = toneColors(context, tone);
    VoidCallback? open;
    if (job.type == DayJobType.install && stop.homeId != null) {
      open = () => context.openWork(WorkRoutes.install(stop.homeId!));
    }
    if (job.type == DayJobType.ticket && job.ticketId != null) {
      open = () => context.openWork(WorkRoutes.ticket(job.ticketId!));
    }
    if (job.type == DayJobType.visit) open = () => _showVisit(context, ref, job, stop, installer);
    return Pressable(
      scale: .99,
      onTap: open,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 5),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SizedBox(width: 2),
            Container(
              width: 28,
              height: 28,
              decoration: BoxDecoration(color: t.bg, borderRadius: BorderRadius.circular(9)),
              child: Center(
                child: SbIcon(icon, size: 15, color: t.fg, weight: IconWeight.bold),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    job.title,
                    style: TextStyle(fontSize: 14.5, fontWeight: FontWeight.w600, color: c.tx, height: 1.3),
                  ),
                  if (job.detail.isNotEmpty)
                    Text(
                      job.detail,
                      maxLines: 3,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(fontSize: 13, color: c.mu, height: 1.35),
                    ),
                ],
              ),
            ),
            if (open != null)
              Padding(
                padding: const EdgeInsets.only(top: 6, left: 6),
                child: SbIcon(SbIcons.caretRight, size: 15, color: c.mu),
              ),
          ],
        ),
      ),
    );
  }
}

void _showVisit(BuildContext context, WidgetRef ref, DayJob job, DayStop stop, String? installer) {
  showSbSheet<void>(
    context,
    builder: (ctx) {
      final c = ctx.sb;
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SheetTitle(
            stop.name,
            subtitle:
                'Home visit${job.at != null ? ' · ${DateFormat('EEE d MMM, h:mm a').format(WorkDays.inPakistan(job.at!))}' : ''}',
          ),
          const SizedBox(height: 12),
          Text(job.detail, style: TextStyle(fontSize: 15, color: c.tx, height: 1.45)),
          if (stop.phone != null) ...[
            const SizedBox(height: 12),
            Text(
              stop.phone!,
              style: TextStyle(fontSize: 15, fontFamily: SbFonts.mono, color: c.mu),
            ),
          ],
          const SizedBox(height: 16),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              if (stop.phone != null)
                PillButton(
                  label: 'Call',
                  icon: WorkIcons.phone,
                  primary: true,
                  onTap: () => callNumber(ref, stop.phone!),
                ),
              PillButton(
                label: 'WhatsApp',
                icon: WorkIcons.whatsapp,
                green: true,
                onTap: () => whatsApp(ref, stop.whatsapp, WorkMessages.onMyWay(installer)),
              ),
              if (stop.directions != null)
                PillButton(
                  label: 'Directions',
                  icon: WorkIcons.navigate,
                  onTap: () => openExternal(ref, stop.directions!),
                ),
            ],
          ),
          const SizedBox(height: 10),
          Text(
            'Book the visit or turn it into a home in the web console.',
            style: TextStyle(fontSize: 13, color: c.mu),
          ),
        ],
      );
    },
  );
}

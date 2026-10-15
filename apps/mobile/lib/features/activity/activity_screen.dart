import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/sb_colors.dart';
import '../../core/theme/sb_icons.dart';
import '../../core/util/format.dart';
import '../../data/models/activity.dart';
import '../../shared/widgets/common.dart';
import '../../shared/widgets/sb_chip.dart';
import '../../state/activity.dart';
import '../../state/clock.dart';
import 'activity_row.dart';

enum _Filter {
  all('All'),
  people('People'),
  wall('Wall'),
  schedules('Schedules');

  const _Filter(this.label);
  final String label;

  bool keeps(ActivityEvent e) => switch (this) {
    all => true,
    people => e.via == EventVia.app || e.via == EventVia.voice,
    wall => e.via == EventVia.wall,
    schedules => e.via == EventVia.schedule,
  };
}

/// Everything that happened, by day, with who and how.
class ActivityScreen extends ConsumerStatefulWidget {
  const ActivityScreen({super.key});

  @override
  ConsumerState<ActivityScreen> createState() => _ActivityScreenState();
}

class _ActivityScreenState extends ConsumerState<ActivityScreen> {
  _Filter _filter = _Filter.all;
  bool _loadingMore = false;

  Future<void> _more() async {
    if (_loadingMore) return;
    setState(() => _loadingMore = true);
    try {
      await ref.read(activityProvider.notifier).loadMore();
    } finally {
      if (mounted) setState(() => _loadingMore = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final async = ref.watch(activityProvider);
    final now = ref.watch(nowProvider).value ?? DateTime.now();
    final events = (async.value ?? const <ActivityEvent>[]).where(_filter.keeps).toList();
    final exhausted = ref.read(activityProvider.notifier).exhausted;

    final children = <Widget>[];
    String? day;
    for (final (i, e) in events.indexed) {
      final d = Fmt.day(e.at, now);
      if (d != day) {
        day = d;
        children.add(
          Padding(
            padding: const EdgeInsets.only(top: 12, bottom: 6),
            child: Text(
              d.toUpperCase(),
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w600,
                color: c.mu,
              ),
            ),
          ),
        );
      }
      final last = i == events.length - 1 || Fmt.day(events[i + 1].at, now) != d;
      children.add(_TimelineRow(event: e, last: last));
    }

    return NotificationListener<ScrollNotification>(
      onNotification: (n) {
        if (n.metrics.extentAfter < 400 && !exhausted) _more();
        return false;
      },
      child: RefreshIndicator(
        onRefresh: () => ref.read(activityProvider.notifier).refresh(),
        child: ListView(
          padding: EdgeInsets.fromLTRB(
            18,
            MediaQuery.paddingOf(context).top + 4,
            18,
            130,
          ),
          children: [
            BackPill(onTap: () => context.pop()),
            const SizedBox(height: 16),
            const PageTitle('Activity'),
            const SizedBox(height: 16),
            SizedBox(
              height: 38,
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                itemCount: _Filter.values.length,
                separatorBuilder: (_, _) => const SizedBox(width: 6),
                itemBuilder: (_, i) {
                  final f = _Filter.values[i];
                  return SbChip(
                    label: f.label,
                    selected: f == _filter,
                    onTap: () => setState(() => _filter = f),
                  );
                },
              ),
            ),
            const SizedBox(height: 4),
            if (async.isLoading && async.value == null)
              const LoadingView()
            else if (async.hasError && async.value == null)
              ErrorView(
                error: async.error!,
                onRetry: () => ref.invalidate(activityProvider),
              )
            else if (events.isEmpty)
              const Padding(
                padding: EdgeInsets.only(top: 16),
                child: EmptyView(
                  icon: SbIcons.pulse,
                  title: 'Nothing here yet',
                  text: 'When lights, fans and plugs are switched — from the app, by voice, on the wall or on a schedule — it shows up here.',
                ),
              )
            else
              ...children,
            if (_loadingMore)
              const Padding(
                padding: EdgeInsets.all(16),
                child: Center(
                  child: SizedBox(
                    width: 22,
                    height: 22,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _TimelineRow extends StatelessWidget {
  const _TimelineRow({required this.event, required this.last});
  final ActivityEvent event;
  final bool last;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final (icon, bg, fg) = eventStyle(context, event.via);
    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Column(
            children: [
              Container(
                width: 38,
                height: 38,
                decoration: BoxDecoration(color: bg, shape: BoxShape.circle),
                child: Center(child: SbIcon(icon, size: 17, color: fg)),
              ),
              if (!last) Expanded(child: Container(width: 1.5, color: c.ln2)),
            ],
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(0, 8, 0, 18),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    eventTitle(event),
                    style: TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w500,
                      color: c.tx,
                      height: 1.35,
                    ),
                  ),
                  Text(
                    '${eventBy(event)} · ${Fmt.clock(event.at)}',
                    style: TextStyle(fontSize: 13, color: c.mu),
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

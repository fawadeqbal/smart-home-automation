import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_exception.dart';
import '../../core/theme/app_theme.dart';
import '../../core/theme/sb_colors.dart';
import '../../core/theme/sb_icons.dart';
import '../../core/util/format.dart';
import '../../data/models/automation.dart';
import '../../shared/widgets/common.dart';
import '../../shared/widgets/sb_switch.dart';
import '../../shared/widgets/sheet.dart';
import '../../state/automation.dart';
import '../../state/clock.dart';
import '../../state/devices.dart';
import '../../state/session.dart';
import '../../state/toast.dart';
import '../devices/device_kinds.dart';
import 'last_one_out.dart';
import 'new_routine_sheet.dart';
import 'scene_card.dart';

/// The Routines tab: scenes (many things in one tap) and schedules (things that happen on their own).
class RoutinesScreen extends ConsumerWidget {
  const RoutinesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.sb;
    final scenes = ref.watch(scenesProvider);
    final schedules = ref.watch(schedulesProvider);
    final rules = ref.watch(rulesProvider);
    final canMake = (ref.watch(devicesProvider).value ?? const []).any(
      (d) => d.canControl,
    );
    return RefreshIndicator(
      onRefresh: () async {
        ref.invalidate(scenesProvider);
        ref.invalidate(schedulesProvider);
        ref.invalidate(rulesProvider);
      },
      child: ListView(
        padding: EdgeInsets.fromLTRB(
          18,
          MediaQuery.paddingOf(context).top + 4,
          18,
          130,
        ),
        children: [
          PageTitle(
            'Routines',
            trailing: canMake
                ? RoundButton(
                    icon: SbIcons.plus,
                    label: 'New routine',
                    dark: true,
                    onTap: () => showNewRoutineSheet(context),
                  )
                : null,
          ),
          const SizedBox(height: 22),
          const SectionHeader(
            'Scenes',
            subtitle: 'Many things at once, in one tap',
          ),
          const SizedBox(height: 10),
          scenes.when(
            loading: () => const LoadingView(),
            error: (e, _) => ErrorView(
              error: e,
              onRetry: () => ref.invalidate(scenesProvider),
            ),
            data: (list) => list.isEmpty
                ? const EmptyView(
                    icon: SbIcons.sparkle,
                    title: 'No scenes yet',
                    text: 'Ask your installer to set up “Good night” or “Away” — one tap turns many things on or off.',
                  )
                : LayoutBuilder(
                    builder: (context, box) {
                      final cols = box.maxWidth > 560 ? 3 : 2;
                      final w = (box.maxWidth - 10 * (cols - 1)) / cols;
                      return Wrap(
                        spacing: 10,
                        runSpacing: 10,
                        children: [
                          for (final (i, s) in list.indexed)
                            SizedBox(
                              width: w,
                              child: SceneCard(scene: s, index: i),
                            ),
                        ],
                      );
                    },
                  ),
          ),
          const SizedBox(height: 22),
          const SectionHeader(
            'Schedules',
            subtitle: 'Things that happen on their own',
          ),
          const SizedBox(height: 10),
          schedules.when(
            loading: () => const LoadingView(),
            error: (e, _) => ErrorView(
              error: e,
              onRetry: () => ref.invalidate(schedulesProvider),
            ),
            data: (list) => list.isEmpty
                ? EmptyView(
                    icon: SbIcons.clock,
                    title: 'Nothing scheduled',
                    text: 'Turn the geyser on at 5 every morning, or a light off in half an hour.',
                    action: canMake
                        ? TextButton(
                            onPressed: () => showNewRoutineSheet(context),
                            style: TextButton.styleFrom(
                              foregroundColor: c.acText,
                            ),
                            child: const Text('New routine'),
                          )
                        : null,
                  )
                : GroupCard(
                    radius: 22,
                    children: [for (final s in list) _ScheduleRow(schedule: s)],
                  ),
          ),
          const SizedBox(height: 22),
          const SectionHeader(
            'Rules',
            subtitle: 'When this happens, do that',
          ),
          const SizedBox(height: 10),
          rules.when(
            loading: () => const LoadingView(),
            error: (e, _) => ErrorView(
              error: e,
              onRetry: () => ref.invalidate(rulesProvider),
            ),
            data: (list) => list.isEmpty
                ? const EmptyView(
                    icon: SbIcons.zap,
                    title: 'No rules yet',
                    text: 'Ask the assistant: “when the gate opens at night, turn the porch light on for 5 minutes and tell me”.',
                  )
                : GroupCard(
                    radius: 22,
                    children: [for (final r in list) _RuleRow(rule: r)],
                  ),
          ),
          if (ref.watch(meProvider).home?.manages ?? false) ...[
            const SizedBox(height: 22),
            const LastOneOutCard(),
          ],
        ],
      ),
    );
  }
}

class _ScheduleRow extends ConsumerWidget {
  const _ScheduleRow({required this.schedule});
  final Schedule schedule;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.sb;
    ref.watch(nowProvider);
    final s = schedule;
    final me = ref.watch(meProvider);
    final mine = me.home!.manages || s.createdById == me.id;
    final device = s.actions.isEmpty ? null : ref.watch(deviceProvider(s.actions.first.deviceId));
    final icon = s.sceneId != null
        ? SbIcons.sparkle
        : device != null
        ? DeviceKinds.of(device).icon(device)
        : SbIcons.clock;
    final when = s.kind == ScheduleKind.sun
        ? '${Fmt.days(s.days)} ${s.sunText}'
        : s.kind == ScheduleKind.daily
        ? '${Fmt.days(s.days)} at ${s.time}'
        : s.runAt != null
        ? 'Once, ${Fmt.when(s.runAt!).toLowerCase()}'
        : 'Once';
    final done = s.kind == ScheduleKind.once && s.lastRunAt != null;
    final next = s.enabled && s.nextRunAt != null
        ? 'Next: ${Fmt.until(s.nextRunAt!)}'
        : done
        ? null
        : 'Paused';
    final title = s.name.replaceAll(RegExp(r' · \d+ min$'), '');
    // the last run, in one line: worked, trying again, didn't work, or skipped (and what happened)
    final status = s.status;
    final last = s.lastResult == null || status == null
        ? null
        : '${switch (status) {
            RunStatus.ok => 'Worked',
            RunStatus.retrying => 'Trying again',
            RunStatus.failed => 'Didn’t work',
            RunStatus.skipped => 'Skipped',
          }}: ${s.lastResult!.replaceFirst(RegExp(r'^Skipped: '), '')}';
    final lastColor = switch (status) {
      RunStatus.failed => c.badText,
      RunStatus.retrying || RunStatus.skipped => c.onText,
      _ => c.mu,
    };

    return Opacity(
      opacity: s.enabled ? 1 : .55,
      child: InkWell(
        onLongPress: mine ? () => _confirmDelete(context, ref) : null,
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: c.sf2,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Center(child: SbIcon(icon, size: 18, color: c.tx)),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w600,
                        color: c.tx,
                      ),
                    ),
                    Text(when, style: TextStyle(fontSize: 13, color: c.mu)),
                    if (next != null)
                      Text(
                        next,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 12.5,
                          fontWeight: FontWeight.w500,
                          color: s.enabled ? c.okText : c.mu,
                        ),
                      ),
                    for (final p in s.problems)
                      Text(
                        p,
                        style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w500, color: c.onText),
                      ),
                    if (last != null)
                      Text(
                        last,
                        maxLines: 3,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(fontSize: 12.5, color: lastColor),
                      ),
                  ],
                ),
              ),
              if (mine)
                SbSwitch(
                  value: s.enabled,
                  semanticLabel: '$title on or off',
                  onChanged: (v) async {
                    try {
                      await ref.read(schedulesProvider.notifier).setEnabled(s.id, v);
                    } catch (e) {
                      ref.read(toastProvider.notifier).show(ApiException.from(e).message, error: true);
                    }
                  },
                ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _confirmDelete(BuildContext context, WidgetRef ref) async {
    final ok = await showSbSheet<bool>(
      context,
      builder: (ctx) {
        final c = ctx.sb;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'Delete “${schedule.name}”?',
              style: SbText.title.copyWith(color: c.tx),
            ),
            const SizedBox(height: 6),
            Text(
              'It won’t run again. You can always make a new one.',
              style: TextStyle(fontSize: 15, color: c.mu),
            ),
            const SizedBox(height: 20),
            BigButton(
              label: 'Delete',
              color: c.bad,
              foreground: Colors.white,
              onTap: () => Navigator.of(ctx).pop(true),
            ),
            const SizedBox(height: 8),
            TextButton(
              onPressed: () => Navigator.of(ctx).pop(false),
              child: Text('Keep it', style: TextStyle(color: c.tx)),
            ),
          ],
        );
      },
    );
    if (ok != true) return;
    try {
      await ref.read(schedulesProvider.notifier).remove(schedule.id);
      ref.read(toastProvider.notifier).show('Deleted');
    } catch (e) {
      ref.read(toastProvider.notifier).show(ApiException.from(e).message, error: true);
    }
  }
}

class _RuleRow extends ConsumerWidget {
  const _RuleRow({required this.rule});
  final Rule rule;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.sb;
    final r = rule;
    final me = ref.watch(meProvider);
    final mine = me.home!.manages || r.createdById == me.id;
    final last = r.lastFiredAt != null ? 'Last ran ${Fmt.when(r.lastFiredAt!).toLowerCase()}' : 'Hasn’t run yet';
    return Opacity(
      opacity: r.enabled ? 1 : .55,
      child: InkWell(
        onLongPress: mine ? () => _confirmDelete(context, ref) : null,
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(color: c.sf2, borderRadius: BorderRadius.circular(12)),
                child: Center(child: SbIcon(SbIcons.zap, size: 18, color: c.tx)),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(r.name, style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: c.tx)),
                    if (r.summary.isNotEmpty && r.summary != r.name)
                      Text(r.summary, style: TextStyle(fontSize: 13, color: c.mu)),
                    Text(
                      last,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w500, color: r.enabled ? c.okText : c.mu),
                    ),
                  ],
                ),
              ),
              if (mine)
                SbSwitch(
                  value: r.enabled,
                  semanticLabel: '${r.name} on or off',
                  onChanged: (v) async {
                    try {
                      await ref.read(rulesProvider.notifier).setEnabled(r.id, v);
                    } catch (e) {
                      ref.read(toastProvider.notifier).show(ApiException.from(e).message, error: true);
                    }
                  },
                ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _confirmDelete(BuildContext context, WidgetRef ref) async {
    final ok = await showSbSheet<bool>(
      context,
      builder: (ctx) {
        final c = ctx.sb;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Delete “${rule.name}”?', style: SbText.title.copyWith(color: c.tx)),
            const SizedBox(height: 6),
            Text('It won’t run again.', style: TextStyle(fontSize: 15, color: c.mu)),
            const SizedBox(height: 20),
            BigButton(label: 'Delete', color: c.bad, foreground: Colors.white, onTap: () => Navigator.of(ctx).pop(true)),
            const SizedBox(height: 8),
            TextButton(
              onPressed: () => Navigator.of(ctx).pop(false),
              child: Text('Keep it', style: TextStyle(color: c.tx)),
            ),
          ],
        );
      },
    );
    if (ok != true) return;
    try {
      await ref.read(rulesProvider.notifier).remove(rule.id);
      ref.read(toastProvider.notifier).show('Deleted');
    } catch (e) {
      ref.read(toastProvider.notifier).show(ApiException.from(e).message, error: true);
    }
  }
}

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/routing/routes.dart';
import '../../core/theme/sb_colors.dart';
import '../../core/theme/sb_icons.dart';
import '../../core/util/format.dart';
import '../../data/models/notice.dart';
import '../../push/push.dart';
import '../../shared/widgets/common.dart';
import '../../shared/widgets/pressable.dart';
import '../../state/clock.dart';
import '../../state/notices.dart';

/// The bell for the home screen's top bar: unread notices as a number.
class NoticeBell extends ConsumerWidget {
  const NoticeBell({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.sb;
    final unread = ref.watch(unreadNoticesProvider);
    return Pressable(
      onTap: () => context.openInTab(Routes.notifications),
      scale: .9,
      semanticLabel: unread == 0 ? 'Notifications' : 'Notifications, $unread unread',
      child: SizedBox(
        width: 44,
        height: 44,
        child: Stack(
          clipBehavior: Clip.none,
          alignment: Alignment.center,
          children: [
            Container(
              width: 44,
              height: 44,
              decoration: BoxDecoration(color: c.sf, shape: BoxShape.circle, boxShadow: c.shadow1),
              child: Center(child: SbIcon(SbIcons.bell, size: 20, color: c.tx)),
            ),
            if (unread > 0)
              Positioned(
                top: -2,
                right: -2,
                child: Container(
                  constraints: const BoxConstraints(minWidth: 19),
                  height: 19,
                  padding: const EdgeInsets.symmetric(horizontal: 5),
                  decoration: BoxDecoration(
                    color: const Color(0xFFFF3B30),
                    borderRadius: BorderRadius.circular(999),
                    border: Border.all(color: c.bg, width: 2),
                  ),
                  alignment: Alignment.center,
                  child: Text(
                    unread > 99 ? '99+' : '$unread',
                    style: const TextStyle(fontSize: 10.5, fontWeight: FontWeight.w700, color: Colors.white, height: 1),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// My notices, newest first. Tapping one marks it read and opens what it's about.
class NotificationsScreen extends ConsumerWidget {
  const NotificationsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.sb;
    final notices = ref.watch(noticesProvider);
    ref.watch(nowProvider);
    final unread = notices.value?.unread ?? 0;
    return RefreshIndicator(
      onRefresh: () => ref.read(noticesProvider.notifier).refresh(),
      child: ListView(
        padding: EdgeInsets.fromLTRB(18, MediaQuery.paddingOf(context).top + 4, 18, 130),
        children: [
          BackPill(onTap: () => context.pop()),
          const SizedBox(height: 16),
          PageTitle(
            'Notifications',
            subtitle: unread == 0 ? 'You’re all caught up.' : '$unread new',
            trailing: unread == 0
                ? null
                : TextButton(
                    onPressed: () => ref.read(noticesProvider.notifier).markAllRead(),
                    style: TextButton.styleFrom(foregroundColor: c.acText, minimumSize: const Size(44, 44)),
                    child: const Text('Mark all read', style: TextStyle(fontWeight: FontWeight.w600)),
                  ),
          ),
          const SizedBox(height: 16),
          notices.when(
            loading: () => const LoadingView(),
            error: (e, _) => ErrorView(error: e, onRetry: () => ref.invalidate(noticesProvider)),
            data: (list) => list.items.isEmpty
                ? const EmptyView(
                    icon: SbIcons.bell,
                    title: 'No notifications yet',
                    text: 'A water leak, a door at night or a board going offline shows up here. Choose what you get on the Me tab.',
                  )
                : GroupCard(children: [for (final n in list.items) NoticeRow(notice: n)]),
          ),
        ],
      ),
    );
  }
}

class NoticeRow extends ConsumerWidget {
  const NoticeRow({super.key, required this.notice});
  final Notice notice;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.sb;
    final n = notice;
    final (bg, fg, icon) = switch (n.severity) {
      NoticeSeverity.alert => (c.badSoft, c.badText, SbIcons.warning),
      NoticeSeverity.warn => (c.onSoft, c.onText, SbIcons.bell),
      NoticeSeverity.info => (c.sf2, c.tx, SbIcons.bell),
    };
    return InkWell(
      onTap: () {
        ref.read(noticesProvider.notifier).markRead(n.id);
        ref.read(pushControllerProvider).open(link: n.link, homeId: n.homeId);
      },
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 36,
              height: 36,
              decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(11)),
              child: Center(child: SbIcon(icon, size: 18, color: fg, weight: IconWeight.duotone)),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    n.title,
                    style: TextStyle(fontSize: 15, fontWeight: n.unread ? FontWeight.w600 : FontWeight.w500, color: c.tx),
                  ),
                  if (n.body.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 2),
                      child: Text(n.body, style: TextStyle(fontSize: 13.5, color: c.mu, height: 1.35)),
                    ),
                  if (n.createdAt != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 4),
                      child: Text(Fmt.ago(n.createdAt!), style: TextStyle(fontSize: 12, color: c.mu)),
                    ),
                ],
              ),
            ),
            if (n.unread)
              Padding(
                padding: const EdgeInsets.only(left: 8, top: 6),
                child: Container(
                  width: 9,
                  height: 9,
                  decoration: BoxDecoration(color: c.ac, shape: BoxShape.circle),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

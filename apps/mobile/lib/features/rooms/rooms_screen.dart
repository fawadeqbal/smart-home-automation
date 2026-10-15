import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/routing/routes.dart';
import '../../core/theme/sb_icons.dart';
import '../../shared/widgets/common.dart';
import '../../state/devices.dart';
import '../../state/home_overview.dart';
import 'room_card.dart';

/// The Rooms tab: every room you can use, as cards.
class RoomsScreen extends ConsumerWidget {
  const RoomsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final rooms = ref.watch(roomSummariesProvider);
    final loading = ref.watch(roomsProvider).isLoading && rooms.isEmpty;
    final error = ref.watch(roomsProvider).error;
    return RefreshIndicator(
      onRefresh: () async {
        ref.invalidate(roomsProvider);
        await ref.read(devicesProvider.notifier).refresh();
      },
      child: ListView(
        padding: EdgeInsets.fromLTRB(
          18,
          MediaQuery.paddingOf(context).top + 4,
          18,
          130,
        ),
        children: [
          const PageTitle('Rooms'),
          const SizedBox(height: 18),
          if (loading)
            const LoadingView()
          else if (error != null && rooms.isEmpty)
            ErrorView(
              error: error,
              onRetry: () => ref.invalidate(roomsProvider),
            )
          else if (rooms.isEmpty)
            const EmptyView(
              icon: SbIcons.rooms,
              title: 'No rooms yet',
              text: 'Rooms appear here once your installer sets them up — or once someone shares one with you.',
            )
          else
            LayoutBuilder(
              builder: (context, box) {
                final cols = box.maxWidth > 560 ? 3 : 2;
                const gap = 10.0;
                final w = (box.maxWidth - gap * (cols - 1)) / cols;
                return Wrap(
                  spacing: gap,
                  runSpacing: gap,
                  children: [
                    for (final r in rooms)
                      RoomCard(
                        summary: r,
                        width: w,
                        onTap: () => context.openInTab('room/${r.room.id}'),
                      ),
                  ],
                );
              },
            ),
        ],
      ),
    );
  }
}

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/sb_colors.dart';
import '../../core/theme/sb_icons.dart';
import '../../data/models/device.dart';
import '../../data/models/people.dart';
import '../../data/models/session.dart';
import '../../shared/widgets/common.dart';
import '../../shared/widgets/pressable.dart';
import '../../state/devices.dart';
import '../../state/people.dart';
import '../../state/session.dart';
import 'invite_sheet.dart';

/// Who can use what in the home (owners and admins).
class FamilyScreen extends ConsumerWidget {
  const FamilyScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.sb;
    final me = ref.watch(meProvider);
    final members = ref.watch(membersProvider);
    final rooms = <String, String>{
      for (final r in ref.watch(roomsProvider).value ?? const <Room>[]) r.id: r.name,
    };
    return RefreshIndicator(
      onRefresh: () async => ref.invalidate(membersProvider),
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
          PageTitle(
            'Family',
            subtitle: 'Who can use what in ${me.home?.name ?? 'your home'}.',
          ),
          const SizedBox(height: 16),
          members.when(
            loading: () => const LoadingView(),
            error: (e, _) => ErrorView(
              error: e,
              onRetry: () => ref.invalidate(membersProvider),
            ),
            data: (list) => Column(
              children: [
                for (final m in list.where((m) => !m.disabled))
                  Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: _MemberCard(
                      member: m,
                      isMe: m.id == me.id,
                      roomNames: rooms,
                    ),
                  ),
              ],
            ),
          ),
          Pressable(
            onTap: () => showInviteSheet(context),
            scale: .98,
            child: Container(
              height: 54,
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(18),
                border: Border.all(color: c.ln2, width: 1.5),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  SbIcon(SbIcons.userPlus, size: 18, color: c.tx),
                  const SizedBox(width: 10),
                  Text(
                    'Invite someone',
                    style: TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w600,
                      color: c.tx,
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

class _MemberCard extends StatelessWidget {
  const _MemberCard({
    required this.member,
    required this.isMe,
    required this.roomNames,
  });
  final Member member;
  final bool isMe;
  final Map<String, String> roomNames;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final (bg, fg) = switch (member.role) {
      HomeRole.owner => (c.on, SbColors.onInk),
      HomeRole.admin => (c.acSoft, c.acText),
      _ => (c.sf2, c.tx),
    };
    final rooms = member.role.manages ? ['All rooms'] : [for (final id in member.rooms.keys) ?roomNames[id]];
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: c.sf,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: c.ln2),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Avatar(member.initials, background: bg, foreground: fg),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      member.name,
                      style: TextStyle(
                        fontSize: 15.5,
                        fontWeight: FontWeight.w600,
                        color: c.tx,
                      ),
                    ),
                    Text(
                      '${member.role.label}${isMe ? ' · you' : ''}',
                      style: TextStyle(fontSize: 13, color: c.mu),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              if (rooms.isEmpty)
                Text(
                  'No rooms shared yet',
                  style: TextStyle(fontSize: 12.5, color: c.mu),
                ),
              for (final r in rooms)
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 4,
                  ),
                  decoration: BoxDecoration(
                    color: c.sf2,
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    r,
                    style: TextStyle(
                      fontSize: 12.5,
                      fontWeight: FontWeight.w500,
                      color: c.tx,
                    ),
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

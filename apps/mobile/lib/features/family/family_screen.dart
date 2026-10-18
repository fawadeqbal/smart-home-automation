import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../core/network/api_exception.dart';
import '../../core/theme/app_theme.dart';
import '../../core/theme/sb_colors.dart';
import '../../core/theme/sb_icons.dart';
import '../../data/models/device.dart';
import '../../data/models/people.dart';
import '../../data/models/session.dart';
import '../../data/repositories/people_repository.dart';
import '../../shared/widgets/common.dart';
import '../../shared/widgets/pill.dart';
import '../../shared/widgets/pressable.dart';
import '../../state/devices.dart';
import '../../state/people.dart';
import '../../state/session.dart';
import '../../state/toast.dart';
import 'access_limits.dart';
import 'invite_sheet.dart';
import 'person_sheet.dart';

/// Invites sent but not used yet, with Cancel.
class _PendingInvites extends ConsumerWidget {
  const _PendingInvites();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.sb;
    final list = ref.watch(pendingInvitesProvider).value ?? const <PendingInvite>[];
    if (list.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: 22),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const GroupLabel('Invited, not joined yet'),
          GroupCard(
            children: [
              for (final i in list)
                InfoRow(
                  icon: SbIcons.envelope,
                  title: i.name ?? i.email,
                  subtitle: [
                    if (i.name != null) i.email,
                    i.role.label,
                    if (i.expiresAt != null) 'link works until ${DateFormat('d MMM').format(i.expiresAt!)}',
                    ?i.access,
                  ].join(' · '),
                  trailing: TextButton(
                    onPressed: () async {
                      try {
                        await ref.read(peopleRepositoryProvider).cancelInvite(i.id);
                        ref.invalidate(pendingInvitesProvider);
                        ref.read(toastProvider.notifier).show('Invite cancelled');
                      } catch (e) {
                        ref.read(toastProvider.notifier).show(ApiException.from(e).message, error: true);
                      }
                    },
                    style: TextButton.styleFrom(
                      foregroundColor: c.badText,
                      textStyle: const TextStyle(fontFamily: SbFonts.sans, fontSize: 14, fontWeight: FontWeight.w600),
                    ),
                    child: const Text('Cancel'),
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

/// "Expired" (red), "Outside hours" (grey) or "Limited" (blue).
class _AccessBadge extends StatelessWidget {
  const _AccessBadge({required this.status});
  final AccessStatus status;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final (text, bg, fg) = switch (status) {
      AccessStatus.expired => ('Expired', c.badSoft, c.badText),
      AccessStatus.outside => ('Outside hours', c.sf2, c.mu),
      AccessStatus.active => ('Limited', c.acSoft, c.acText),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(999)),
      child: Text(text, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: fg)),
    );
  }
}

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
      onRefresh: () async {
        ref.invalidate(membersProvider);
        ref.invalidate(pendingInvitesProvider);
      },
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
                for (final m in list)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: Pressable(
                      scale: .98,
                      semanticLabel: m.name,
                      // everyone but me and the owner can be changed here
                      onTap: m.id == me.id || m.role == HomeRole.owner ? null : () => showPersonSheet(context, m.id),
                      child: Opacity(
                        opacity: m.disabled ? .55 : 1,
                        child: _MemberCard(
                          member: m,
                          isMe: m.id == me.id,
                          roomNames: rooms,
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ),
          Pressable(
            onTap: () async {
              await showInviteSheet(context);
              ref.invalidate(pendingInvitesProvider);
            },
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
          const _PendingInvites(),
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
                      '${member.role.label}${isMe ? ' · you' : ''}${member.disabled ? ' · disabled' : ''}',
                      style: TextStyle(fontSize: 13, color: c.mu),
                    ),
                    if (!isMe && member.role != HomeRole.owner)
                      Text('Tap to change rooms and role', style: TextStyle(fontSize: 12.5, color: c.acText)),
                  ],
                ),
              ),
              if (!isMe && (member.role == HomeRole.member || member.role == HomeRole.guest))
                TextButton(
                  onPressed: () => showAccessSheet(context, member),
                  style: TextButton.styleFrom(foregroundColor: c.acText, minimumSize: const Size(44, 40)),
                  child: Text(
                    member.access?.status == AccessStatus.expired ? 'Extend' : member.access != null ? 'Hours' : 'Limit',
                    style: const TextStyle(fontWeight: FontWeight.w600),
                  ),
                ),
            ],
          ),
          if (member.access case final a?)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Row(
                children: [
                  _AccessBadge(status: a.status),
                  const SizedBox(width: 8),
                  Expanded(child: Text(a.summary ?? '', style: TextStyle(fontSize: 12.5, color: c.mu))),
                ],
              ),
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

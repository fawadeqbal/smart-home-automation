import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:share_plus/share_plus.dart';

import '../../core/config/app_settings.dart';
import '../../core/network/api_exception.dart';
import '../../core/theme/app_theme.dart';
import '../../core/theme/sb_colors.dart';
import '../../core/theme/sb_icons.dart';
import '../../core/theme/sb_icons_more.dart';
import '../../data/models/people.dart';
import '../../data/models/session.dart';
import '../../data/repositories/people_repository.dart';
import '../../shared/widgets/common.dart';
import '../../shared/widgets/pill.dart';
import '../../shared/widgets/segmented.dart';
import '../../shared/widgets/sheet.dart';
import '../../state/devices.dart';
import '../../state/people.dart';
import '../../state/session.dart';
import '../../state/toast.dart';
import 'access_limits.dart';

/// Pending invites (owners and admins), kept until they're used, cancelled or run out.
final pendingInvitesProvider = FutureProvider.autoDispose<List<PendingInvite>>((ref) async {
  final home = ref.watch(sessionProvider.select((s) => s.value?.home));
  if (home == null || !home.manages) return const [];
  return ref.read(peopleRepositoryProvider).invites();
});

/// Family → a person: their role, which rooms they have and how, hours, a password link, switching
/// their account off, or removing them — what the web's People table does, one person at a time.
Future<void> showPersonSheet(BuildContext context, String memberId) =>
    showSbSheet<void>(context, builder: (_) => _PersonSheet(memberId: memberId));

class _PersonSheet extends ConsumerStatefulWidget {
  const _PersonSheet({required this.memberId});
  final String memberId;

  @override
  ConsumerState<_PersonSheet> createState() => _PersonSheetState();
}

class _PersonSheetState extends ConsumerState<_PersonSheet> {
  bool _busy = false;
  String? _link;

  Future<void> _run(Future<void> Function(PeopleRepository repo) call, String done) async {
    setState(() => _busy = true);
    try {
      await call(ref.read(peopleRepositoryProvider));
      ref.invalidate(membersProvider);
      await ref.read(membersProvider.future);
      ref.read(toastProvider.notifier).show(done);
    } catch (e) {
      ref.read(toastProvider.notifier).show(ApiException.from(e).message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _pickAccess(Member m, String roomId, String roomName) async {
    final options = [null, Access.view, Access.control, if (m.role == HomeRole.member) Access.manage];
    final picked = await showSbSheet<(Access?,)>(
      context,
      builder: (ctx) {
        final c = ctx.sb;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('${m.name.split(' ').first} in the ${roomName.toLowerCase()}', style: SbText.title.copyWith(color: c.tx)),
            const SizedBox(height: 12),
            GroupCard(
              children: [
                for (final a in options)
                  InfoRow(
                    icon: a == null ? SbIcons.x : a == Access.view ? SbIcons.eye : a == Access.control ? SbIcons.toggle : MoreIcons.pencil,
                    title: accessLabel(a),
                    subtitle: switch (a) {
                      null => 'They don’t see this room',
                      Access.view => 'See what’s on, but not switch',
                      Access.control => 'Switch things on and off',
                      Access.manage => 'Switch, and rename its devices',
                    },
                    trailing: m.rooms[roomId] == a ? SbIcon(SbIcons.check, size: 18, color: c.okText) : const SizedBox.shrink(),
                    onTap: () => Navigator.of(ctx).pop((a,)),
                  ),
              ],
            ),
          ],
        );
      },
    );
    if (picked == null || picked.$1 == m.rooms[roomId]) return;
    final rooms = {...m.rooms};
    if (picked.$1 == null) {
      rooms.remove(roomId);
    } else {
      rooms[roomId] = picked.$1!;
    }
    await _run((repo) => repo.setRooms(m.id, rooms), picked.$1 == null ? 'The ${roomName.toLowerCase()} is no longer shared' : '${accessLabel(picked.$1)} in the ${roomName.toLowerCase()}');
  }

  Future<void> _remove(Member m) async {
    final ok = await showSbSheet<bool>(
      context,
      builder: (ctx) {
        final c = ctx.sb;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Remove ${m.name}?', style: SbText.title.copyWith(color: c.tx)),
            const SizedBox(height: 6),
            Text('They can no longer open this home. Their account is deleted if they belong to no other home.', style: TextStyle(fontSize: 15, color: c.mu)),
            const SizedBox(height: 20),
            BigButton(label: 'Remove', color: c.bad, foreground: Colors.white, onTap: () => Navigator.of(ctx).pop(true)),
            const SizedBox(height: 8),
            TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: Text('Cancel', style: TextStyle(color: c.tx))),
          ],
        );
      },
    );
    if (ok != true) return;
    await _run((repo) => repo.remove(m.id), '${m.name.split(' ').first} was removed');
    if (mounted) Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final me = ref.watch(meProvider);
    final m = (ref.watch(membersProvider).value ?? const <Member>[]).where((x) => x.id == widget.memberId).firstOrNull;
    final rooms = ref.watch(roomsProvider).value ?? const [];
    if (m == null) return const Padding(padding: EdgeInsets.all(24), child: Text('This person isn’t in the home any more.'));
    final iAmOwner = me.home?.role == HomeRole.owner;
    final limited = m.role == HomeRole.member || m.role == HomeRole.guest;
    final canRole = limited || (iAmOwner && m.role == HomeRole.admin);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Avatar(m.initials, size: 52),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(m.name, style: SbText.title.copyWith(color: c.tx)),
                  Text(m.email, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 14, color: c.mu)),
                ],
              ),
            ),
            if (m.disabled) const Pill('Disabled', tone: PillTone.bad),
          ],
        ),
        if (canRole) ...[
          const SizedBox(height: 18),
          Text('Role', style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w500, color: c.tx)),
          const SizedBox(height: 8),
          Segmented<HomeRole>(
            options: [if (iAmOwner) (HomeRole.admin, 'Admin'), (HomeRole.member, 'Member'), (HomeRole.guest, 'Guest')],
            value: m.role,
            onChanged: (r) => _busy || r == m.role ? null : _run((repo) => repo.setRole(m.id, r), '${m.name.split(' ').first} is now ${r.label.toLowerCase()}'),
          ),
          const SizedBox(height: 6),
          Text(
            switch (m.role) {
              HomeRole.admin => 'Admins look after the home like the owner: people, health, everyone’s routines.',
              HomeRole.guest => 'Guests use the rooms you share, can have hours and an end date, and can’t make routines for others.',
              _ => 'Members use the rooms you share with them.',
            },
            style: TextStyle(fontSize: 12.5, color: c.mu),
          ),
        ],
        if (limited) ...[
          const SizedBox(height: 18),
          Text('Rooms', style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w500, color: c.tx)),
          const SizedBox(height: 8),
          GroupCard(
            children: [
              for (final r in rooms)
                InfoRow(
                  icon: SbIcons.rooms,
                  title: r.name,
                  trailing: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(accessLabel(m.rooms[r.id]), style: TextStyle(fontSize: 13.5, color: m.rooms[r.id] == null ? c.mu : c.acText, fontWeight: FontWeight.w500)),
                      const SizedBox(width: 6),
                      SbIcon(SbIcons.caretRight, size: 15, color: c.mu),
                    ],
                  ),
                  onTap: _busy ? null : () => _pickAccess(m, r.id, r.name),
                ),
            ],
          ),
        ],
        const SizedBox(height: 18),
        GroupCard(
          children: [
            if (limited)
              InfoRow(
                icon: SbIcons.clock,
                title: m.access == null ? 'Limit to hours or an end date' : 'Change access hours',
                subtitle: m.access?.summary,
                onTap: () => showAccessSheet(context, m),
              ),
            if (!m.disabled)
              InfoRow(
                icon: MoreIcons.key,
                title: 'Password link',
                subtitle: 'For someone who can’t get the reset email',
                onTap: _busy
                    ? null
                    : () async {
                        try {
                          final path = await ref.read(peopleRepositoryProvider).passwordLink(m.id);
                          setState(() => _link = '${ref.read(serverUrlProvider) ?? ''}$path');
                        } catch (e) {
                          ref.read(toastProvider.notifier).show(ApiException.from(e).message, error: true);
                        }
                      },
              ),
            InfoRow(
              icon: m.disabled ? SbIcons.check : SbIcons.lock,
              title: m.disabled ? 'Enable account' : 'Disable account',
              subtitle: m.disabled ? 'They can sign in again' : 'They can’t sign in until you enable it',
              onTap: _busy ? null : () => _run((repo) => repo.setDisabled(m.id, !m.disabled), m.disabled ? 'Account enabled' : 'Account disabled'),
            ),
            InfoRow(
              icon: SbIcons.trash,
              title: 'Remove from the home',
              titleColor: c.badText,
              tint: (c.badSoft, c.badText),
              trailing: const SizedBox.shrink(),
              onTap: _busy ? null : () => _remove(m),
            ),
          ],
        ),
        if (_link != null) ...[
          const SizedBox(height: 14),
          GroupCard(children: [CopyRow(label: 'Password link (works once)', value: _link!)]),
          const SizedBox(height: 8),
          BigButton(
            label: 'Send it on WhatsApp',
            icon: SbIcons.share,
            height: 48,
            onTap: () => SharePlus.instance.share(ShareParams(text: 'Choose a new password for Switchboard with this link (it works once): $_link')),
          ),
        ],
      ],
    );
  }
}

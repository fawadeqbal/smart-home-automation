import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:share_plus/share_plus.dart';

import '../../core/config/app_settings.dart';
import '../../core/network/api_exception.dart';
import '../../core/theme/app_theme.dart';
import '../../core/theme/sb_colors.dart';
import '../../core/theme/sb_icons.dart';
import '../../data/models/session.dart';
import '../../data/repositories/people_repository.dart';
import '../../shared/widgets/common.dart';
import '../../shared/widgets/sb_chip.dart';
import '../../shared/widgets/sb_switch.dart';
import '../../shared/widgets/segmented.dart';
import '../../shared/widgets/sheet.dart';
import '../../state/devices.dart';
import '../../state/people.dart';
import '../../state/session.dart';
import '../../state/toast.dart';
import 'access_limits.dart';

Future<void> showInviteSheet(BuildContext context) => showSbSheet<void>(context, builder: (_) => const InviteSheet());

/// Invite family or a guest: name, email, which rooms. Gives a link to send (WhatsApp, email…).
class InviteSheet extends ConsumerStatefulWidget {
  const InviteSheet({super.key});

  @override
  ConsumerState<InviteSheet> createState() => _InviteSheetState();
}

class _InviteSheetState extends ConsumerState<InviteSheet> {
  final _name = TextEditingController();
  final _email = TextEditingController();
  HomeRole _role = HomeRole.member;
  bool _allRooms = true;
  final Set<String> _rooms = {};
  bool _busy = false;
  String? _link;
  String? _error;
  bool _limited = false;
  LimitsDraft _limits = const LimitsDraft();
  int _days = 7;
  String? _accessText;

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final email = _email.text.trim();
    if (!RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$').hasMatch(email)) {
      setState(
        () => _error = 'Enter their email address, like name@gmail.com.',
      );
      return;
    }
    final rooms = ref.read(roomsProvider).value ?? const [];
    final chosen = _allRooms ? rooms.map((r) => r.id).toSet() : _rooms;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final invite = await ref
          .read(peopleRepositoryProvider)
          .invite(
            email: email,
            name: _name.text.trim(),
            role: _role,
            rooms: {for (final id in chosen) id: Access.control},
            limits: _limited && _limits.any ? _limits.body : null,
          );
      ref.invalidate(membersProvider);
      setState(() {
        _link = '${ref.read(serverUrlProvider)}${invite.path}';
        _days = invite.expiresInDays;
        _accessText = invite.access;
      });
    } catch (e) {
      setState(() => _error = ApiException.from(e).message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final rooms = ref.watch(roomsProvider).value ?? const [];
    final home = ref.watch(meProvider).home?.name ?? 'our home';

    if (_link != null) {
      final first = _name.text.trim().split(' ').first;
      final message = 'You’re invited to $home on Switchboard. Open this link to join: $_link';
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(
            width: 56,
            height: 56,
            decoration: BoxDecoration(color: c.okSoft, shape: BoxShape.circle),
            child: Center(
              child: SbIcon(
                SbIcons.check,
                size: 26,
                color: c.okText,
                weight: IconWeight.bold,
              ),
            ),
          ),
          const SizedBox(height: 14),
          Text('Invite ready', style: SbText.title.copyWith(color: c.tx)),
          const SizedBox(height: 4),
          Text(
            'Send ${first.isEmpty ? 'them' : first} this link. It works once, for $_days day${_days == 1 ? '' : 's'}.'
            '${_accessText != null ? ' Their access: $_accessText.' : ''}',
            style: TextStyle(fontSize: 15, color: c.mu),
          ),
          const SizedBox(height: 14),
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: c.sf2,
              borderRadius: BorderRadius.circular(14),
            ),
            child: SelectableText(
              _link!,
              style: TextStyle(
                fontFamily: 'GeistMono',
                fontSize: 13,
                color: c.tx,
              ),
            ),
          ),
          const SizedBox(height: 14),
          BigButton(
            label: 'Send the link',
            icon: SbIcons.share,
            onTap: () => SharePlus.instance.share(
              ShareParams(text: message, subject: 'Join $home'),
            ),
          ),
          const SizedBox(height: 8),
          TextButton(
            onPressed: () async {
              await Clipboard.setData(ClipboardData(text: _link!));
              ref.read(toastProvider.notifier).show('Link copied');
            },
            child: Text(
              'Copy link',
              style: TextStyle(color: c.acText, fontWeight: FontWeight.w600),
            ),
          ),
        ],
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                'Invite someone',
                style: SbText.title.copyWith(color: c.tx),
              ),
            ),
            RoundButton(
              icon: SbIcons.x,
              label: 'Close',
              onTap: () => Navigator.of(context).pop(),
            ),
          ],
        ),
        const SizedBox(height: 16),
        TextField(
          controller: _name,
          textCapitalization: TextCapitalization.words,
          decoration: const InputDecoration(hintText: 'Name'),
        ),
        const SizedBox(height: 10),
        TextField(
          controller: _email,
          keyboardType: TextInputType.emailAddress,
          autocorrect: false,
          decoration: const InputDecoration(hintText: 'Email'),
        ),
        const SizedBox(height: 12),
        Segmented<HomeRole>(
          options: const [
            (HomeRole.member, 'Family'),
            (HomeRole.guest, 'Guest'),
          ],
          value: _role,
          onChanged: (v) => setState(() => _role = v),
        ),
        const SizedBox(height: 14),
        Text(
          'Can use',
          style: TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w600,
            color: c.mu,
          ),
        ),
        const SizedBox(height: 8),
        Wrap(
          spacing: 6,
          runSpacing: 6,
          children: [
            SbChip(
              label: 'All rooms',
              tone: ChipTone.amber,
              height: 34,
              selected: _allRooms,
              onTap: () => setState(() => _allRooms = !_allRooms),
            ),
            for (final r in rooms)
              SbChip(
                label: r.name,
                tone: ChipTone.amber,
                height: 34,
                selected: !_allRooms && _rooms.contains(r.id),
                onTap: () => setState(() {
                  _allRooms = false;
                  _rooms.contains(r.id) ? _rooms.remove(r.id) : _rooms.add(r.id);
                }),
              ),
          ],
        ),
        if (_role == HomeRole.guest)
          Padding(
            padding: const EdgeInsets.only(top: 10),
            child: Text(
              'Guests switch things in the rooms you pick. Remove them anytime.',
              style: TextStyle(fontSize: 13, color: c.mu),
            ),
          ),
        const SizedBox(height: 14),
        Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('For a while, or at certain hours', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w500, color: c.tx)),
                  Text('A guest for the weekend, help from 9:00 to 17:00', style: TextStyle(fontSize: 13, color: c.mu)),
                ],
              ),
            ),
            SbSwitch(value: _limited, onChanged: (v) => setState(() => _limited = v), semanticLabel: 'For a while, or at certain hours'),
          ],
        ),
        if (_limited) ...[
          const SizedBox(height: 12),
          LimitsFields(value: _limits, onChanged: (v) => setState(() => _limits = v)),
        ],
        if (_error != null)
          Padding(
            padding: const EdgeInsets.only(top: 12),
            child: Note(
              tone: NoteTone.bad,
              icon: SbIcons.warning,
              child: Text(_error!),
            ),
          ),
        const SizedBox(height: 16),
        BigButton(label: 'Make an invite link', busy: _busy, onTap: _send),
      ],
    );
  }
}

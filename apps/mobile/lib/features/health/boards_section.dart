import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_client.dart';
import '../../core/network/api_exception.dart';
import '../../core/theme/app_theme.dart';
import '../../core/theme/sb_colors.dart';
import '../../core/theme/sb_icons.dart';
import '../../core/theme/sb_icons_more.dart';
import '../../core/util/format.dart';
import '../../data/models/board.dart';
import '../../data/models/json.dart';
import '../../shared/widgets/common.dart';
import '../../shared/widgets/pill.dart';
import '../../shared/widgets/sb_chip.dart';
import '../../shared/widgets/sheet.dart';
import '../../state/session.dart';
import '../../state/toast.dart';
import '../auth/auth_widgets.dart';

/// The home's boards (owners and admins; empty for anyone else or when they can't be read).
final boardsProvider = FutureProvider.autoDispose<List<BoardInfo>>((ref) async {
  final home = ref.watch(sessionProvider.select((s) => s.value?.home));
  if (home == null || !home.role.manages) return const [];
  try {
    final list = asJsonList(await ref.read(apiClientProvider).get<Object?>('/nodes')).map(BoardInfo.fromJson).where((b) => b.installed).toList();
    return list;
  } catch (_) {
    return const [];
  }
});

/// Diagnostics, like the web's: each board's condition, signal, supply, memory, uptime and firmware,
/// what to try, and "Send to support". The wiring itself is the installer's (a big-screen job).
class BoardsSection extends ConsumerStatefulWidget {
  const BoardsSection({super.key});

  @override
  ConsumerState<BoardsSection> createState() => _BoardsSectionState();
}

class _BoardsSectionState extends ConsumerState<BoardsSection> {
  String? _open;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final boards = ref.watch(boardsProvider).value ?? const <BoardInfo>[];
    final readOnly = ref.watch(meProvider.select((m) => m.home?.readOnly ?? true));
    final viaStaff = ref.watch(meProvider.select((m) => m.home?.viaStaff ?? false));
    if (boards.isEmpty) return const SizedBox.shrink();
    final open = _open ?? boards.where((b) => b.condition.$1 != 'ok').firstOrNull?.id;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SizedBox(height: 16),
        const GroupLabel('Boards behind the switchboards'),
        GroupCard(
          radius: 22,
          children: [
            for (final b in boards) _Board(board: b, open: b.id == open, onTap: () => setState(() => _open = open == b.id ? '' : b.id)),
          ],
        ),
        if (!readOnly && !viaStaff) ...[
          const SizedBox(height: 10),
          BigButton(
            label: 'Send to support',
            icon: SbIcons.paperPlane,
            height: 48,
            color: c.sf2,
            foreground: c.tx,
            onTap: () => showSbSheet<void>(context, builder: (_) => _SendToSupport(boards: boards, board: open)),
          ),
          const SizedBox(height: 6),
          Text('Wiring and pins are managed by your installer. If something looks wrong, send it to support.', style: TextStyle(fontSize: 12.5, color: c.mu)),
        ],
      ],
    );
  }
}

class _Board extends StatelessWidget {
  const _Board({required this.board, required this.open, required this.onTap});
  final BoardInfo board;
  final bool open;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final b = board;
    final (tone, label) = b.condition;
    final color = switch (tone) {
      'ok' => c.ok,
      'warn' => c.on,
      _ => c.bad,
    };
    final seen = b.online ? 'just now' : b.lastSeenAt == null ? 'never' : Fmt.ago(b.lastSeenAt!).toLowerCase();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        InkWell(
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(14, 12, 12, 12),
            child: Row(
              children: [
                Container(width: 10, height: 10, decoration: BoxDecoration(color: color, shape: BoxShape.circle)),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(b.name, style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: c.tx)),
                      Text('$label · ${b.devices} device${b.devices == 1 ? '' : 's'} · seen $seen', style: TextStyle(fontSize: 13, color: tone == 'ok' ? c.mu : (tone == 'warn' ? c.onText : c.badText))),
                    ],
                  ),
                ),
                AnimatedRotation(turns: open ? .5 : 0, duration: const Duration(milliseconds: 200), child: SbIcon(SbIcons.caretDown, size: 16, color: c.mu)),
              ],
            ),
          ),
        ),
        if (open)
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 0, 14, 14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    _Metric(label: 'Wi‑Fi signal', value: b.online ? b.signalText : '—', warn: b.rssi != null && b.rssi! < -75),
                    _Metric(label: 'Supply', value: b.online ? b.supplyText : '—', warn: b.vcc != null && b.vcc! < 3000),
                    _Metric(label: 'Memory', value: b.online ? b.memoryText : '—'),
                    _Metric(label: 'Up for', value: b.online ? b.uptimeText : '—'),
                    _Metric(label: 'Firmware', value: b.firmware ?? '—'),
                  ],
                ),
                if (b.advice.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(color: tone == 'bad' ? c.badSoft : c.onSoft, borderRadius: BorderRadius.circular(14)),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Text('What to try', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: c.tx)),
                        const SizedBox(height: 6),
                        for (final (i, t) in b.advice.indexed)
                          Padding(
                            padding: const EdgeInsets.only(top: 4),
                            child: Text('${i + 1}. $t', style: TextStyle(fontSize: 13.5, color: c.tx, height: 1.4)),
                          ),
                      ],
                    ),
                  ),
                ],
              ],
            ),
          ),
      ],
    );
  }
}

class _Metric extends StatelessWidget {
  const _Metric({required this.label, required this.value, this.warn = false});
  final String label, value;
  final bool warn;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    return Container(
      constraints: const BoxConstraints(minWidth: 140),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
      decoration: BoxDecoration(color: c.sf2, borderRadius: BorderRadius.circular(12)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(label, style: TextStyle(fontSize: 12, color: c.mu)),
          Text(value, style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: warn ? c.onText : c.tx)),
        ],
      ),
    );
  }
}

/// A help request about the whole home or one board; the installer and support see it with the board.
class _SendToSupport extends ConsumerStatefulWidget {
  const _SendToSupport({required this.boards, this.board});
  final List<BoardInfo> boards;
  final String? board;

  @override
  ConsumerState<_SendToSupport> createState() => _SendToSupportState();
}

class _SendToSupportState extends ConsumerState<_SendToSupport> {
  late String? _board = widget.board == '' ? null : widget.board;
  final _text = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    if (_text.text.trim().length < 3) {
      setState(() => _error = 'Say what’s wrong, in a few words.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final r = asJson(await ref.read(apiClientProvider).post<Object?>('/home/support', {'message': _text.text.trim(), 'nodeId': ?_board}));
      if (mounted) Navigator.of(context).pop();
      ref.read(toastProvider.notifier).show('Sent as request #${integer(asJson(r['ticket'])['number'])}. The answer comes in Help requests.');
    } catch (e) {
      if (mounted) {
        setState(() {
          _busy = false;
          _error = ApiException.from(e).message;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('Send to support', style: SbText.title.copyWith(color: c.tx)),
        const SizedBox(height: 4),
        Text('Your installer and the support team get it with the board’s details; their answers come back in Help requests.', style: TextStyle(fontSize: 14.5, color: c.mu)),
        const SizedBox(height: 14),
        Text('Which board?', style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w500, color: c.tx)),
        const SizedBox(height: 8),
        Wrap(
          spacing: 6,
          runSpacing: 6,
          children: [
            SbChip(label: 'The whole home', selected: _board == null, height: 38, onTap: () => setState(() => _board = null)),
            for (final b in widget.boards) SbChip(label: b.name, selected: _board == b.id, height: 38, icon: MoreIcons.cpu, onTap: () => setState(() => _board = b.id)),
          ],
        ),
        const SizedBox(height: 14),
        LabeledField(label: 'What’s wrong?', controller: _text, icon: SbIcons.message, hint: 'The kitchen lights don’t respond from the app since this morning.'),
        if (_error != null) ...[
          const SizedBox(height: 12),
          Note(tone: NoteTone.bad, icon: SbIcons.warning, child: Text(_error!)),
        ],
        const SizedBox(height: 16),
        BigButton(label: 'Send', icon: SbIcons.paperPlane, busy: _busy, onTap: _send),
      ],
    );
  }
}

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme/app_theme.dart';
import '../../core/theme/sb_colors.dart';
import '../../core/theme/sb_icons.dart';
import '../../core/util/format.dart';
import '../../data/models/work/board.dart';
import '../../data/repositories/work_repository.dart';
import '../../shared/widgets/common.dart';
import '../../shared/widgets/pressable.dart';
import '../../shared/widgets/segmented.dart';
import '../../shared/widgets/sheet.dart';
import 'board_screen.dart';
import 'work_icons.dart';
import 'work_widgets.dart';

/// Replace a dead board: pick the new one (from stock, or one that just came online in this home),
/// check the pin plan (same pin numbers on the new board), say where the old one goes, confirm. Every
/// device and wall button moves over with its timers, scenes, rules and history.
Future<SwapResult?> showReplaceSheet(BuildContext context, {required String homeId, required BoardNode node}) =>
    showSbSheet<SwapResult>(
      context,
      builder: (_) => _ReplaceSheet(homeId: homeId, node: node),
    );

class _ReplaceSheet extends ConsumerStatefulWidget {
  const _ReplaceSheet({required this.homeId, required this.node});
  final String homeId;
  final BoardNode node;

  @override
  ConsumerState<_ReplaceSheet> createState() => _ReplaceSheetState();
}

class _ReplaceSheetState extends ConsumerState<_ReplaceSheet> {
  List<SwapCandidate>? _list;
  String? _error, _loadError;
  String? _pick;
  bool _toStock = false;
  bool _busy = false;
  SwapResult? _done;
  final _note = TextEditingController();
  final _search = TextEditingController();

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _note.dispose();
    _search.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final list = await ref.read(workRepositoryProvider).replacements(widget.homeId, widget.node.id);
      if (mounted) {
        setState(() {
          _list = list;
          _loadError = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _loadError = messageOf(e));
    }
  }

  Future<void> _replace(SwapCandidate chosen) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final r = await ref
          .read(workRepositoryProvider)
          .replace(widget.homeId, widget.node.id, newId: chosen.id, backToStock: _toStock, note: _note.text);
      setState(() => _done = r);
    } catch (e) {
      setState(() => _error = messageOf(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final node = widget.node;
    final done = _done;
    if (done != null) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const SheetTitle('Board replaced'),
          const SizedBox(height: 12),
          Note(
            tone: NoteTone.ok,
            icon: SbIcons.check,
            child: Text(
              '${done.newId} now runs ${node.name}: ${Fmt.plural(done.devices, 'device')} and ${Fmt.plural(done.inputs, 'wall button')}, with their timers, scenes and rules.',
            ),
          ),
          const SizedBox(height: 10),
          Text(
            'The old board ${done.oldId} is ${done.oldStatus == 'STOCK' ? 'back in stock' : 'on the faulty shelf'}.',
            style: TextStyle(fontSize: 14.5, color: c.tx),
          ),
          for (final w in done.warnings)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Note(tone: NoteTone.warn, icon: SbIcons.warning, child: Text(w)),
            ),
          const SizedBox(height: 8),
          Text(
            'Wire it the same way: every wire goes on the same pin of the new board.',
            style: TextStyle(fontSize: 13.5, color: c.mu),
          ),
          const SizedBox(height: 16),
          BigButton(label: 'Open the new board', onTap: () => Navigator.of(context).pop(done)),
        ],
      );
    }

    final term = _search.text.trim().toLowerCase();
    final list = (_list ?? const <SwapCandidate>[])
        .where((x) => term.isEmpty || x.id.toLowerCase().contains(term))
        .toList();
    final chosen = _list?.where((x) => x.id == _pick).firstOrNull;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SheetTitle(
          'Replace ${node.name}',
          subtitle: 'Its devices and wall buttons move to the new board, on the same pins.',
        ),
        const SizedBox(height: 14),
        Text(
          '1 · The new board',
          style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, letterSpacing: .3, color: c.mu),
        ),
        const SizedBox(height: 4),
        Text(
          'Power it and connect it to the home’s Wi-Fi first: it shows as online. Boards in stock and boards assigned to this home are listed.',
          style: TextStyle(fontSize: 13.5, color: c.mu, height: 1.4),
        ),
        const SizedBox(height: 10),
        if (_loadError != null)
          ErrorView(error: _loadError!, onRetry: _load)
        else if (_list == null)
          const LoadingView(label: 'Finding boards…')
        else ...[
          if ((_list?.length ?? 0) > 6) ...[
            TextField(
              controller: _search,
              onChanged: (_) => setState(() {}),
              decoration: const InputDecoration(hintText: 'Board ID'),
            ),
            const SizedBox(height: 8),
          ],
          if (list.isEmpty)
            const EmptyView(
              icon: WorkIcons.package,
              title: 'No board in stock',
              text: 'Ask the office to add the new board to stock by its ID; then it shows here.',
            )
          else
            for (final x in list.take(30))
              Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: _Candidate(c: x, picked: x.id == _pick, onTap: () => setState(() => _pick = x.id)),
              ),
        ],
        if (chosen != null) ...[
          const SizedBox(height: 14),
          Text(
            '2 · Pin plan',
            style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, letterSpacing: .3, color: c.mu),
          ),
          const SizedBox(height: 4),
          Text('Move each wire to the same pin on the new board.', style: TextStyle(fontSize: 13.5, color: c.mu)),
          const SizedBox(height: 8),
          if (chosen.plan.isEmpty)
            Text(
              'Nothing is wired to the old board: the new one just takes its place.',
              style: TextStyle(fontSize: 14, color: c.tx),
            )
          else
            GroupCard(
              children: [
                for (final r in chosen.plan)
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text.rich(
                          TextSpan(
                            children: [
                              TextSpan(
                                text: r.name,
                                style: const TextStyle(fontWeight: FontWeight.w600),
                              ),
                              if (r.what.isNotEmpty)
                                TextSpan(
                                  text: ' · ${r.what}',
                                  style: TextStyle(color: c.mu),
                                ),
                            ],
                          ),
                          style: TextStyle(fontSize: 14, color: c.tx),
                        ),
                        const SizedBox(height: 3),
                        Row(
                          children: [
                            Text(
                              r.from,
                              style: TextStyle(fontFamily: SbFonts.mono, fontSize: 12.5, color: c.tx),
                            ),
                            Padding(
                              padding: const EdgeInsets.symmetric(horizontal: 6),
                              child: SbIcon(SbIcons.arrowRight, size: 13, color: c.mu),
                            ),
                            Expanded(
                              child: Text(
                                r.problem ?? r.to,
                                style: TextStyle(
                                  fontFamily: r.problem == null ? SbFonts.mono : null,
                                  fontSize: 12.5,
                                  color: r.problem == null ? c.okText : c.badText,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
              ],
            ),
          if (!chosen.fits)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Note(
                tone: NoteTone.bad,
                icon: SbIcons.warning,
                child: Text('This board can’t take over: ${chosen.problems.join(' ')}'),
              ),
            ),
          for (final w in chosen.warnings)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Note(tone: NoteTone.warn, icon: SbIcons.warning, child: Text(w)),
            ),
          const SizedBox(height: 14),
          Text(
            '3 · The old board',
            style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, letterSpacing: .3, color: c.mu),
          ),
          const SizedBox(height: 8),
          Segmented<bool>(
            options: const [(false, 'Broken: faulty shelf'), (true, 'Fine: back to stock')],
            value: _toStock,
            onChanged: (v) => setState(() => _toStock = v),
          ),
          if (!_toStock) ...[
            const SizedBox(height: 8),
            TextField(
              controller: _note,
              maxLength: 300,
              decoration: InputDecoration(
                hintText: node.note != null && node.note != 'Marked faulty'
                    ? node.note
                    : 'What’s wrong with it? (optional)',
                counterText: '',
              ),
            ),
          ],
        ],
        errorNote(_error),
        const SizedBox(height: 16),
        BigButton(
          label: chosen == null ? 'Pick the new board' : 'Replace with ${chosen.id}',
          icon: WorkIcons.swap,
          busy: _busy,
          onTap: chosen != null && chosen.fits ? () => _replace(chosen) : null,
        ),
      ],
    );
  }
}

class _Candidate extends StatelessWidget {
  const _Candidate({required this.c, required this.picked, required this.onTap});
  final SwapCandidate c;
  final bool picked;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final s = context.sb;
    return Pressable(
      scale: .98,
      selected: picked,
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: picked ? s.onSoft : s.sf2,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: picked ? s.on : Colors.transparent),
        ),
        child: Row(
          children: [
            ToneDot(c.online ? Tone.ok : Tone.mute),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    c.id,
                    style: TextStyle(
                      fontFamily: SbFonts.mono,
                      fontSize: 14.5,
                      fontWeight: FontWeight.w500,
                      color: s.tx,
                    ),
                  ),
                  Text(
                    '${c.boardName} · ${c.online
                        ? 'online now'
                        : c.lastSeenAt != null
                        ? 'seen ${Fmt.ago(c.lastSeenAt!).toLowerCase()}'
                        : 'never connected'}${c.firmware != null ? ' · ${c.firmware}' : ''}',
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(fontSize: 12.5, color: s.mu),
                  ),
                ],
              ),
            ),
            if (c.status == 'ASSIGNED')
              const Padding(padding: EdgeInsets.only(left: 6), child: ToneBadge('For this home', Tone.info)),
            if (!c.fits) const Padding(padding: EdgeInsets.only(left: 6), child: ToneBadge('Pins don’t fit', Tone.bad)),
            if (picked && c.fits)
              Padding(
                padding: const EdgeInsets.only(left: 6),
                child: SbIcon(SbIcons.check, size: 17, color: s.onText, weight: IconWeight.bold),
              ),
          ],
        ),
      ),
    );
  }
}

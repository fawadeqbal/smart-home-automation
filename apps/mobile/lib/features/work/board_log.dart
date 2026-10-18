import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../core/network/api_exception.dart';
import '../../core/theme/app_theme.dart';
import '../../core/theme/sb_colors.dart';
import '../../data/models/json.dart';
import '../../data/models/work/board.dart';
import '../../data/repositories/work_repository.dart';
import '../../shared/widgets/sb_chip.dart';
import '../../state/toast.dart';
import '../../state/work.dart';
import 'work_widgets.dart';

/// What the board is doing right now: every line it prints arrives here live (no USB cable needed),
/// with what the server did ("Sent configuration rev 8", "Ceiling light confirmed").
class BoardLog extends ConsumerStatefulWidget {
  const BoardLog({super.key, required this.homeId, required this.node});
  final String homeId;
  final BoardNode node;

  @override
  ConsumerState<BoardLog> createState() => _BoardLogState();
}

class _BoardLogState extends ConsumerState<BoardLog> {
  static const _max = 400;
  final _lines = <LogLine>[];
  final _held = <LogLine>[];
  StreamSubscription<Object?>? _sub;
  bool _loading = true;
  String? _error;
  bool _paused = false;
  bool _boardOnly = false;
  String _min = 'info';

  @override
  void initState() {
    super.initState();
    unawaited(_load());
    _sub = ref.read(workLiveProvider(widget.homeId)).on('node.log').listen((e) {
      if (str(e.map['nodeId']) != widget.node.id) return;
      final line = LogLine.fromJson(asJson(e.map['entry']));
      if (!mounted) return;
      if (_paused) {
        _held.add(line);
        setState(() {});
      } else {
        setState(() => _add([line]));
      }
    });
  }

  void _add(List<LogLine> more) {
    _lines.addAll(more);
    if (_lines.length > _max) _lines.removeRange(0, _lines.length - _max);
  }

  Future<void> _load() async {
    try {
      final lines = await ref.read(workRepositoryProvider).logs(widget.homeId, widget.node.id);
      if (!mounted) return;
      setState(() {
        _lines
          ..clear()
          ..addAll(lines);
        _loading = false;
      });
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = ApiException.from(e).message;
          _loading = false;
        });
      }
    }
  }

  @override
  void dispose() {
    unawaited(_sub?.cancel());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // keep the board's live connection open while the log shows
    ref.watch(workLiveProvider(widget.homeId));
    final c = context.sb;
    final shown = _lines
        .where((l) => l.atLeast(_min) && (!_boardOnly || l.source == 'board'))
        .toList()
        .reversed
        .toList();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            ToneDot(widget.node.online ? Tone.ok : Tone.mute, size: 9),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                widget.node.online
                    ? (_paused ? 'Paused · ${_held.length} new' : 'Live · newest first')
                    : 'Board offline: new lines arrive when it reconnects',
                style: TextStyle(fontSize: 13.5, color: c.mu),
              ),
            ),
          ],
        ),
        const SizedBox(height: 10),
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Row(
            children: [
              for (final (v, label) in const [('debug', 'All'), ('info', 'Info+'), ('warn', 'Problems')])
                Padding(
                  padding: const EdgeInsets.only(right: 6),
                  child: SbChip(label: label, height: 32, selected: _min == v, onTap: () => setState(() => _min = v)),
                ),
              Padding(
                padding: const EdgeInsets.only(right: 6),
                child: SbChip(
                  label: 'Board only',
                  height: 32,
                  tone: ChipTone.blue,
                  selected: _boardOnly,
                  onTap: () => setState(() => _boardOnly = !_boardOnly),
                ),
              ),
              Padding(
                padding: const EdgeInsets.only(right: 6),
                child: SbChip(
                  label: _paused ? 'Resume' : 'Pause',
                  height: 32,
                  tone: ChipTone.amber,
                  selected: _paused,
                  onTap: () => setState(() {
                    _paused = !_paused;
                    if (!_paused) {
                      _add(_held);
                      _held.clear();
                    }
                  }),
                ),
              ),
              Padding(
                padding: const EdgeInsets.only(right: 6),
                child: SbChip(
                  label: 'Copy',
                  height: 32,
                  selected: false,
                  onTap: () async {
                    await Clipboard.setData(
                      ClipboardData(
                        text: shown.reversed
                            .map((l) => '${l.at.toIso8601String()} ${l.source} ${l.level} ${l.msg}')
                            .join('\n'),
                      ),
                    );
                    ref.read(toastProvider.notifier).show('Log copied');
                  },
                ),
              ),
              SbChip(label: 'Clear', height: 32, selected: false, onTap: () => setState(_lines.clear)),
            ],
          ),
        ),
        const SizedBox(height: 10),
        Container(
          constraints: const BoxConstraints(minHeight: 160),
          padding: const EdgeInsets.symmetric(vertical: 6),
          decoration: BoxDecoration(color: const Color(0xFF0F1318), borderRadius: BorderRadius.circular(18)),
          child: _loading
              ? const Padding(
                  padding: EdgeInsets.all(30),
                  child: Center(child: CircularProgressIndicator(strokeWidth: 2)),
                )
              : shown.isEmpty
              ? Padding(
                  padding: const EdgeInsets.all(24),
                  child: Text(
                    _error ??
                        (_lines.isEmpty
                            ? 'Nothing yet. Switch something and it shows up here.'
                            : 'Nothing to show with these filters.'),
                    textAlign: TextAlign.center,
                    style: const TextStyle(fontSize: 13.5, color: Color(0xFF9AA3AE)),
                  ),
                )
              : Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [for (final l in shown.take(200)) _Line(line: l)],
                ),
        ),
        const SizedBox(height: 8),
        Text(
          '“board” lines come from the board; “server” lines are what the app did.',
          style: TextStyle(fontSize: 12.5, color: c.mu),
        ),
      ],
    );
  }
}

class _Line extends StatelessWidget {
  const _Line({required this.line});
  final LogLine line;

  @override
  Widget build(BuildContext context) {
    final color = switch (line.level) {
      'error' => const Color(0xFFFF8A8F),
      'warn' => const Color(0xFFF7C46A),
      'debug' => const Color(0xFF7D8590),
      _ => const Color(0xFFE6E8EB),
    };
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            DateFormat('HH:mm:ss').format(line.at),
            style: const TextStyle(fontFamily: SbFonts.mono, fontSize: 11, color: Color(0xFF7D8590)),
          ),
          const SizedBox(width: 8),
          Container(
            width: 44,
            padding: const EdgeInsets.symmetric(vertical: 1),
            decoration: BoxDecoration(
              color: line.source == 'board' ? const Color(0xFF1F3A5F) : const Color(0xFF3A2E14),
              borderRadius: BorderRadius.circular(4),
            ),
            alignment: Alignment.center,
            child: Text(
              line.source,
              style: TextStyle(
                fontFamily: SbFonts.mono,
                fontSize: 10,
                color: line.source == 'board' ? const Color(0xFFA6C8FF) : const Color(0xFFF7C46A),
              ),
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              line.msg,
              style: TextStyle(fontFamily: SbFonts.mono, fontSize: 11.5, color: color, height: 1.35),
            ),
          ),
        ],
      ),
    );
  }
}

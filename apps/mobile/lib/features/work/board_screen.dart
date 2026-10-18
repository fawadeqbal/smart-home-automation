import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/network/api_exception.dart';
import '../../core/theme/app_theme.dart';
import '../../core/theme/sb_colors.dart';
import '../../core/theme/sb_icons.dart';
import '../../core/util/format.dart';
import '../../data/models/work/board.dart';
import '../../data/models/work/pins.dart';
import '../../data/repositories/work_repository.dart';
import '../../shared/widgets/common.dart';
import '../../shared/widgets/sb_chip.dart';
import '../../state/toast.dart';
import '../../state/work.dart';
import 'board_devices.dart';
import 'board_firmware.dart';
import 'board_log.dart';
import 'pin_map.dart';
import 'replace_sheet.dart';
import 'work_icons.dart';
import 'work_widgets.dart';

enum BoardTab { overview, devices, pins, log, firmware }

/// One board on site: is it OK, what's wired to it (add, change, remove), the pin map, its live log,
/// firmware updates, and replacing it when it's dead. Support sees it all read-only.
class BoardScreen extends ConsumerStatefulWidget {
  const BoardScreen({super.key, required this.homeId, required this.nodeId, this.tab});
  final String homeId, nodeId;

  /// The section to open first (`?tab=devices`, like the web console's board page).
  final String? tab;

  @override
  ConsumerState<BoardScreen> createState() => _BoardScreenState();
}

class _BoardScreenState extends ConsumerState<BoardScreen> {
  late BoardTab _tab = BoardTab.values.where((t) => t.name == widget.tab).firstOrNull ?? BoardTab.overview;
  String? _note;

  ({String homeId, String nodeId}) get _key => (homeId: widget.homeId, nodeId: widget.nodeId);

  @override
  void didUpdateWidget(BoardScreen old) {
    super.didUpdateWidget(old);
    // opened again with another ?tab=
    final t = BoardTab.values.where((t) => t.name == widget.tab).firstOrNull;
    if (widget.tab != old.tab && t != null) _tab = t;
  }

  Future<void> _run(Future<void> Function() action, {String? done}) async {
    try {
      await action();
      if (done != null) ref.read(toastProvider.notifier).show(done);
      await ref.read(workNodesProvider(widget.homeId).notifier).refresh();
    } catch (e) {
      toastError(ref, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final nodes = ref.watch(workNodesProvider(widget.homeId));
    final node = ref.watch(workNodeProvider(_key));
    final ws = ref.watch(workspaceProvider(widget.homeId)).value;
    final catalog = ref.watch(catalogProvider).value;
    final rights = ref.watch(workRightsProvider);
    // an update keeps going (and showing its progress) while you look at the other tabs
    final job = ref.watch(firmwareJobProvider(_key));
    if (node == null || catalog == null) {
      return WorkPage(
        children: [
          if (nodes.hasError)
            ErrorView(error: nodes.error!, onRetry: () => ref.invalidate(workNodesProvider(widget.homeId)))
          else if (nodes.hasValue && catalog != null)
            const EmptyView(
              icon: WorkIcons.cpu,
              title: 'This board isn’t in this home any more',
              text: 'It may have been replaced or sent back to stock.',
            )
          else
            const LoadingView(label: 'Opening the board…'),
        ],
      );
    }
    final canSetup = (rights?.canSetup(ws?.installerId) ?? false) && ws != null;
    final cond = BoardCondition.of(node);
    final tone = toneColors(context, cond.tone);
    final stuck = node.waiting || !node.online;
    final behind = isBehind(node.firmware, ws?.currentFirmware);
    final tabs = [
      (BoardTab.overview, 'Overview'),
      (BoardTab.devices, 'Devices ${node.devices.length + node.inputs.length}'),
      (BoardTab.pins, 'Pin map'),
      (BoardTab.log, 'Live log'),
      if (canSetup)
        (
          BoardTab.firmware,
          job?.running ?? false
              ? 'Firmware · updating'
              : behind
              ? 'Firmware · update'
              : 'Firmware',
        ),
    ];

    return WorkPage(
      onRefresh: () => ref.read(workNodesProvider(widget.homeId).notifier).refresh(),
      children: [
        Text('BOARD · ${catalog.modelName(node.board).toUpperCase()}', style: SbText.mono.copyWith(color: c.mu)),
        const SizedBox(height: 6),
        Row(
          children: [
            ToneDot(cond.tone, size: 13),
            const SizedBox(width: 10),
            Expanded(
              child: Text(node.name, style: SbText.title.copyWith(color: c.tx)),
            ),
            if (canSetup)
              RoundButton(icon: WorkIcons.dots, label: 'More board actions', onTap: () => _more(node, catalog)),
          ],
        ),
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          runSpacing: 6,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            ToneBadge(cond.label, cond.tone),
            Text(
              node.id,
              style: TextStyle(fontFamily: SbFonts.mono, fontSize: 12.5, color: c.mu),
            ),
            Text(
              node.online
                  ? 'active ${_ago(node.lastSeenAt)}'
                  : node.lastSeenAt != null
                  ? 'last seen ${_ago(node.lastSeenAt)}'
                  : 'never connected',
              style: TextStyle(fontSize: 12.5, color: c.mu),
            ),
          ],
        ),
        if (!canSetup) ...[const SizedBox(height: 12), const ReadOnlyBar()],
        if (stuck) ...[
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: node.waiting ? c.badSoft : c.onSoft,
              borderRadius: BorderRadius.circular(16),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  node.waiting ? 'This board is marked faulty' : 'This board is offline',
                  style: TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w600,
                    color: node.waiting ? c.badText : c.onText,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  node.waiting
                      ? '${node.note != null && node.note != 'Marked faulty' ? '${node.note}. ' : ''}Its ${Fmt.plural(node.devices.length, 'device')} and their timers, scenes and rules are kept, waiting for a replacement board.'
                      : 'Last seen ${_ago(node.lastSeenAt)}. If it’s dead, replace it: its devices move to the new board, on the same pins, with their timers, scenes and rules.',
                  style: TextStyle(fontSize: 13.5, height: 1.4, color: c.tx),
                ),
                if (canSetup) ...[
                  const SizedBox(height: 10),
                  BigButton(label: 'Replace this board', icon: WorkIcons.swap, height: 46, onTap: () => _replace(node)),
                ],
              ],
            ),
          ),
        ],
        if (_note != null) ...[
          const SizedBox(height: 12),
          Note(tone: NoteTone.info, icon: WorkIcons.info, child: Text(_note!)),
        ],
        const SizedBox(height: 14),
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Row(
            children: [
              for (final (t, label) in tabs)
                Padding(
                  padding: const EdgeInsets.only(right: 6),
                  child: SbChip(
                    label: label,
                    height: 34,
                    selected: _tab == t,
                    tone: ChipTone.ink,
                    onTap: () => setState(() => _tab = t),
                  ),
                ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        switch (_tab) {
          BoardTab.overview => _Overview(
            node: node,
            catalog: catalog,
            canSetup: canSetup,
            latest: ws?.currentFirmware,
            tone: tone.fg,
            onRestart: () async {
              setState(() => _note = null);
              try {
                await ref.read(workRepositoryProvider).reboot(widget.homeId, node.id);
                setState(() => _note = 'Restart sent — the board is back in about 5 seconds.');
              } catch (e) {
                toastError(ref, e);
              }
            },
            onTab: (t) => setState(() => _tab = t),
            onNewLogin: () => _newLogin(node),
          ),
          BoardTab.devices => BoardDevices(homeId: widget.homeId, node: node, catalog: catalog, canSetup: canSetup),
          BoardTab.pins => PinMap(node: node, catalog: catalog),
          BoardTab.log => BoardLog(homeId: widget.homeId, node: node),
          BoardTab.firmware => BoardFirmware(homeId: widget.homeId, node: node, latest: ws?.currentFirmware),
        },
      ],
    );
  }

  Future<void> _replace(BoardNode node) async {
    final r = await showReplaceSheet(context, homeId: widget.homeId, node: node);
    if (r == null || !mounted) return;
    ref.invalidate(workspaceProvider(widget.homeId));
    await ref.read(workNodesProvider(widget.homeId).notifier).refresh();
    if (!mounted) return;
    // the new board carries on under this one's name: open it
    final path = GoRouterState.of(context).uri.path;
    context.go(path.replaceFirst(RegExp(r'/board/[^/]+$'), '/board/${Uri.encodeComponent(r.newId)}'));
  }

  Future<void> _newLogin(BoardNode node) async {
    final ok = await confirmSheet(
      context,
      title: 'Give this board a new login?',
      body: 'The old server login stops working. The board gets the new one now if it’s online, or when it next connects. Do this after its chip was erased or replaced.',
      yes: 'New login',
      danger: false,
    );
    if (ok) {
      await _run(
        () => ref.read(workRepositoryProvider).resetLogin(widget.homeId, node.id),
        done: 'New login made for ${node.name}',
      );
    }
  }

  Future<void> _more(BoardNode node, Catalog catalog) async {
    final repo = ref.read(workRepositoryProvider);
    final pick = await pickOne<String>(
      context,
      title: node.name,
      options: [
        ('rename', 'Rename'),
        ('model', 'Change board model'),
        ('replace', 'Replace this board'),
        if (node.mqttLogin != null) ('login', 'Give it a new server login'),
        node.waiting ? ('working', 'It works again') : ('faulty', 'Mark faulty'),
        ('remove', 'Remove from this home'),
      ],
    );
    if (pick == null || !mounted) return;
    switch (pick.$1) {
      case 'rename':
        final name = await askText(
          context,
          title: 'Rename board',
          hint: 'Living room',
          initial: node.name,
          note: 'Name it after where it is — the owner sees this name.',
        );
        if (name != null && name.isNotEmpty) {
          await _run(() => repo.updateNode(widget.homeId, node.id, name: name), done: 'Renamed');
        }
      case 'model':
        final m = await pickOne<String>(
          context,
          title: 'Board model',
          subtitle: 'Pick the one that looks like the board in your hand, so the pin map matches its printing. The pins work the same.',
          value: node.board,
          options: [for (final b in catalog.boards) (b.type, b.name)],
        );
        if (m != null && m.$1 != node.board) {
          await _run(() => repo.updateNode(widget.homeId, node.id, board: m.$1), done: 'Model changed');
        }
      case 'replace':
        await _replace(node);
      case 'login':
        await _newLogin(node);
      case 'working':
        await _run(() => repo.markWorking(widget.homeId, node.id), done: '${node.name} is back in service');
      case 'faulty':
        final why = await askText(
          context,
          title: 'Mark ${node.name} faulty?',
          hint: 'Relay on D1 stuck on',
          note: 'It stops running its devices. They stay in the app, with their timers, scenes and rules, waiting for a replacement board.',
          yes: 'Mark faulty',
          optional: true,
        );
        if (why != null) await _run(() => repo.markFaulty(widget.homeId, node.id, why), done: 'Marked faulty');
      case 'remove':
        if (!mounted) return;
        final ok = await confirmSheet(
          context,
          title: 'Remove ${node.name} from this home?',
          body:
              'Its ${Fmt.plural(node.devices.length, 'device')} and ${Fmt.plural(node.inputs.length, 'wall button')} are deleted and the board goes back to stock, ready to be assigned again.',
          yes: 'Remove board',
        );
        if (!ok) return;
        try {
          await repo.removeNode(widget.homeId, node.id);
          ref.invalidate(workspaceProvider(widget.homeId));
          ref.read(toastProvider.notifier).show('${node.name} is back in stock');
          if (mounted) context.pop();
        } catch (e) {
          toastError(ref, e);
        }
    }
  }
}

class _Overview extends ConsumerWidget {
  const _Overview({
    required this.node,
    required this.catalog,
    required this.canSetup,
    required this.latest,
    required this.tone,
    required this.onRestart,
    required this.onTab,
    required this.onNewLogin,
  });
  final BoardNode node;
  final Catalog catalog;
  final bool canSetup;
  final String? latest;
  final Color tone;
  final VoidCallback onRestart, onNewLogin;
  final ValueChanged<BoardTab> onTab;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.sb;
    final cond = BoardCondition.of(node);
    final h = node.health;
    final sig = signalOf(node.signal);
    final stats = pinStats(node, catalog);
    final behind = isBehind(node.firmware, latest);
    final sync = node.sync;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        WorkCard(
          color: toneColors(context, cond.tone).bg,
          border: Colors.transparent,
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Padding(padding: const EdgeInsets.only(top: 4), child: ToneDot(cond.tone, size: 16)),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      cond.label,
                      style: TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w600,
                        color: toneColors(context, cond.tone).fg,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(cond.detail, style: TextStyle(fontSize: 13.5, color: c.tx, height: 1.4)),
                  ],
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            Expanded(
              child: _Stat(
                label: 'Wi-Fi signal',
                value: sig.text.split(' (').first,
                sub: node.signal == null ? '—' : '${node.signal} dBm',
                bars: sig.bars,
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: _Stat(
                label: 'Supply',
                value: h?.vcc == null ? '—' : '${(h!.vcc! / 1000).toStringAsFixed(2)} V',
                sub: h?.vcc == null
                    ? 'not measured'
                    : h!.vcc! < 3000
                    ? 'too low'
                    : 'good (3.0–3.6 V)',
                warn: (h?.vcc ?? 3300) < 3000,
              ),
            ),
          ],
        ),
        const SizedBox(height: 10),
        Row(
          children: [
            Expanded(
              child: _Stat(label: 'Pins', value: '${stats.used} in use', sub: '${stats.free} free'),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: _Stat(label: 'Up for', value: uptimeText(h?.uptime), sub: h?.reset ?? 'last restart unknown'),
            ),
          ],
        ),
        if (canSetup) ...[
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: BigButton(
                  label: 'Restart',
                  icon: WorkIcons.restart,
                  height: 48,
                  color: c.sf2,
                  foreground: c.tx,
                  onTap: node.online ? onRestart : null,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: BigButton(
                  label: 'Devices',
                  icon: SbIcons.lightbulb,
                  height: 48,
                  onTap: () => onTab(BoardTab.devices),
                ),
              ),
            ],
          ),
        ],
        const GroupLabel('Board details'),
        WorkCard(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
          child: Column(
            children: [
              FactRow('Model', catalog.modelName(node.board)),
              FactRow('Board ID', node.id, mono: true),
              if (node.mac != null) FactRow('MAC address', node.mac!, mono: true),
              FactRow('IP address', node.ip ?? '—', mono: true),
              FactRow('Wi-Fi', [if (h?.ssid != null) h!.ssid!, sig.text].join(' · ')),
              FactRow(
                'Firmware',
                node.firmware ?? '—',
                trailing: behind
                    ? GestureDetector(
                        onTap: canSetup ? () => onTab(BoardTab.firmware) : null,
                        child: ToneBadge('$latest available', Tone.warn, icon: WorkIcons.arrowUp),
                      )
                    : null,
              ),
              FactRow(
                'Settings',
                switch (sync) {
                  SettingsSync.saved => 'Saved on the board (v${node.appliedRev})',
                  SettingsSync.saving =>
                    node.online
                        ? 'Saving to the board… (v${node.appliedRev} of ${node.configRev})'
                        : 'Will update when it’s online',
                  SettingsSync.refused => 'Refused: ${node.configError}',
                },
                trailing: ToneDot(switch (sync) {
                  SettingsSync.saved => Tone.ok,
                  SettingsSync.saving => Tone.warn,
                  SettingsSync.refused => Tone.bad,
                }),
              ),
              if (node.mqttLogin != null || node.mqttLoginProblem)
                FactRow(
                  'Server login',
                  node.mqttLoginProblem
                      ? 'Came back without its own login — normal after its chip was erased or replaced. If not, someone may be using its ID.'
                      : node.mqttLogin == 'own'
                      ? 'Its own${node.mqttLoginSince != null ? ' since ${Fmt.day(node.mqttLoginSince!)}' : ''}'
                      : 'Shared board login${node.firmware != null && compareVersions(node.firmware!, '2.6.0') < 0 ? ' — firmware 2.6.0 gives it its own' : ''}',
                  trailing: node.mqttLoginProblem && canSetup
                      ? GestureDetector(onTap: onNewLogin, child: const ToneBadge('New login', Tone.info))
                      : null,
                ),
              FactRow(
                'Last report',
                node.lastSeenAt == null
                    ? 'never'
                    : '${Fmt.when(node.lastSeenAt!)} · ${Fmt.ago(node.lastSeenAt!).toLowerCase()}',
              ),
              if (h?.heap != null) FactRow('Free memory', '${(h!.heap! / 1024).round()} KB'),
              if (h?.connects != null)
                FactRow(
                  'Connections',
                  '${h!.connects} since start${h.connects! > 1 ? ' (dropped ${h.connects! - 1}×)' : ''}',
                ),
            ],
          ),
        ),
      ],
    );
  }
}

class _Stat extends StatelessWidget {
  const _Stat({required this.label, required this.value, required this.sub, this.bars, this.warn = false});
  final String label, value, sub;
  final int? bars;
  final bool warn;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    return WorkCard(
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  label,
                  style: TextStyle(fontSize: 12.5, color: c.mu, fontWeight: FontWeight.w500),
                ),
              ),
              if (bars != null) _Bars(bars: bars!),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(fontSize: 17, fontWeight: FontWeight.w600, color: warn ? c.onText : c.tx),
          ),
          Text(
            sub,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(fontSize: 12.5, color: c.mu),
          ),
        ],
      ),
    );
  }
}

class _Bars extends StatelessWidget {
  const _Bars({required this.bars});
  final int bars;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final color = bars >= 3
        ? c.ok
        : bars == 2
        ? c.on
        : c.bad;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        for (var i = 0; i < 4; i++)
          Container(
            width: 4,
            height: 5.0 + i * 3,
            margin: const EdgeInsets.only(left: 2),
            decoration: BoxDecoration(color: i < bars ? color : c.sf3, borderRadius: BorderRadius.circular(1)),
          ),
      ],
    );
  }
}

/// Keeps the board list of a home fresh while one of its pages is open (used by the sheets).
void refreshBoards(WidgetRef ref, String homeId) {
  ref.invalidate(workspaceProvider(homeId));
  unawaited(ref.read(workNodesProvider(homeId).notifier).refresh());
}

/// Shown under forms when the API said no.
Widget errorNote(String? error) => error == null
    ? const SizedBox.shrink()
    : Padding(
        padding: const EdgeInsets.only(top: 12),
        child: Note(tone: NoteTone.bad, icon: SbIcons.warning, child: Text(error)),
      );

/// The message of an error, for forms.
String messageOf(Object e) => ApiException.from(e).message;

/// "just now", "4 min ago", "yesterday 20:52" (lower case, inside a sentence).
String _ago(DateTime? t) {
  if (t == null) return 'never';
  final a = Fmt.ago(t);
  return a == 'Now' ? 'just now' : a.toLowerCase();
}

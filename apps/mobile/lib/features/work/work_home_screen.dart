import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_exception.dart';
import '../../core/theme/app_theme.dart';
import '../../core/theme/sb_colors.dart';
import '../../core/theme/sb_icons.dart';
import '../../core/util/format.dart';
import '../../data/models/session.dart';
import '../../data/models/work/board.dart';
import '../../data/models/work/homes.dart';
import '../../data/repositories/work_repository.dart';
import '../../shared/widgets/common.dart';
import '../../shared/widgets/sheet.dart';
import '../../state/session.dart';
import '../../state/work.dart';
import 'work_icons.dart';
import 'work_routes.dart';
import 'work_shell.dart';
import 'work_widgets.dart';

/// A customer's home as the team sees it: new boards to install, its boards, the installation
/// report, the customer to call, open tickets, and the home app "as the customer sees it".
class WorkHomeScreen extends ConsumerWidget {
  const WorkHomeScreen({super.key, required this.homeId});
  final String homeId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.sb;
    final ws = ref.watch(workspaceProvider(homeId));
    final rights = ref.watch(workRightsProvider);
    final w = ws.value;
    if (w == null) {
      return WorkPage(
        children: [
          if (ws.hasError)
            ErrorView(error: ws.error!, onRetry: () => ref.invalidate(workspaceProvider(homeId)))
          else
            const LoadingView(label: 'Opening the home…'),
        ],
      );
    }
    final canSetup = rights?.canSetup(w.installerId) ?? false;
    final tickets = ref.watch(homeTicketsProvider(homeId)).value ?? const [];

    return WorkPage(
      onRefresh: () async {
        ref.invalidate(homeTicketsProvider(homeId));
        ref.invalidate(workspaceProvider(homeId));
        await ref.read(workspaceProvider(homeId).future);
      },
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 52,
              height: 52,
              decoration: BoxDecoration(color: toneColors(context, w.tone).bg, borderRadius: BorderRadius.circular(16)),
              child: Center(
                child: SbIcon(
                  SbIcons.house,
                  size: 26,
                  color: toneColors(context, w.tone).fg,
                  weight: IconWeight.duotone,
                ),
              ),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(w.name, style: SbText.title.copyWith(color: c.tx)),
                  const SizedBox(height: 6),
                  ToneBadge(
                    w.status == 'setup'
                        ? 'Installing'
                        : w.status == 'live'
                        ? 'Live'
                        : w.statusLabel,
                    w.tone,
                  ),
                ],
              ),
            ),
          ],
        ),
        const SizedBox(height: 10),
        Text(
          [w.city.isEmpty ? 'No city' : w.city, 'Installer ${w.installer ?? '—'}'].join(' · '),
          style: TextStyle(fontSize: 14, color: c.mu),
        ),
        if (!canSetup) ...[
          const SizedBox(height: 12),
          ReadOnlyBar(
            text: rights?.readOnly ?? true
                ? 'Support can look at everything here; the installer changes it.'
                : 'Only the home’s installer or a super admin changes it.',
          ),
        ],
        const SizedBox(height: 14),
        BigButton(
          label: 'Open as the customer sees it',
          icon: WorkIcons.eye,
          height: 50,
          color: c.sf2,
          foreground: c.tx,
          onTap: () async {
            try {
              await openAsCustomer(context, ref, homeId);
            } catch (e) {
              toastError(ref, e);
            }
          },
        ),

        // ---- new boards
        if (w.readyToInstall.isNotEmpty || w.waitingForPower.isNotEmpty) ...[
          const GroupLabel('New boards'),
          for (final b in w.readyToInstall)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: _NewBoardCard(homeId: homeId, board: b, canSetup: canSetup),
            ),
          for (final b in w.waitingForPower)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: _NewBoardCard(homeId: homeId, board: b, canSetup: canSetup),
            ),
        ],

        // ---- boards
        GroupLabel(
          'Boards',
          trailing: Text('${w.installed.length}', style: TextStyle(fontSize: 13, color: c.mu)),
        ),
        if (w.installed.isEmpty)
          EmptyView(
            icon: WorkIcons.cpu,
            title: 'No boards installed yet',
            text: w.boards.isEmpty
                ? 'Boards come from the office’s stock. Once one is assigned to this home, power it on site and install it here.'
                : 'Power the new board and connect it to the home’s Wi-Fi: it shows above, ready to install.',
          )
        else
          GroupCard(
            children: [
              for (final b in w.installed)
                WorkRow(
                  icon: WorkIcons.cpu,
                  iconBg: toneColors(context, b.tone).bg,
                  iconFg: toneColors(context, b.tone).fg,
                  title: b.name,
                  subtitle:
                      '${b.condText} · ${Fmt.plural(b.devices, 'device')}${b.firmwareOld ? ' · update available' : ''}',
                  onTap: () => context.openWork(WorkRoutes.board(homeId, b.id)),
                ),
            ],
          ),

        // ---- installation
        const GroupLabel('Installation'),
        GroupCard(
          children: [
            WorkRow(
              icon: WorkIcons.checklist,
              iconBg: c.okSoft,
              iconFg: c.okText,
              title: 'Installation report',
              subtitle: 'Checklist, photos and the customer’s signature',
              onTap: () => context.openWork(WorkRoutes.install(homeId)),
            ),
            WorkRow(
              icon: WorkIcons.stack,
              title: 'Setup ${w.stepsDone} of 6',
              subtitle:
                  w.steps.where((s) => s.current).firstOrNull?.title ??
                  (w.stepsDone == 6 ? 'Everything is done' : null),
              trailing: SizedBox(
                width: 60,
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(99),
                  child: LinearProgressIndicator(
                    value: w.stepsDone / 6,
                    minHeight: 6,
                    backgroundColor: c.sf2,
                    color: c.ok,
                  ),
                ),
              ),
            ),
          ],
        ),

        // ---- customer
        const GroupLabel('Customer'),
        _CustomerCard(ws: w),

        // ---- tickets
        if (tickets.isNotEmpty) ...[
          GroupLabel(
            'Open tickets',
            trailing: Text('${tickets.length}', style: TextStyle(fontSize: 13, color: c.mu)),
          ),
          GroupCard(
            children: [
              for (final t in tickets)
                WorkRow(
                  icon: WorkIcons.ticket,
                  iconBg: toneColors(context, t.priority.tone).bg,
                  iconFg: toneColors(context, t.priority.tone).fg,
                  title: '#${t.number} · ${t.title}',
                  subtitle: '${t.state.label}${t.assignee != null ? ' · with ${t.assignee}' : ''}',
                  onTap: () => context.openWork(WorkRoutes.ticket(t.id)),
                ),
            ],
          ),
        ],
      ],
    );
  }
}

class _NewBoardCard extends ConsumerWidget {
  const _NewBoardCard({required this.homeId, required this.board, required this.canSetup});
  final String homeId;
  final WorkspaceBoard board;
  final bool canSetup;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.sb;
    final b = board;
    return WorkCard(
      color: b.online ? c.acSoft : null,
      border: b.online ? c.ac.withValues(alpha: .35) : null,
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              ToneDot(b.online ? Tone.ok : Tone.mute),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  b.id,
                  style: TextStyle(fontFamily: SbFonts.mono, fontSize: 15, fontWeight: FontWeight.w500, color: c.tx),
                ),
              ),
              Text(
                b.model.isEmpty ? b.board : b.model,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(fontSize: 12.5, color: c.mu),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            b.online
                ? 'Powered and online, ready to install. Name it after where it is — the owner sees this name.'
                : 'Waiting for power. Power the board and connect it to the home’s Wi-Fi; it shows as online here.',
            style: TextStyle(fontSize: 13.5, color: c.mu, height: 1.4),
          ),
          if (b.online && canSetup) ...[
            const SizedBox(height: 10),
            BigButton(
              label: 'Install this board',
              icon: WorkIcons.wrench,
              height: 48,
              onTap: () async {
                // installed: on to its page, to add what's wired to it
                if (await showAdoptSheet(context, homeId: homeId, board: b) == true && context.mounted) {
                  context.openWork('${WorkRoutes.board(homeId, b.id)}?tab=devices');
                }
              },
            ),
          ],
        ],
      ),
    );
  }
}

/// Install (adopt) a new board: where it is, and which model it is.
/// True when it was installed.
Future<bool?> showAdoptSheet(BuildContext context, {required String homeId, required WorkspaceBoard board}) =>
    showSbSheet<bool>(
      context,
      builder: (_) => _AdoptSheet(homeId: homeId, board: board),
    );

class _AdoptSheet extends ConsumerStatefulWidget {
  const _AdoptSheet({required this.homeId, required this.board});
  final String homeId;
  final WorkspaceBoard board;

  @override
  ConsumerState<_AdoptSheet> createState() => _AdoptSheetState();
}

class _AdoptSheetState extends ConsumerState<_AdoptSheet> {
  final _name = TextEditingController();
  late String _model = widget.board.board.isEmpty ? 'NODEMCU_V2' : widget.board.board;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final name = _name.text.trim();
    if (name.isEmpty) {
      setState(() => _error = 'Write where the board is, like “Living room” or “Kitchen DB”.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(workRepositoryProvider).adopt(widget.homeId, widget.board.id, name: name, board: _model);
      ref.invalidate(workspaceProvider(widget.homeId));
      ref.invalidate(workNodesProvider(widget.homeId));
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      setState(() => _error = ApiException.from(e).message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final catalog = ref.watch(catalogProvider).value;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SheetTitle(
          'Install board',
          subtitle: 'Board ${widget.board.id}. Name it after where it is — the owner sees this name.',
        ),
        const FieldLabel('Where is it?'),
        TextField(
          controller: _name,
          autofocus: true,
          maxLength: 60,
          textCapitalization: TextCapitalization.sentences,
          decoration: const InputDecoration(hintText: 'Living room', counterText: ''),
        ),
        const FieldLabel(
          'Model',
          hint: 'Pick the one that looks like the board in your hand, so the pin map matches its printing.',
        ),
        PickField<String>(
          title: 'Board model',
          value: _model,
          options: [for (final b in catalog?.boards ?? const <BoardModel>[]) (b.type, b.name)],
          onChanged: (v) => setState(() => _model = v),
        ),
        const SizedBox(height: 10),
        Text('Then add its lights, fans, sensors and wall switches.', style: TextStyle(fontSize: 13.5, color: c.mu)),
        if (_error != null) ...[
          const SizedBox(height: 12),
          Note(tone: NoteTone.bad, icon: SbIcons.warning, child: Text(_error!)),
        ],
        const SizedBox(height: 16),
        BigButton(label: 'Install', busy: _busy, onTap: _save),
      ],
    );
  }
}

class _CustomerCard extends ConsumerWidget {
  const _CustomerCard({required this.ws});
  final Workspace ws;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.sb;
    final o = ws.owner;
    final digits = whatsappDigits(o?.phone);
    final company = ref.watch(sessionProvider.select((s) => s.value?.staff?.orgName)) ?? 'your installer';
    return WorkCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Avatar(initialsOf(o?.name ?? ws.ownerInvite ?? '?'), size: 42),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      o?.name ?? ws.ownerInvite ?? 'No owner yet',
                      style: SbText.cardTitle.copyWith(fontSize: 16, color: c.tx),
                    ),
                    Text(
                      o != null
                          ? (o.phone ?? 'No mobile number saved')
                          : ws.ownerInvite != null
                          ? 'Invited, hasn’t joined yet'
                          : 'The owner is invited from the web console',
                      style: TextStyle(fontSize: 13.5, color: c.mu),
                    ),
                  ],
                ),
              ),
            ],
          ),
          if (o?.phone != null) ...[
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                PillButton(label: 'Call', icon: WorkIcons.phone, onTap: () => callNumber(ref, o!.phone!)),
                PillButton(
                  label: 'WhatsApp',
                  icon: WorkIcons.whatsapp,
                  green: true,
                  onTap: () => whatsApp(ref, digits, WorkMessages.hello(o!.name, company)),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

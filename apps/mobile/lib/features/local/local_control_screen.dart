import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/routing/routes.dart';
import '../../core/theme/sb_colors.dart';
import '../../core/theme/sb_icons.dart';
import '../../data/local/local_link.dart';
import '../../data/models/device.dart';
import '../../shared/widgets/common.dart';
import '../../shared/widgets/sb_switch.dart';
import '../../state/local_control.dart';
import '../../state/session.dart';
import '../devices/device_kinds.dart';

/// Switching the home straight on its boards, over the home's Wi‑Fi: for when the internet (or the
/// server) is down. Uses the passes the app saved the last time it was online.
class LocalControlScreen extends ConsumerWidget {
  const LocalControlScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.sb;
    final bundle = ref.watch(localBundleProvider);
    final view = ref.watch(localControlProvider);
    final signedIn = ref.watch(sessionProvider).value?.home != null;

    void back() {
      if (signedIn) {
        context.go(Routes.home);
      } else {
        ref.invalidate(sessionProvider); // try the server again
        context.go(Routes.splash);
      }
    }

    return Scaffold(
      body: RefreshIndicator(
        color: c.on,
        onRefresh: () => ref.refresh(localControlProvider.future),
        child: ListView(
          padding: EdgeInsets.fromLTRB(18, MediaQuery.paddingOf(context).top + 8, 18, 40),
          children: [
            BackPill(onTap: back),
            PageTitle(
              'Home Wi‑Fi control',
              subtitle: bundle == null ? null : '${bundle.homeName} · straight on your boards, no internet needed',
            ),
            const SizedBox(height: 16),
            const Note(
              tone: NoteTone.info,
              icon: SbIcons.wifiSlash,
              child: Text(
                'Works while this phone is on your home’s Wi‑Fi. Wall switches work as always. Timers, scenes, alerts and the assistant come back with the internet.',
              ),
            ),
            const SizedBox(height: 20),
            if (bundle == null || bundle.boards.isEmpty)
              const EmptyView(
                icon: SbIcons.wifiSlash,
                title: 'Nothing saved on this phone yet',
                text:
                    'Open the app once with internet. It then keeps what it needs to switch your home over Wi‑Fi.',
              )
            else
              ...switch (view) {
                AsyncData(:final value) => _rooms(context, ref, bundle, value),
                AsyncError(:final error) => [ErrorView(error: error, onRetry: () => ref.invalidate(localControlProvider))],
                _ => [const LoadingView(label: 'Finding your boards on the Wi‑Fi…')],
              },
            const SizedBox(height: 24),
            BigButton(label: signedIn ? 'Back to the app' : 'Try the internet again', icon: SbIcons.house, onTap: back),
          ],
        ),
      ),
    );
  }

  List<Widget> _rooms(BuildContext context, WidgetRef ref, LocalBundle bundle, LocalView view) {
    final rooms = <String, List<(LocalBoard, LocalDevice)>>{};
    for (final board in bundle.boards) {
      if (!board.ready || view.problems.containsKey(board.nodeId)) continue;
      for (final d in board.devices) {
        rooms.putIfAbsent(d.roomName ?? 'No room', () => []).add((board, d));
      }
    }
    return [
      for (final MapEntry(key: room, value: items) in rooms.entries) ...[
        SectionHeader(room),
        GroupCard(children: [for (final (b, d) in items) _DeviceRow(board: b, device: d, view: view)]),
        const SizedBox(height: 18),
      ],
      for (final board in bundle.boards)
        if (view.problems[board.nodeId] case final problem?)
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: Note(
              tone: NoteTone.warn,
              icon: SbIcons.warning,
              child: Text('${board.name}: $problem'),
            ),
          ),
      if (rooms.isEmpty && view.problems.isEmpty)
        const EmptyView(icon: SbIcons.wifiSlash, title: 'No devices you can reach here'),
      Padding(
        padding: const EdgeInsets.only(top: 6),
        child: Text(
          'Saved ${_ago(bundle.savedAt)}. Pull down to check again.',
          style: TextStyle(fontSize: 13, color: context.sb.mu),
        ),
      ),
    ];
  }

  static String _ago(DateTime t) {
    final d = DateTime.now().difference(t);
    if (d.inMinutes < 2) return 'just now';
    if (d.inHours < 1) return '${d.inMinutes} minutes ago';
    if (d.inDays < 1) return '${d.inHours} hours ago';
    return '${d.inDays} days ago';
  }
}

class _DeviceRow extends ConsumerWidget {
  const _DeviceRow({required this.board, required this.device, required this.view});
  final LocalBoard board;
  final LocalDevice device;
  final LocalView view;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.sb;
    final id = localId(board, device);
    final state = view.states[id] ?? const <String, dynamic>{};
    // shown the same way as in the rest of the app
    final asDevice = Device(
      id: device.id,
      key: device.key,
      name: device.name,
      type: device.type,
      controllable: device.type == 'switch',
      online: true,
      state: state,
      roomName: device.roomName,
    );
    final kind = DeviceKinds.of(asDevice);
    final on = state['on'] == true;
    final switchable = device.control && device.type == 'switch';
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      child: Row(
        children: [
          SbIcon(kind.icon(asDevice), size: 22, color: kind.active(asDevice) ? c.onText : c.mu),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(device.name, style: TextStyle(fontSize: 15.5, fontWeight: FontWeight.w600, color: c.tx)),
                Text(
                  state.isEmpty ? 'No reading yet' : kind.status(asDevice),
                  style: TextStyle(fontSize: 13, color: c.mu),
                ),
              ],
            ),
          ),
          if (switchable)
            SbSwitch(
              value: on,
              semanticLabel: device.name,
              onChanged: view.busy.contains(id)
                  ? null
                  : (v) async {
                      try {
                        await ref.read(localControlProvider.notifier).setOn(board, device, v);
                      } catch (e) {
                        if (context.mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
                        }
                      }
                    },
            )
          else if (device.type == 'switch')
            SbIcon(SbIcons.lock, size: 18, color: c.mu),
        ],
      ),
    );
  }
}

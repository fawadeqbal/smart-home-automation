import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_exception.dart';
import '../../core/theme/app_theme.dart';
import '../../core/theme/sb_colors.dart';
import '../../core/theme/sb_icons.dart';
import '../../core/theme/sb_icons_more.dart';
import '../../data/models/device.dart';
import '../../data/repositories/devices_repository.dart';
import '../../shared/widgets/common.dart';
import '../../shared/widgets/sheet.dart';
import '../../state/devices.dart';
import '../../state/toast.dart';
import '../auth/auth_widgets.dart';

/// Owners and admins: add, rename, reorder and delete rooms (like the web's Rooms page).
Future<void> showManageRooms(BuildContext context) => showSbSheet<void>(context, builder: (_) => const _ManageRooms());

/// [rooms] with the one at [from] moved to [to], each with its new place (what to save).
List<(Room, int)> reorderRooms(List<Room> rooms, int from, int to) {
  final list = [...rooms];
  final r = list.removeAt(from);
  list.insert(to.clamp(0, list.length), r);
  return [for (final (i, x) in list.indexed) (x, i)];
}

class _ManageRooms extends ConsumerStatefulWidget {
  const _ManageRooms();

  @override
  ConsumerState<_ManageRooms> createState() => _ManageRoomsState();
}

class _ManageRoomsState extends ConsumerState<_ManageRooms> {
  bool _busy = false;

  Future<void> _run(Future<void> Function(DevicesRepository repo) call, [String? done]) async {
    setState(() => _busy = true);
    try {
      await call(ref.read(devicesRepositoryProvider));
      ref.invalidate(roomsProvider);
      await ref.read(roomsProvider.future);
      await ref.read(devicesProvider.notifier).refresh();
      if (done != null) ref.read(toastProvider.notifier).show(done);
    } catch (e) {
      ref.read(toastProvider.notifier).show(ApiException.from(e).message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _move(List<Room> rooms, int from, int to) async {
    final moves = reorderRooms(rooms, from, to);
    await _run((repo) async {
      for (final (r, order) in moves) {
        if (r.order != order) await repo.updateRoom(r.id, order: order);
      }
    });
  }

  Future<String?> _askName(String title, {String initial = '', required String button}) async {
    final controller = TextEditingController(text: initial);
    final name = await showSbSheet<String>(
      context,
      builder: (ctx) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(title, style: SbText.title.copyWith(color: ctx.sb.tx)),
          const SizedBox(height: 16),
          LabeledField(
            label: 'Name',
            controller: controller,
            icon: SbIcons.rooms,
            hint: 'Kids room',
            autofocus: true,
            onSubmitted: (v) => Navigator.of(ctx).pop(v.trim()),
          ),
          const SizedBox(height: 16),
          BigButton(label: button, icon: SbIcons.check, onTap: () => Navigator.of(ctx).pop(controller.text.trim())),
        ],
      ),
    );
    controller.dispose();
    return name == null || name.isEmpty ? null : name;
  }

  Future<void> _delete(Room r) async {
    final ok = await showSbSheet<bool>(
      context,
      builder: (ctx) {
        final c = ctx.sb;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Delete ${r.name}?', style: SbText.title.copyWith(color: c.tx)),
            const SizedBox(height: 6),
            Text(
              'Its devices are kept, without a room — only owners and admins see them until you place them again. People lose the access they had to this room.',
              style: TextStyle(fontSize: 15, color: c.mu, height: 1.4),
            ),
            const SizedBox(height: 20),
            BigButton(label: 'Delete room', color: c.bad, foreground: Colors.white, onTap: () => Navigator.of(ctx).pop(true)),
            const SizedBox(height: 8),
            TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: Text('Keep it', style: TextStyle(color: c.tx))),
          ],
        );
      },
    );
    if (ok == true) await _run((repo) => repo.removeRoom(r.id), '${r.name} deleted');
  }

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final rooms = [...ref.watch(roomsProvider).value ?? const <Room>[]]..sort((a, b) => a.order.compareTo(b.order));
    final devices = ref.watch(devicesProvider).value ?? const <Device>[];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(child: Text('Rooms', style: SbText.title.copyWith(color: c.tx))),
            RoundButton(icon: SbIcons.x, label: 'Close', onTap: () => Navigator.of(context).pop()),
          ],
        ),
        const SizedBox(height: 4),
        Text('Rename, reorder or delete rooms. The order is the one everyone sees.', style: TextStyle(fontSize: 14.5, color: c.mu)),
        const SizedBox(height: 14),
        GroupCard(
          children: [
            for (final (i, r) in rooms.indexed)
              Padding(
                padding: const EdgeInsets.fromLTRB(14, 6, 4, 6),
                child: Row(
                  children: [
                    Expanded(
                      child: InkWell(
                        onTap: _busy
                            ? null
                            : () async {
                                final name = await _askName('Rename ${r.name}', initial: r.name, button: 'Save');
                                if (name != null && name != r.name) await _run((repo) => repo.updateRoom(r.id, name: name), 'Renamed');
                              },
                        child: Padding(
                          padding: const EdgeInsets.symmetric(vertical: 8),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(r.name, style: TextStyle(fontSize: 15.5, fontWeight: FontWeight.w500, color: c.tx)),
                              Text(
                                '${devices.where((d) => d.roomId == r.id).length} devices · tap to rename',
                                style: TextStyle(fontSize: 12.5, color: c.mu),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                    IconButton(
                      tooltip: 'Move up',
                      onPressed: _busy || i == 0 ? null : () => _move(rooms, i, i - 1),
                      icon: SbIcon(MoreIcons.arrowUp, size: 17, color: i == 0 ? c.sf3 : c.tx),
                    ),
                    IconButton(
                      tooltip: 'Move down',
                      onPressed: _busy || i == rooms.length - 1 ? null : () => _move(rooms, i, i + 1),
                      icon: SbIcon(MoreIcons.arrowDown, size: 17, color: i == rooms.length - 1 ? c.sf3 : c.tx),
                    ),
                    IconButton(
                      tooltip: 'Delete ${r.name}',
                      onPressed: _busy ? null : () => _delete(r),
                      icon: SbIcon(SbIcons.trash, size: 17, color: c.badText),
                    ),
                  ],
                ),
              ),
          ],
        ),
        const SizedBox(height: 14),
        BigButton(
          label: 'Add a room',
          icon: SbIcons.plus,
          busy: _busy,
          onTap: () async {
            final name = await _askName('Add a room', button: 'Add room');
            if (name != null) await _run((repo) => repo.addRoom(name, rooms.length), '$name added');
          },
        ),
      ],
    );
  }
}

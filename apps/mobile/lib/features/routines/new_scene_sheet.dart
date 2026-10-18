import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_exception.dart';
import '../../core/theme/app_theme.dart';
import '../../core/theme/sb_colors.dart';
import '../../core/theme/sb_icons.dart';
import '../../data/models/automation.dart';
import '../../data/repositories/automation_repository.dart';
import '../../shared/widgets/common.dart';
import '../../shared/widgets/sb_chip.dart';
import '../../shared/widgets/sheet.dart';
import '../../state/automation.dart';
import '../../state/home_overview.dart';
import '../../state/toast.dart';
import '../auth/auth_widgets.dart';

/// A new scene: a name, a look, and which of my switches go on or off (like the web's New scene).
Future<void> showNewSceneSheet(BuildContext context) => showSbSheet<void>(context, builder: (_) => const _NewScene());

/// Asks, then deletes [scene].
Future<void> confirmDeleteScene(BuildContext context, WidgetRef ref, Scene scene) async {
  final ok = await showSbSheet<bool>(
    context,
    builder: (ctx) {
      final c = ctx.sb;
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Delete “${scene.name}”?', style: SbText.title.copyWith(color: c.tx)),
          const SizedBox(height: 6),
          Text('Timers and rules that run it stop doing so.', style: TextStyle(fontSize: 15, color: c.mu)),
          const SizedBox(height: 20),
          BigButton(label: 'Delete', color: c.bad, foreground: Colors.white, onTap: () => Navigator.of(ctx).pop(true)),
          const SizedBox(height: 8),
          TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: Text('Keep it', style: TextStyle(color: c.tx))),
        ],
      );
    },
  );
  if (ok != true) return;
  try {
    await ref.read(automationRepositoryProvider).deleteScene(scene.id);
    ref.invalidate(scenesProvider);
    ref.read(toastProvider.notifier).show('Deleted');
  } catch (e) {
    ref.read(toastProvider.notifier).show(ApiException.from(e).message, error: true);
  }
}

class _NewScene extends ConsumerStatefulWidget {
  const _NewScene();

  @override
  ConsumerState<_NewScene> createState() => _NewSceneState();
}

class _NewSceneState extends ConsumerState<_NewScene> {
  final _name = TextEditingController();
  String _icon = 'moon';

  /// device id -> on (true) / off (false)
  final Map<String, bool> _picked = {};
  bool _busy = false;
  String? _error;

  static const looks = [('moon', 'Night', SbIcons.moon), ('sun', 'Morning', SbIcons.sun), ('film', 'Movie', SbIcons.filmStrip), ('away', 'Away', SbIcons.signOut), ('sparkles', 'Other', SbIcons.sparkle)];

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_name.text.trim().isEmpty) {
      setState(() => _error = 'Give the scene a name, like “Good night”.');
      return;
    }
    if (_picked.isEmpty) {
      setState(() => _error = 'Pick at least one thing to switch.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(automationRepositoryProvider).createScene(_name.text, _icon, [for (final e in _picked.entries) DeviceAction(deviceId: e.key, on: e.value)]);
      ref.invalidate(scenesProvider);
      if (mounted) Navigator.of(context).pop();
      ref.read(toastProvider.notifier).show('Scene saved');
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
    final rooms = ref.watch(roomSummariesProvider).where((r) => r.switches.any((d) => d.canControl)).toList();
    final label = TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: c.mu, letterSpacing: .3);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(child: Text('New scene', style: SbText.title.copyWith(color: c.tx))),
            RoundButton(icon: SbIcons.x, label: 'Close', onTap: () => Navigator.of(context).pop()),
          ],
        ),
        const SizedBox(height: 4),
        Text('Many things at once, in one tap.', style: TextStyle(fontSize: 14.5, color: c.mu)),
        const SizedBox(height: 14),
        LabeledField(label: 'Name', controller: _name, icon: SbIcons.sparkle, hint: 'Good night'),
        const SizedBox(height: 14),
        Text('LOOK', style: label),
        const SizedBox(height: 8),
        Wrap(
          spacing: 6,
          runSpacing: 6,
          children: [for (final (k, l, i) in looks) SbChip(label: l, icon: i, height: 38, selected: _icon == k, onTap: () => setState(() => _icon = k))],
        ),
        const SizedBox(height: 16),
        Text('SWITCH — TAP ONCE FOR ON, AGAIN FOR OFF', style: label),
        for (final r in rooms) ...[
          const SizedBox(height: 10),
          Text(r.room.name, style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: c.tx)),
          const SizedBox(height: 6),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              for (final d in r.switches.where((d) => d.canControl))
                SbChip(
                  label: _picked.containsKey(d.id) ? '${d.name}: ${_picked[d.id]! ? 'on' : 'off'}' : d.name,
                  selected: _picked.containsKey(d.id),
                  tone: _picked[d.id] == false ? ChipTone.ink : ChipTone.amber,
                  height: 38,
                  onTap: () => setState(() {
                    if (!_picked.containsKey(d.id)) {
                      _picked[d.id] = true;
                    } else if (_picked[d.id]!) {
                      _picked[d.id] = false;
                    } else {
                      _picked.remove(d.id);
                    }
                  }),
                ),
            ],
          ),
        ],
        if (_error != null) ...[
          const SizedBox(height: 12),
          Note(tone: NoteTone.bad, icon: SbIcons.warning, child: Text(_error!)),
        ],
        const SizedBox(height: 16),
        BigButton(label: 'Save scene', icon: SbIcons.check, busy: _busy, onTap: _save),
      ],
    );
  }
}

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_exception.dart';
import '../../core/theme/sb_colors.dart';
import '../../core/theme/sb_icons.dart';
import '../../data/models/automation.dart';
import '../../data/repositories/automation_repository.dart';
import '../../shared/widgets/pressable.dart';
import '../../state/devices.dart';
import '../../state/toast.dart';
import 'scene_look.dart';

/// Runs a scene and offers Undo (puts back what it changed).
Future<void> runScene(WidgetRef ref, Scene scene) async {
  final toast = ref.read(toastProvider.notifier);
  final devices = ref.read(devicesProvider).value ?? const [];
  final before = {
    for (final a in scene.actions)
      for (final d in devices.where((d) => d.id == a.deviceId))
        if (d.isOn != a.on) d.id: d.isOn,
  };
  try {
    final result = await ref.read(automationRepositoryProvider).runScene(scene.id);
    final n = result.done.length;
    if (!result.ok && n == 0) {
      toast.show(
        result.failed.isNotEmpty ? result.failed.first : result.summary,
        error: true,
      );
      return;
    }
    final changed = before.length;
    toast.show(
      changed == 0
          ? '${scene.name} — already done'
          : '${scene.name} — $changed thing${changed == 1 ? '' : 's'} changed${result.failed.isNotEmpty ? ' (${result.failed.length} didn’t answer)' : ''}',
      undo: changed == 0
          ? null
          : () async {
              await ref.read(devicesProvider.notifier).setMany(before);
              toast.show('Undone — everything is back');
            },
    );
  } catch (e) {
    toast.show(ApiException.from(e).message, error: true);
  }
}

/// A scene as a coloured card. [compact]: the Home tab's carousel; otherwise the Routines grid.
class SceneCard extends ConsumerStatefulWidget {
  const SceneCard({
    super.key,
    required this.scene,
    required this.index,
    this.compact = false,
    this.subtitle,
  });
  final Scene scene;
  final int index;
  final bool compact;
  final String? subtitle;

  @override
  ConsumerState<SceneCard> createState() => _SceneCardState();
}

class _SceneCardState extends ConsumerState<SceneCard> {
  bool _running = false;

  Future<void> _run() async {
    if (_running) return;
    setState(() => _running = true);
    await runScene(ref, widget.scene);
    if (mounted) setState(() => _running = false);
  }

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final (palette, icon) = sceneLook(widget.scene, widget.index);
    final compact = widget.compact;
    return Pressable(
      onTap: widget.scene.canRun ? _run : null,
      semanticLabel: 'Run ${widget.scene.name}',
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 300),
        width: compact ? 134 : null,
        padding: EdgeInsets.all(compact ? 16 : 18),
        decoration: BoxDecoration(
          gradient: palette.gradient,
          borderRadius: BorderRadius.circular(compact ? 26 : 28),
          boxShadow: _running
              ? [BoxShadow(color: c.on, spreadRadius: 3)]
              : const [
                  BoxShadow(
                    color: Color(0x73000000),
                    blurRadius: 28,
                    spreadRadius: -18,
                    offset: Offset(0, 14),
                  ),
                ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: compact ? 38 : 42,
              height: compact ? 38 : 42,
              decoration: BoxDecoration(
                color: palette.iconBg,
                shape: BoxShape.circle,
              ),
              child: Center(
                child: _running
                    ? SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: palette.fg,
                        ),
                      )
                    : SbIcon(
                        icon,
                        size: compact ? 21 : 22,
                        color: palette.fg,
                        weight: IconWeight.fill,
                      ),
              ),
            ),
            SizedBox(height: compact ? 30 : 38),
            Text(
              widget.scene.name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: compact ? 14.5 : 15.5,
                fontWeight: FontWeight.w600,
                color: palette.fg,
                height: 1.25,
              ),
            ),
            Text(
              widget.subtitle ?? _detail(widget.scene),
              maxLines: compact ? 1 : 2,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: compact ? 12.5 : 13,
                color: palette.sub,
                height: 1.3,
              ),
            ),
          ],
        ),
      ),
    );
  }

  static String _detail(Scene s) {
    final names = s.actions.map((a) => a.deviceName).where((n) => n.isNotEmpty).toList();
    if (names.isEmpty) return 'Nothing in it yet';
    final ons = s.actions.where((a) => a.on).length, offs = s.actions.length - ons;
    if (offs == s.actions.length && s.actions.length > 3) return 'Turns ${s.actions.length} things off';
    if (ons == s.actions.length && s.actions.length > 3) return 'Turns ${s.actions.length} things on';
    return names.take(3).join(', ') + (names.length > 3 ? ' +${names.length - 3}' : '');
  }
}

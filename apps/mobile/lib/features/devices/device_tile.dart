import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_exception.dart';
import '../../core/theme/sb_colors.dart';
import '../../core/theme/sb_icons.dart';
import '../../core/util/format.dart';
import '../../data/models/device.dart';
import '../../shared/widgets/pressable.dart';
import '../../state/automation.dart';
import '../../state/devices.dart';
import '../../state/session.dart';
import '../../state/toast.dart';
import 'device_kinds.dart';
import 'device_sheet.dart';

/// A device tile wired to the live state: tap to switch, the arrow for details.
class LiveDeviceTile extends ConsumerWidget {
  const LiveDeviceTile({
    super.key,
    required this.deviceId,
    this.showRoom = false,
  });
  final String deviceId;

  /// Under the name: the room (Favourites) or its state (a room's page).
  final bool showRoom;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final device = ref.watch(deviceProvider(deviceId));
    if (device == null) return const SizedBox.shrink();
    final pending = ref.watch(
      pendingDevicesProvider.select((s) => s.contains(deviceId)),
    );
    final timer = ref.watch(deviceTimerProvider(deviceId));
    return DeviceTile(
      device: device,
      pending: pending,
      subtitle: showRoom ? (device.roomName ?? '') : null,
      timerText: timer != null && device.isOn ? 'Off ${Fmt.until(timer.nextRunAt!)}' : null,
      onToggle: () => toggleDevice(context, ref, device),
      onOpen: () => showDeviceSheet(context, deviceId),
    );
  }
}

/// Switches a device from a tile or a sheet, with the design's messages when it can't.
Future<void> toggleDevice(
  BuildContext context,
  WidgetRef ref,
  Device device,
) async {
  final toast = ref.read(toastProvider.notifier);
  final kind = DeviceKinds.of(device);
  if (!kind.toggleable) return showDeviceSheet(context, device.id);
  if (device.waiting) {
    toast.show(
      'The ${device.name.toLowerCase()} is waiting for a new board. Your installer has been told.',
    );
    return;
  }
  if (!device.responding) {
    toast.show(
      '${device.roomName ?? 'That room'} isn’t responding. Its wall switch still works.',
    );
    return;
  }
  if (!device.canControl) {
    toast.show(
      'You can see the ${device.name.toLowerCase()}, but not switch it.',
    );
    return;
  }
  if (device.childLock && !(ref.read(meProvider).home?.manages ?? false)) {
    toast.show('The ${device.name.toLowerCase()} has child lock on. Ask the home owner.');
    return;
  }
  if (ref.read(pendingDevicesProvider).contains(device.id)) return;
  try {
    await ref.read(devicesProvider.notifier).setOn(device.id, !device.isOn);
  } catch (e) {
    final err = ApiException.from(e);
    // on UPS, a heavy load asks first: the owner may still switch it on
    if (err.code == 'ups' && context.mounted && await _confirmOnUps(context, err.message)) {
      try {
        await ref.read(devicesProvider.notifier).setOn(device.id, !device.isOn, confirm: 'ups');
      } catch (again) {
        toast.show(ApiException.from(again).message, error: true);
      }
      return;
    }
    toast.show(err.message, error: true);
  }
}

Future<bool> _confirmOnUps(BuildContext context, String message) async =>
    await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('On UPS'),
        content: Text(message),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: const Text('Leave it off')),
          TextButton(onPressed: () => Navigator.of(ctx).pop(true), child: const Text('Switch it on')),
        ],
      ),
    ) ??
    false;

/// The design's device tile. On: an amber wash grows out of the icon; fans spin.
class DeviceTile extends StatelessWidget {
  const DeviceTile({
    super.key,
    required this.device,
    this.pending = false,
    this.subtitle,
    this.timerText,
    this.onToggle,
    this.onOpen,
  });

  final Device device;
  final bool pending;
  final String? subtitle;
  final String? timerText;
  final VoidCallback? onToggle;
  final VoidCallback? onOpen;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final kind = DeviceKinds.of(device);
    final down = !device.responding;
    final lit = kind.active(device) && !down && kind.toggleable;
    final alarm = kind.alarm(device) && !down;
    final state = device.waiting
        ? 'Waiting for a new board'
        : down
        ? 'Not responding'
        : pending
        ? (device.isOn ? 'Turning on…' : 'Turning off…')
        : timerText ?? kind.status(device);
    final sub = subtitle ?? state;
    final fg = lit ? SbColors.onInk : c.tx;
    final subColor = down || alarm
        ? c.badText
        : lit
        ? const Color(0xBF281800)
        : c.mu;
    final pill = down
        ? '!'
        : pending
        ? '…'
        : kind.toggleable
        ? (device.isOn ? 'On' : 'Off')
        : null;

    return Stack(
      children: [
        Semantics(
          container: true,
          button: true,
          label: '${device.name}, ${subtitle ?? ''}${subtitle != null ? ', ' : ''}$state',
          toggled: kind.toggleable ? device.isOn : null,
          onTap: onToggle,
          onLongPress: onOpen,
          excludeSemantics: true,
          child: Pressable(
            onTap: onToggle,
            onLongPress: onOpen,
            child: AnimatedOpacity(
              duration: const Duration(milliseconds: 300),
              opacity: down ? .6 : 1,
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 400),
                width: double.infinity,
                height: 142,
                decoration: BoxDecoration(
                  color: c.sf,
                  borderRadius: BorderRadius.circular(28),
                  border: Border.all(
                    color: lit
                        ? Colors.transparent
                        : alarm
                        ? c.bad
                        : c.ln,
                  ),
                  boxShadow: lit
                      ? const [
                          BoxShadow(
                            color: Color(0xBFF59E0B),
                            blurRadius: 32,
                            spreadRadius: -16,
                            offset: Offset(0, 18),
                          ),
                        ]
                      : c.shadow1,
                ),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(27),
                  child: Stack(
                    children: [
                      Positioned.fill(child: _AmberWash(on: lit)),
                      Padding(
                        padding: const EdgeInsets.all(16),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            _TileIcon(
                              icon: kind.icon(device),
                              lit: lit,
                              alarm: alarm,
                              spinning: kind.spins(device) && !down,
                            ),
                            Padding(
                              padding: const EdgeInsets.only(right: 30),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    device.name,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: TextStyle(
                                      fontSize: 15,
                                      fontWeight: FontWeight.w600,
                                      color: fg,
                                      height: 1.25,
                                    ),
                                  ),
                                  AnimatedDefaultTextStyle(
                                    duration: const Duration(milliseconds: 300),
                                    style: TextStyle(
                                      fontSize: 13,
                                      color: subColor,
                                      height: 1.25,
                                      fontFamily: 'Geist',
                                    ),
                                    child: Text(
                                      sub,
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
        if (pill != null)
          Positioned(
            right: 14,
            top: 16,
            child: IgnorePointer(
              child: ExcludeSemantics(
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 350),
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 3,
                  ),
                  decoration: BoxDecoration(
                    color: down
                        ? c.badSoft
                        : lit
                        ? const Color(0x1F1A1204)
                        : c.sf2,
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    pill,
                    style: TextStyle(
                      fontSize: 11.5,
                      fontWeight: FontWeight.w600,
                      color: down
                          ? c.badText
                          : lit
                          ? SbColors.onInk
                          : c.mu,
                    ),
                  ),
                ),
              ),
            ),
          ),
        Positioned(
          right: 2,
          bottom: 2,
          child: Semantics(
            container: true,
            button: true,
            label: '${device.name} details',
            child: InkResponse(
              onTap: onOpen,
              radius: 24,
              child: SizedBox(
                width: 44,
                height: 44,
                child: Center(
                  child: SbIcon(
                    SbIcons.caretRight,
                    size: 17,
                    color: lit ? const Color(0x991A1204) : c.mu,
                  ),
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }
}

/// The amber that fills a tile from its icon outwards when it turns on.
class _AmberWash extends StatelessWidget {
  const _AmberWash({required this.on});
  final bool on;

  @override
  Widget build(BuildContext context) {
    return TweenAnimationBuilder<double>(
      tween: Tween(end: on ? 1 : 0),
      duration: const Duration(milliseconds: 600),
      curve: const Cubic(.2, .8, .2, 1),
      builder: (context, t, _) {
        if (t <= 0.001) return const SizedBox.shrink();
        return ClipPath(
          clipper: _CircleClip(t),
          child: const DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment(-.4, -1),
                end: Alignment(.4, 1),
                colors: [SbColors.onTileFrom, SbColors.onTileTo],
              ),
            ),
          ),
        );
      },
    );
  }
}

class _CircleClip extends CustomClipper<Path> {
  const _CircleClip(this.t);
  final double t;

  @override
  Path getClip(Size size) {
    const center = Offset(39, 39);
    final r = t * 1.5 * math.sqrt(size.width * size.width + size.height * size.height);
    return Path()..addOval(Rect.fromCircle(center: center, radius: r));
  }

  @override
  bool shouldReclip(_CircleClip old) => old.t != t;
}

class _TileIcon extends StatelessWidget {
  const _TileIcon({
    required this.icon,
    required this.lit,
    required this.alarm,
    required this.spinning,
  });
  final SbIconData icon;
  final bool lit, alarm, spinning;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final bg = lit
        ? const Color(0x99FFFFFF)
        : alarm
        ? c.badSoft
        : c.sf2;
    final fg = lit
        ? const Color(0xFF7A4300)
        : alarm
        ? c.badText
        : c.mu;
    return AnimatedScale(
      scale: lit ? 1.06 : 1,
      duration: const Duration(milliseconds: 450),
      curve: const Cubic(.3, 1.6, .5, 1),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 400),
        width: 46,
        height: 46,
        decoration: BoxDecoration(color: bg, shape: BoxShape.circle),
        child: Center(
          child: Spinning(
            spinning: spinning,
            child: SbIcon(
              icon,
              size: 23,
              color: fg,
              weight: lit ? IconWeight.fill : IconWeight.duotone,
            ),
          ),
        ),
      ),
    );
  }
}

/// Turns its child round and round while [spinning] (a fan that's on).
class Spinning extends StatefulWidget {
  const Spinning({
    super.key,
    required this.spinning,
    required this.child,
    this.period = const Duration(milliseconds: 1100),
  });
  final bool spinning;
  final Widget child;
  final Duration period;

  @override
  State<Spinning> createState() => _SpinningState();
}

class _SpinningState extends State<Spinning> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
    vsync: this,
    duration: widget.period,
  );

  @override
  void initState() {
    super.initState();
    if (widget.spinning) _c.repeat();
  }

  @override
  void didUpdateWidget(Spinning old) {
    super.didUpdateWidget(old);
    if (widget.spinning && !_c.isAnimating) _c.repeat();
    if (!widget.spinning && _c.isAnimating) _c.stop();
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (MediaQuery.disableAnimationsOf(context)) return widget.child;
    return RotationTransition(turns: _c, child: widget.child);
  }
}

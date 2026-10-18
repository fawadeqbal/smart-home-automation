import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_exception.dart';
import '../../core/theme/app_theme.dart';
import '../../core/theme/sb_colors.dart';
import '../../core/theme/sb_icons.dart';
import '../../core/util/format.dart';
import '../../data/models/activity.dart';
import '../../data/models/automation.dart';
import '../../data/models/device.dart';
import '../../shared/widgets/common.dart';
import '../../shared/widgets/pressable.dart';
import '../../shared/widgets/sb_chip.dart';
import '../../shared/widgets/sheet.dart';
import '../../state/activity.dart';
import '../../state/automation.dart';
import '../../state/devices.dart';
import '../../state/favourites.dart';
import '../../state/toast.dart';
import 'device_kinds.dart';
import 'device_tile.dart';

Future<void> showDeviceSheet(BuildContext context, String deviceId) =>
    showSbSheet<void>(context, builder: (_) => DeviceSheet(deviceId: deviceId));

/// Everything about one device: a big switch, a timer to turn it off, what to say, and its day.
class DeviceSheet extends ConsumerWidget {
  const DeviceSheet({super.key, required this.deviceId});
  final String deviceId;

  static const timers = [15, 30, 60, 120];

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.sb;
    final device = ref.watch(deviceProvider(deviceId));
    if (device == null) {
      return const Padding(
        padding: EdgeInsets.all(24),
        child: Text('This device was removed.'),
      );
    }
    final kind = DeviceKinds.of(device);
    final down = !device.responding;
    final lit = kind.active(device) && !down && kind.toggleable;
    final pending = ref.watch(
      pendingDevicesProvider.select((s) => s.contains(deviceId)),
    );
    final timer = ref.watch(deviceTimerProvider(deviceId));
    final favs = ref.watch(favouriteIdsProvider);
    final fav = favs.contains(deviceId);
    final status = device.waiting
        ? 'Waiting for a new board'
        : down
        ? 'Not responding'
        : pending
        ? (device.isOn ? 'Turning on…' : 'Turning off…')
        : kind.status(device);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            AnimatedContainer(
              duration: const Duration(milliseconds: 350),
              width: 56,
              height: 56,
              decoration: BoxDecoration(
                color: lit ? c.on : c.sf2,
                borderRadius: BorderRadius.circular(17),
              ),
              child: Center(
                child: Spinning(
                  spinning: kind.spins(device) && !down,
                  child: SbIcon(
                    kind.icon(device),
                    size: 28,
                    color: lit ? SbColors.onInk : c.mu,
                    weight: lit ? IconWeight.fill : IconWeight.duotone,
                  ),
                ),
              ),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(device.name, style: SbText.title.copyWith(color: c.tx)),
                  Text(
                    '${device.roomName ?? 'No room'} · $status',
                    style: TextStyle(
                      fontSize: 14,
                      color: down ? c.badText : c.mu,
                    ),
                  ),
                ],
              ),
            ),
            if (kind.toggleable)
              Padding(
                padding: const EdgeInsets.only(right: 8),
                child: RoundButton(
                  icon: SbIcons.star,
                  label: fav ? 'Remove from favourites' : 'Add to favourites',
                  onTap: () => ref.read(favouritesSettingProvider.notifier).toggle(deviceId, favs),
                ),
              ),
            RoundButton(
              icon: SbIcons.x,
              label: 'Close',
              onTap: () => Navigator.of(context).pop(),
            ),
          ],
        ),
        if (fav)
          Padding(
            padding: const EdgeInsets.only(top: 6, left: 70),
            child: Text(
              'On your Home screen',
              style: TextStyle(
                fontSize: 12.5,
                color: c.onText,
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
        const SizedBox(height: 20),
        if (kind.toggleable)
          _Orb(
            device: device,
            lit: lit,
            down: down,
            onTap: () => toggleDevice(context, ref, device),
          )
        else
          _Readout(device: device, kind: kind),
        if (kind.toggleable && !down && device.canControl) ...[
          const SizedBox(height: 22),
          Text(
            'Turn off automatically',
            style: SbText.cardTitle.copyWith(color: c.tx),
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              for (final (i, m) in timers.indexed) ...[
                if (i > 0) const SizedBox(width: 8),
                Expanded(
                  child: _TimerChip(
                    label: Fmt.minutes(m),
                    selected: timer != null && _matches(timer, m),
                    onTap: () => _setTimer(context, ref, device, m, timer),
                  ),
                ),
              ],
            ],
          ),
          if (timer != null && device.isOn)
            Padding(
              padding: const EdgeInsets.only(top: 10),
              child: Row(
                children: [
                  SbIcon(SbIcons.clock, size: 15, color: c.onText),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      'Turns off ${Fmt.until(timer.nextRunAt!)} · tap it again to cancel',
                      style: TextStyle(
                        fontSize: 14,
                        color: c.onText,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ),
                ],
              ),
            ),
        ],
        if (kind.phrases(device).isNotEmpty) ...[
          const SizedBox(height: 22),
          Text('Say it', style: SbText.cardTitle.copyWith(color: c.tx)),
          const SizedBox(height: 8),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              for (final p in kind.phrases(device))
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 12,
                    vertical: 7,
                  ),
                  decoration: BoxDecoration(
                    color: c.sf2,
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      SbIcon(SbIcons.mic, size: 13, color: c.mu),
                      const SizedBox(width: 6),
                      Text(
                        '“$p”',
                        style: TextStyle(fontSize: 13.5, color: c.tx),
                      ),
                    ],
                  ),
                ),
            ],
          ),
        ],
        const SizedBox(height: 22),
        Text('Lately', style: SbText.cardTitle.copyWith(color: c.tx)),
        const SizedBox(height: 4),
        _History(deviceId: deviceId),
      ],
    );
  }

  /// Which of the four choices made this timer. The app names its timers "Fan off · 30 min";
  /// timers made elsewhere match the closest choice to the time that's left.
  static bool _matches(Schedule s, int minutes) {
    final named = RegExp(r'· (\d+) min$').firstMatch(s.name);
    if (named != null) return int.parse(named.group(1)!) == minutes;
    final left = s.nextRunAt!.difference(DateTime.now()).inMinutes;
    final closest = timers.reduce(
      (a, b) => (a - left).abs() <= (b - left).abs() ? a : b,
    );
    return closest == minutes;
  }

  Future<void> _setTimer(
    BuildContext context,
    WidgetRef ref,
    Device device,
    int minutes,
    Schedule? current,
  ) async {
    final toast = ref.read(toastProvider.notifier);
    final schedules = ref.read(schedulesProvider.notifier);
    if (!device.isOn) {
      toast.show('Turn the ${device.name.toLowerCase()} on first');
      return;
    }
    try {
      if (current != null) await schedules.remove(current.id);
      if (current != null && _matches(current, minutes)) {
        toast.show('Timer cancelled');
        return;
      }
      await schedules.create(
        NewSchedule.inMinutes(minutes, [
          DeviceAction(deviceId: device.id, on: false),
        ], name: '${device.name} off · $minutes min'),
      );
      toast.show('${device.name} turns off in ${Fmt.minutes(minutes)}');
    } catch (e) {
      toast.show(ApiException.from(e).message, error: true);
    }
  }
}

class _TimerChip extends StatelessWidget {
  const _TimerChip({
    required this.label,
    required this.selected,
    required this.onTap,
  });
  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    return Pressable(
      onTap: onTap,
      selected: selected,
      scale: .96,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        height: 46,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: selected ? c.tx : c.sf,
          borderRadius: BorderRadius.circular(13),
          border: Border.all(color: selected ? c.tx : c.ln2),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 14,
            fontWeight: FontWeight.w500,
            color: selected ? c.bg : c.tx,
          ),
        ),
      ),
    );
  }
}

/// The big round switch.
class _Orb extends StatelessWidget {
  const _Orb({
    required this.device,
    required this.lit,
    required this.down,
    required this.onTap,
  });
  final Device device;
  final bool lit, down;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final kind = DeviceKinds.of(device);
    final label = device.waiting
        ? 'Waiting for a new board — your installer has been told'
        : down
        ? 'Not responding — use the wall switch'
        : device.isOn
        ? 'On · tap to turn off'
        : 'Off · tap to turn on';
    return Column(
      children: [
        Pressable(
          onTap: onTap,
          scale: .94,
          semanticLabel: '${device.name}: $label',
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 550),
            width: 160,
            height: 160,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: c.sf2,
              boxShadow: [
                BoxShadow(color: lit ? c.onSoft : c.bg, spreadRadius: 12),
                BoxShadow(
                  color: lit ? const Color(0xD9F59E0B) : Colors.transparent,
                  blurRadius: 60,
                  spreadRadius: -18,
                  offset: const Offset(0, 34),
                ),
              ],
            ),
            child: Stack(
              alignment: Alignment.center,
              children: [
                AnimatedScale(
                  scale: lit ? 1 : .35,
                  duration: const Duration(milliseconds: 600),
                  curve: const Cubic(.2, .8, .2, 1),
                  child: AnimatedOpacity(
                    opacity: lit ? 1 : 0,
                    duration: const Duration(milliseconds: 450),
                    child: Container(
                      decoration: const BoxDecoration(
                        shape: BoxShape.circle,
                        gradient: RadialGradient(
                          center: Alignment(-.3, -.44),
                          radius: .72,
                          colors: [Color(0xFFFFE6AD), Color(0xFFF59E0B)],
                        ),
                      ),
                    ),
                  ),
                ),
                Spinning(
                  spinning: kind.spins(device) && !down,
                  child: SbIcon(
                    kind.icon(device),
                    size: 66,
                    color: lit ? SbColors.onInk : c.mu,
                    weight: lit ? IconWeight.fill : IconWeight.duotone,
                  ),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 16),
        Text(
          label,
          textAlign: TextAlign.center,
          style: TextStyle(
            fontSize: 16,
            fontWeight: FontWeight.w600,
            color: down ? c.badText : c.tx,
          ),
        ),
      ],
    );
  }
}

/// A sensor's reading, large.
class _Readout extends StatelessWidget {
  const _Readout({required this.device, required this.kind});
  final Device device;
  final DeviceKind kind;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final alarm = kind.alarm(device);
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 26, horizontal: 18),
      decoration: BoxDecoration(
        color: alarm ? c.badSoft : c.sf2,
        borderRadius: BorderRadius.circular(26),
      ),
      child: Column(
        children: [
          Text(
            kind.status(device),
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 34,
              fontWeight: FontWeight.w600,
              letterSpacing: -1.2,
              color: alarm ? c.badText : c.tx,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            device.updatedAt == null ? 'No reading yet' : 'Updated ${Fmt.ago(device.updatedAt!).toLowerCase()}',
            style: TextStyle(fontSize: 13.5, color: c.mu),
          ),
        ],
      ),
    );
  }
}

class _History extends ConsumerWidget {
  const _History({required this.deviceId});
  final String deviceId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.sb;
    final history = ref.watch(deviceHistoryProvider(deviceId));
    return history.when(
      loading: () => const Padding(
        padding: EdgeInsets.all(16),
        child: Center(
          child: SizedBox(
            width: 20,
            height: 20,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
        ),
      ),
      error: (e, _) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Text(
          ApiException.from(e).message,
          style: TextStyle(color: c.mu),
        ),
      ),
      data: (events) {
        final list = events.where((e) => e.on != null || e.active != null).take(6).toList();
        if (list.isEmpty) {
          return Padding(
            padding: const EdgeInsets.symmetric(vertical: 8),
            child: Text('Nothing yet.', style: TextStyle(color: c.mu)),
          );
        }
        return Column(children: [for (final e in list) _HistoryRow(event: e)]);
      },
    );
  }
}

class _HistoryRow extends StatelessWidget {
  const _HistoryRow({required this.event});
  final ActivityEvent event;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final on = event.on ?? event.active ?? false;
    final what = event.on != null ? (on ? 'Turned on' : 'Turned off') : (on ? 'Triggered' : 'Back to normal');
    final who = event.by ?? _capital(event.via.label);
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 9),
      decoration: BoxDecoration(
        border: Border(bottom: BorderSide(color: c.ln)),
      ),
      child: Row(
        children: [
          Container(
            width: 8,
            height: 8,
            decoration: BoxDecoration(
              color: on ? c.on : c.switchOff,
              shape: BoxShape.circle,
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(what, style: TextStyle(fontSize: 14, color: c.tx)),
          ),
          Text(
            '$who · ${Fmt.when(event.at)}',
            style: TextStyle(fontSize: 13, color: c.mu),
          ),
        ],
      ),
    );
  }
}

String _capital(String s) => s.isEmpty ? s : s[0].toUpperCase() + s.substring(1);

/// Small chip used elsewhere for device choices.
class DeviceChoiceChip extends StatelessWidget {
  const DeviceChoiceChip({
    super.key,
    required this.device,
    required this.selected,
    required this.onTap,
  });
  final Device device;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => SbChip(
    label: device.name,
    icon: DeviceKinds.of(device).icon(device),
    selected: selected,
    onTap: onTap,
    tone: ChipTone.amber,
    height: 42,
  );
}

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/network/api_exception.dart';
import '../../core/theme/app_theme.dart';
import '../../core/theme/sb_colors.dart';
import '../../core/theme/sb_icons.dart';
import '../../core/theme/sb_icons_more.dart';
import '../../core/util/format.dart';
import '../../data/models/device.dart';
import '../../data/models/device_detail.dart';
import '../../data/models/energy.dart';
import '../../data/models/json.dart';
import '../../data/repositories/devices_repository.dart';
import '../../shared/widgets/common.dart';
import '../../shared/widgets/pill.dart';
import '../../shared/widgets/sb_switch.dart';
import '../../shared/widgets/segmented.dart';
import '../../shared/widgets/sheet.dart';
import '../../state/devices.dart';
import '../../state/people.dart';
import '../../state/session.dart';
import '../../state/toast.dart';
import '../energy/bill_section.dart';
import 'device_kinds.dart';
import 'device_sheet.dart';
import 'device_tile.dart';
import 'sensor_chart.dart';

/// One device's own page, like the web's /devices/:id: its state, a chart of a sensor's readings,
/// its electricity, safety (child lock, switch off by itself, after a power cut), its room, and its history.
class DeviceScreen extends ConsumerWidget {
  const DeviceScreen({super.key, required this.deviceId});
  final String deviceId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.sb;
    final detail = ref.watch(deviceDetailProvider(deviceId));
    final live = ref.watch(deviceProvider(deviceId));
    final manages = ref.watch(meProvider.select((m) => m.home?.manages ?? false));
    final d = detail.value;
    return RefreshIndicator(
      color: c.on,
      onRefresh: () async {
        ref.invalidate(deviceDetailProvider(deviceId));
        ref.invalidate(deviceRawHistoryProvider(deviceId));
      },
      child: ListView(
        padding: EdgeInsets.fromLTRB(18, MediaQuery.paddingOf(context).top + 4, 18, 130),
        children: [
          BackPill(onTap: () => context.pop()),
          const SizedBox(height: 16),
          if (d == null)
            detail.hasError ? ErrorView(error: detail.error!, onRetry: () => ref.invalidate(deviceDetailProvider(deviceId))) : const LoadingView(label: 'Opening the device…')
          else ...[
            _Header(detail: d, device: live ?? d.device),
            const SizedBox(height: 18),
            if (DeviceKinds.of(live ?? d.device).toggleable) _Control(device: live ?? d.device) else _Readings(detail: d),
            if (d.device.controllable) ...[const SizedBox(height: 22), _Power(detail: d, canEdit: manages)],
            if (d.device.controllable && manages) ...[const SizedBox(height: 22), _Safety(detail: d)],
            if (d.device.type == 'tank' && manages) ...[const SizedBox(height: 22), _TankMotor(detail: d)],
            if (manages) ...[const SizedBox(height: 22), _Room(detail: d)],
            const SizedBox(height: 22),
            _History(detail: d),
          ],
        ],
      ),
    );
  }
}

class _Header extends StatelessWidget {
  const _Header({required this.detail, required this.device});
  final DeviceDetail detail;
  final Device device;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final kind = DeviceKinds.of(device);
    final lit = kind.active(device) && device.responding && kind.toggleable;
    return Row(
      children: [
        Container(
          width: 56,
          height: 56,
          decoration: BoxDecoration(color: lit ? c.on : c.sf2, borderRadius: BorderRadius.circular(17)),
          child: Center(child: SbIcon(kind.icon(device), size: 28, color: lit ? SbColors.onInk : c.mu, weight: lit ? IconWeight.fill : IconWeight.duotone)),
        ),
        const SizedBox(width: 14),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(device.name, style: SbText.title.copyWith(color: c.tx)),
              Text('${device.roomName ?? 'No room'} · ${detail.typeLabel.isEmpty ? device.typeLabel : detail.typeLabel}', maxLines: 2, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 13.5, color: c.mu)),
              const SizedBox(height: 6),
              Wrap(
                spacing: 6,
                runSpacing: 4,
                children: [
                  if (device.waiting)
                    const Pill('Waiting for a new board', tone: PillTone.bad)
                  else
                    Pill(device.online ? 'Online' : 'Offline', tone: device.online ? PillTone.ok : PillTone.bad),
                  if (device.childLock) const Pill('Child lock', tone: PillTone.info, icon: SbIcons.lock),
                  if (detail.autoOffMinutes != null && detail.autoOffMinutes! > 0) Pill('Off after ${Fmt.minutes(detail.autoOffMinutes!)}', tone: PillTone.mute, icon: SbIcons.clock),
                ],
              ),
            ],
          ),
        ),
      ],
    );
  }
}

/// A switch: on/off, and the device sheet for speed and timers.
class _Control extends ConsumerWidget {
  const _Control({required this.device});
  final Device device;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.sb;
    final kind = DeviceKinds.of(device);
    final pending = ref.watch(pendingDevicesProvider.select((s) => s.contains(device.id)));
    final status = device.waiting
        ? 'Waiting for a new board'
        : !device.responding
            ? 'Not responding — use the wall switch'
            : pending
                ? (device.isOn ? 'Turning on…' : 'Turning off…')
                : kind.status(device);
    return GroupCard(
      radius: 22,
      children: [
        Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(status, style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600, color: device.responding ? c.tx : c.badText)),
                    if (device.updatedAt != null) Text('Changed ${Fmt.ago(device.updatedAt!).toLowerCase()}', style: TextStyle(fontSize: 13, color: c.mu)),
                  ],
                ),
              ),
              if (device.canControl)
                SbSwitch(value: device.isOn, large: true, amber: true, semanticLabel: device.name, onChanged: (_) => toggleDevice(context, ref, device)),
            ],
          ),
        ),
        if (device.canControl)
          InfoRow(icon: SbIcons.clock, title: 'Timer, speed and favourites', onTap: () => showDeviceSheet(context, device.id)),
      ],
    );
  }
}

/// A sensor: its reading now and a chart for each of its readings.
class _Readings extends ConsumerWidget {
  const _Readings({required this.detail});
  final DeviceDetail detail;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.sb;
    final device = ref.watch(deviceProvider(detail.device.id)) ?? detail.device;
    final kind = DeviceKinds.of(device);
    final history = ref.watch(deviceRawHistoryProvider(detail.device.id)).value ?? const <Json>[];
    final charts = [
      for (final f in detail.stateFields)
        if (readingsOf(history, f.key).length >= 2) (f, readingsOf(history, f.key)),
    ];
    return GroupCard(
      radius: 22,
      children: [
        Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(kind.status(device), style: TextStyle(fontSize: 30, fontWeight: FontWeight.w600, letterSpacing: -1, color: kind.alarm(device) ? c.badText : c.tx)),
              Text(device.updatedAt == null ? 'No reading yet' : 'Updated ${Fmt.ago(device.updatedAt!).toLowerCase()}', style: TextStyle(fontSize: 13, color: c.mu)),
              for (final (f, points) in charts) ...[
                const SizedBox(height: 18),
                SensorChart(points: points, label: f.label, unit: f.unit),
              ],
              if (charts.isEmpty && detail.stateFields.any((f) => f.unit.isNotEmpty)) ...[
                const SizedBox(height: 10),
                Text('A chart shows here once there are a few readings.', style: TextStyle(fontSize: 13, color: c.mu)),
              ],
            ],
          ),
        ),
      ],
    );
  }
}

/// Its electricity this week, and its power rating (owners and admins can set it).
class _Power extends ConsumerWidget {
  const _Power({required this.detail, required this.canEdit});
  final DeviceDetail detail;
  final bool canEdit;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final week = ref.watch(homeEnergyProvider).value;
    final mine = week?.devices.where((x) => x.id == detail.device.id).firstOrNull;
    final d = detail.device;
    final watts = mine == null
        ? (detail.watts == null ? 'Power guessed from its name' : '${detail.watts} W')
        : mine.wattsText[0].toUpperCase() + mine.wattsText.substring(1);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SectionHeader('Electricity'),
        const SizedBox(height: 10),
        GroupCard(
          radius: 22,
          children: [
            InfoRow(
              icon: SbIcons.zap,
              tint: (context.sb.onSoft, context.sb.onText),
              title: mine == null ? 'Nothing this week' : 'This week: ${Energy.units(mine.kwh)} units · ${Energy.rupees(mine.cost)}',
              subtitle: mine == null ? 'An estimate from how long it’s on' : '${Energy.hoursText(mine.hours)} on · an estimate',
            ),
            InfoRow(
              icon: MoreIcons.gear,
              title: watts,
              subtitle: canEdit ? 'Tap to set it from its label or box' : 'Used for the estimates',
              onTap: canEdit ? () => showWattsSheet(context, deviceId: d.id, name: d.name, watts: detail.watts) : null,
            ),
          ],
        ),
      ],
    );
  }
}

/// Owners and admins: child lock, safety auto-off, and what happens after a power cut.
class _Safety extends ConsumerStatefulWidget {
  const _Safety({required this.detail});
  final DeviceDetail detail;

  @override
  ConsumerState<_Safety> createState() => _SafetyState();
}

class _SafetyState extends ConsumerState<_Safety> {
  bool _busy = false;

  Future<void> _save(Map<String, Object?> body, String done) async {
    setState(() => _busy = true);
    try {
      await ref.read(devicesRepositoryProvider).update(widget.detail.device.id, body);
      ref.invalidate(deviceDetailProvider(widget.detail.device.id));
      await ref.read(devicesProvider.notifier).refresh();
      ref.read(toastProvider.notifier).show(done);
    } catch (e) {
      ref.read(toastProvider.notifier).show(ApiException.from(e).message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _autoOff() async {
    final d = widget.detail;
    final picked = await showSbSheet<int>(
      context,
      builder: (ctx) {
        final c = ctx.sb;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Switch off by itself', style: SbText.title.copyWith(color: c.tx)),
            const SizedBox(height: 4),
            Text('For a geyser, iron or motor: it goes off this long after it was turned on, whoever turned it on.', style: TextStyle(fontSize: 14.5, color: c.mu)),
            const SizedBox(height: 12),
            GroupCard(
              children: [
                for (final m in d.autoOffChoices)
                  InfoRow(
                    icon: m == 0 ? SbIcons.x : SbIcons.clock,
                    title: DeviceDetail.autoOffText(m),
                    trailing: (d.autoOffMinutes ?? 0) == m ? SbIcon(SbIcons.check, size: 18, color: c.okText) : const SizedBox.shrink(),
                    onTap: () => Navigator.of(ctx).pop(m),
                  ),
              ],
            ),
          ],
        );
      },
    );
    if (picked != null && picked != (d.autoOffMinutes ?? 0)) {
      await _save({'autoOffMinutes': picked == 0 ? null : picked}, picked == 0 ? 'It won’t switch off by itself' : 'Switches off ${DeviceDetail.autoOffText(picked).toLowerCase()}');
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final d = widget.detail;
    final dev = d.device;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SectionHeader('Safety'),
        const SizedBox(height: 10),
        GroupCard(
          radius: 22,
          children: [
            InfoRow(
              icon: SbIcons.lock,
              title: 'Child lock',
              subtitle: 'Only the owner and admins can switch it — from the app, the assistant or a rule. The wall switch still works.',
              trailing: SbSwitch(
                value: dev.childLock,
                semanticLabel: 'Child lock',
                onChanged: _busy ? null : (v) => _save({'childLock': v}, v ? 'Child lock on' : 'Child lock off'),
              ),
            ),
            InfoRow(
              icon: SbIcons.clock,
              title: 'Switch off by itself',
              subtitle: '${DeviceDetail.autoOffText(d.autoOffMinutes ?? 0)}${d.autoOffAt != null ? ' · next at ${Fmt.clock(d.autoOffAt!)}' : ''}',
              onTap: _busy ? null : _autoOff,
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(14, 12, 14, 14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text('After a power cut', style: TextStyle(fontSize: 15.5, fontWeight: FontWeight.w500, color: c.tx)),
                  Text(
                    'When the electricity comes back, things come back one by one. A motor, iron or geyser is safer staying off.',
                    style: TextStyle(fontSize: 13, color: c.mu, height: 1.3),
                  ),
                  const SizedBox(height: 10),
                  Segmented<bool>(
                    options: const [(false, 'Comes back as it was'), (true, 'Stays off')],
                    value: dev.restoreOff,
                    onChanged: (v) => _busy || v == dev.restoreOff ? null : _save({'restoreOff': v}, v ? 'It stays off after a power cut' : 'It comes back as it was'),
                  ),
                ],
              ),
            ),
          ],
        ),
      ],
    );
  }
}

/// Owners and admins: when a water tank's motor starts and stops by itself.
class _TankMotor extends ConsumerWidget {
  const _TankMotor({required this.detail});
  final DeviceDetail detail;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = detail.device.settings;
    if (s['motorDeviceId'] == null) return const SizedBox.shrink();
    final fill = integer(s['fillBelowPct']);
    final stop = integer(s['stopAtPct'], 95);
    Future<void> pick(String title, List<int> values, int current, String Function(int) text, String key) async {
      final v = await showSbSheet<int>(
        context,
        builder: (ctx) => Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(title, style: SbText.title.copyWith(color: ctx.sb.tx)),
            const SizedBox(height: 12),
            GroupCard(children: [
              for (final x in values)
                InfoRow(
                  icon: SbIcons.droplet,
                  title: text(x),
                  trailing: x == current ? SbIcon(SbIcons.check, size: 18, color: ctx.sb.okText) : const SizedBox.shrink(),
                  onTap: () => Navigator.of(ctx).pop(x),
                ),
            ]),
          ],
        ),
      );
      if (v == null || v == current) return;
      try {
        await ref.read(devicesRepositoryProvider).update(detail.device.id, {'tank': {key: v}});
        ref.invalidate(deviceDetailProvider(detail.device.id));
        ref.read(toastProvider.notifier).show('Saved');
      } catch (e) {
        ref.read(toastProvider.notifier).show(ApiException.from(e).message, error: true);
      }
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SectionHeader('Water motor'),
        const SizedBox(height: 10),
        GroupCard(
          radius: 22,
          children: [
            InfoRow(
              icon: SbIcons.droplet,
              title: 'Start the motor by itself',
              subtitle: fill == 0 ? 'Never' : 'When the tank drops below $fill%',
              onTap: () => pick('Start the motor by itself', const [0, 20, 30, 40, 50, 60], fill, (v) => v == 0 ? 'Never' : 'Below $v%', 'fillBelowPct'),
            ),
            InfoRow(
              icon: SbIcons.check,
              title: 'Stop when full',
              subtitle: 'At $stop% — even without internet when the motor is on the same board',
              onTap: () => pick('Stop when full', const [80, 85, 90, 95, 100], stop, (v) => 'At $v%', 'stopAtPct'),
            ),
          ],
        ),
      ],
    );
  }
}

/// Owners and admins: which room it's in.
class _Room extends ConsumerWidget {
  const _Room({required this.detail});
  final DeviceDetail detail;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final d = detail.device;
    return GroupCard(
      radius: 22,
      children: [
        InfoRow(
          icon: SbIcons.rooms,
          title: 'Room: ${d.roomName ?? 'none yet'}',
          subtitle: 'Move it to another room',
          onTap: () => showMoveDevice(context, deviceId: d.id, name: d.name, roomId: d.roomId),
        ),
      ],
    );
  }
}

/// Moves a device to another room (owners and admins).
Future<void> showMoveDevice(BuildContext context, {required String deviceId, required String name, String? roomId}) => showSbSheet<void>(
      context,
      builder: (ctx) => Consumer(
        builder: (ctx, ref, _) {
          final c = ctx.sb;
          final rooms = ref.watch(roomsProvider).value ?? const [];
          Future<void> move(String? to) async {
            Navigator.of(ctx).pop();
            if (to == roomId) return;
            try {
              await ref.read(devicesRepositoryProvider).update(deviceId, {'roomId': to});
              await ref.read(devicesProvider.notifier).refresh();
              ref.invalidate(deviceDetailProvider(deviceId));
              ref.read(toastProvider.notifier).show(to == null ? '$name has no room now' : 'Moved to the ${rooms.where((r) => r.id == to).firstOrNull?.name.toLowerCase() ?? 'room'}');
            } catch (e) {
              ref.read(toastProvider.notifier).show(ApiException.from(e).message, error: true);
            }
          }

          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('Move $name', style: SbText.title.copyWith(color: c.tx)),
              const SizedBox(height: 4),
              Text('People see it with the room’s access.', style: TextStyle(fontSize: 14.5, color: c.mu)),
              const SizedBox(height: 12),
              GroupCard(
                children: [
                  for (final r in rooms)
                    InfoRow(
                      icon: SbIcons.rooms,
                      title: r.name,
                      trailing: r.id == roomId ? SbIcon(SbIcons.check, size: 18, color: c.okText) : const SizedBox.shrink(),
                      onTap: () => move(r.id),
                    ),
                  InfoRow(
                    icon: SbIcons.x,
                    title: 'No room',
                    subtitle: 'Only owners and admins see it',
                    trailing: roomId == null ? SbIcon(SbIcons.check, size: 18, color: c.okText) : const SizedBox.shrink(),
                    onTap: () => move(null),
                  ),
                ],
              ),
            ],
          );
        },
      ),
    );

/// What changed and why, newest first.
class _History extends ConsumerWidget {
  const _History({required this.detail});
  final DeviceDetail detail;

  static const _cause = {'remote': 'App or voice', 'button': 'Wall switch', 'boot': 'Board restarted', 'sensor': 'Reading', 'automation': 'Automation'};

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.sb;
    final rows = ref.watch(deviceRawHistoryProvider(detail.device.id));
    final list = rows.value;
    final d = detail.device;
    String what(Json h) {
      final s = asJson(h['state']);
      if (d.controllable) return s['on'] == true ? 'On' : 'Off';
      if (detail.stateFields.isEmpty) return s.values.join(' · ');
      return detail.stateFields.map((f) => '${s[f.key] ?? '–'}${f.unit}').join(' · ');
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SectionHeader('History'),
        const SizedBox(height: 10),
        if (list == null)
          rows.hasError ? ErrorView(error: rows.error!) : const LoadingView()
        else if (list.isEmpty)
          Text('Nothing recorded yet.', style: TextStyle(color: c.mu))
        else
          GroupCard(
            radius: 22,
            children: [
              for (final h in list.take(25))
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
                  child: Row(
                    children: [
                      if (d.controllable) ...[
                        Container(width: 8, height: 8, decoration: BoxDecoration(color: asJson(h['state'])['on'] == true ? c.on : c.switchOff, shape: BoxShape.circle)),
                        const SizedBox(width: 10),
                      ],
                      Expanded(child: Text(what(h), style: TextStyle(fontSize: 14.5, color: c.tx))),
                      Text(
                        '${strOrNull(h['by'])?.split(' ').first ?? _cause[str(h['source'])] ?? str(h['source'])} · ${dateOrNull(h['at']) == null ? '' : Fmt.when(dateOrNull(h['at'])!)}',
                        style: TextStyle(fontSize: 12.5, color: c.mu),
                      ),
                    ],
                  ),
                ),
            ],
          ),
      ],
    );
  }
}

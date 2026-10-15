import 'package:flutter/material.dart';

import '../../core/theme/sb_colors.dart';
import '../../core/theme/sb_icons.dart';
import '../../core/util/format.dart';
import '../../data/models/activity.dart';

/// "Living room bulb turned off" — in words, from an event.
String eventTitle(ActivityEvent e) {
  final name = e.deviceName.toLowerCase();
  final room = e.roomName;
  final what = room != null && !name.contains(room.toLowerCase()) ? '$room $name' : _cap(e.deviceName);
  if (e.on != null) return '$what turned ${e.on! ? 'on' : 'off'}';
  if (e.active != null) return e.active! ? '$what: triggered' : '$what: back to normal';
  return '$what changed';
}

/// "Zara · voice", "Wall switch", "Schedule".
String eventBy(ActivityEvent e) => switch (e.via) {
  EventVia.wall => 'Wall switch',
  EventVia.schedule => e.by != null ? '${e.by} · schedule' : 'Schedule',
  EventVia.board => 'Board restarted',
  EventVia.sensor => 'Sensor',
  _ => e.by != null ? '${e.by} · ${e.via.label}' : _cap(e.via.label),
};

(SbIconData, Color, Color) eventStyle(BuildContext context, EventVia via) {
  final c = context.sb;
  return switch (via) {
    EventVia.app => (SbIcons.smartphone, c.acSoft, c.acText),
    EventVia.voice => (SbIcons.mic, c.onSoft, c.onText),
    EventVia.wall => (SbIcons.toggle, c.sf2, c.tx),
    EventVia.schedule => (SbIcons.clock, c.okSoft, c.okText),
    EventVia.board => (SbIcons.pulse, c.badSoft, c.badText),
    EventVia.sensor => (SbIcons.pulse, c.sf2, c.mu),
  };
}

/// A compact row (Home's "Just now").
class ActivityRow extends StatelessWidget {
  const ActivityRow({super.key, required this.event});
  final ActivityEvent event;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final (icon, _, _) = eventStyle(context, event.via);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        children: [
          Container(
            width: 34,
            height: 34,
            decoration: BoxDecoration(color: c.sf2, shape: BoxShape.circle),
            child: Center(child: SbIcon(icon, size: 16, color: c.mu)),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  eventTitle(event),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w500,
                    color: c.tx,
                  ),
                ),
                Text(
                  eventBy(event),
                  style: TextStyle(fontSize: 12.5, color: c.mu),
                ),
              ],
            ),
          ),
          Text(
            Fmt.when(event.at),
            style: TextStyle(fontSize: 12.5, color: c.mu),
          ),
        ],
      ),
    );
  }
}

String _cap(String s) => s.isEmpty ? s : s[0].toUpperCase() + s.substring(1);

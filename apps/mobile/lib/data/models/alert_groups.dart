import 'people.dart';

/// The notification settings (`/notifications/prefs`) in topics people recognise. Every kind the
/// server offers lands in a group — new kinds the app doesn't know yet go to "Other" — so nothing the
/// web lets you switch is missing on the phone.
const alertTopics = <(String, List<String>)>[
  ('Safety at home', ['leak', 'doorAtNight', 'motionAtNight', 'temperature', 'awayAlert', 'security']),
  ('Power and electricity', ['powerCut', 'ups', 'cutSoon', 'bill', 'meterReading']),
  ('Boards, timers and rules', ['boardOffline', 'boardHealth', 'boardReplaced', 'scheduleFailed', 'automation', 'tank', 'tankLevel']),
  ('People', ['presence', 'accessEnded']),
  ('Summaries', ['weeklySummary', 'dailySummary', 'summaryEmail']),
  ('Bills and help', ['billing', 'installation', 'ticketReply']),
];

/// Kinds only the company's team gets (the server also offers them to home owners and admins).
const staffAlertKinds = {'boardDown', 'backup', 'firmware', 'supportRequest', 'contractEnding', 'stockLow', 'quoteAnswered', 'newJob'};

/// [prefs] in [alertTopics] order; the staff kinds as "For the team" only for staff; unknown ones in "Other".
List<(String, List<NotificationPref>)> groupAlerts(List<NotificationPref> prefs, {required bool staff}) {
  final out = <(String, List<NotificationPref>)>[];
  final placed = <String>{};
  for (final (title, keys) in alertTopics) {
    final list = [for (final k in keys) ...prefs.where((p) => p.key == k)];
    placed.addAll(keys);
    if (list.isNotEmpty) out.add((title, list));
  }
  placed.addAll(staffAlertKinds);
  if (staff) {
    final team = prefs.where((p) => staffAlertKinds.contains(p.key)).toList();
    if (team.isNotEmpty) out.add(('For the team', team));
  }
  final other = prefs.where((p) => !placed.contains(p.key)).toList();
  if (other.isNotEmpty) out.add(('Other', other));
  return out;
}

/// "12 of 20 on" for the Me row (staff kinds count only for staff).
String alertsSummary(List<NotificationPref> prefs, {required bool staff}) {
  final shown = groupAlerts(prefs, staff: staff).expand((g) => g.$2).toList();
  if (shown.isEmpty) return '';
  final on = shown.where((p) => p.enabled).length;
  return on == shown.length ? 'All on' : on == 0 ? 'All off' : '$on of ${shown.length} on';
}

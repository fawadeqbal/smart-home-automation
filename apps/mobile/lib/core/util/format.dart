import 'package:intl/intl.dart';

/// Times and dates the way the design writes them: 24-hour clock, short and friendly.
abstract final class Fmt {
  static String clock(DateTime t) => DateFormat('HH:mm').format(t);
  static String weekday(DateTime t) => DateFormat('EEEE').format(t);

  static String greeting(DateTime t) => switch (t.hour) {
    < 5 => 'Good night',
    < 12 => 'Good morning',
    < 17 => 'Good afternoon',
    < 22 => 'Good evening',
    _ => 'Good night',
  };

  /// "Today", "Yesterday", "Monday" (this week) or "12 Oct".
  static String day(DateTime t, [DateTime? now]) {
    final n = now ?? DateTime.now();
    final d = DateTime(t.year, t.month, t.day);
    final today = DateTime(n.year, n.month, n.day);
    final diff = today.difference(d).inDays;
    if (diff == 0) return 'Today';
    if (diff == 1) return 'Yesterday';
    if (diff < 7) return DateFormat('EEEE').format(t);
    return DateFormat('d MMM').format(t);
  }

  /// "20:52" today, "Yesterday 20:52", "12 Oct 20:52".
  static String when(DateTime t, [DateTime? now]) {
    final d = day(t, now);
    return d == 'Today' ? clock(t) : '$d ${clock(t)}';
  }

  /// "Now", "4 min ago", "2 h ago", then [when].
  static String ago(DateTime t, [DateTime? now]) {
    final s = (now ?? DateTime.now()).difference(t).inSeconds;
    if (s < 45) return 'Now';
    if (s < 3600) return '${(s / 60).round()} min ago';
    if (s < 6 * 3600) return '${(s / 3600).floor()} h ago';
    return when(t, now);
  }

  /// "in 25 min", "in 1 h 40 min", "tomorrow 05:00", "Thursday 07:00".
  static String until(DateTime t, [DateTime? now]) {
    final n = now ?? DateTime.now();
    final mins = t.difference(n).inMinutes;
    if (mins < 1) return 'in a moment';
    if (mins < 60) return 'in $mins min';
    if (mins < 12 * 60) {
      final h = mins ~/ 60, m = mins % 60;
      return m == 0 ? 'in $h h' : 'in $h h $m min';
    }
    final d = day(t, n);
    if (d == 'Today') return 'today ${clock(t)}';
    final tomorrow = DateTime(n.year, n.month, n.day + 1);
    if (t.year == tomorrow.year && t.month == tomorrow.month && t.day == tomorrow.day) return 'tomorrow ${clock(t)}';
    return '${DateFormat(t.difference(n).inDays < 7 ? 'EEEE' : 'd MMM').format(t)} ${clock(t)}';
  }

  /// "15 min", "1 hour", "2 hours".
  static String minutes(int m) => m < 60
      ? '$m min'
      : m == 60
      ? '1 hour'
      : m % 60 == 0
      ? '${m ~/ 60} hours'
      : '${m ~/ 60} h ${m % 60} min';

  static const dayShort = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  static const dayLetter = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  /// "Every day", "Weekdays", "Mon & Thu", "Mon, Wed, Fri".
  static String days(List<int> days) {
    final d = days.toSet().toList()..sort();
    if (d.isEmpty || d.length == 7) return 'Every day';
    if (d.length == 5 && d.every((x) => x >= 1 && x <= 5)) return 'Weekdays';
    if (d.length == 2 && d.contains(0) && d.contains(6)) return 'Weekends';
    final names = d.map((i) => dayShort[i]).toList();
    return names.length == 2 ? '${names[0]} & ${names[1]}' : names.join(', ');
  }

  static String plural(int n, String one, [String? many]) => '$n ${n == 1 ? one : (many ?? '${one}s')}';
}

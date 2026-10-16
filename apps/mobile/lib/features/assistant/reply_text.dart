import 'package:flutter/material.dart';

/// The assistant writes light Markdown for the chat: **bold** for screen and button names,
/// "- " lists and numbered steps. The phone shows it formatted; other signs are dropped.

final _link = RegExp(r'\[([^\]]+)\]\([^)]*\)');
final _heading = RegExp(r'^\s*#{1,6}\s+');
final _bullet = RegExp(r'^(\s*)[-*+]\s+');
final _bold = RegExp(r'\*\*(.+?)\*\*|__(.+?)__');

/// The reply on one line without Markdown signs: for the notification and the hands-free card.
String plainReply(String text) {
  final lines = <String>[];
  for (var line in text.replaceAllMapped(_link, (m) => m[1] ?? '').split('\n')) {
    line = line
        .replaceFirst(_heading, '')
        .replaceFirst(_bullet, '')
        .replaceAll(RegExp(r'[*`]'), '')
        .trim();
    if (line.isNotEmpty) lines.add(line);
  }
  return lines.join(' ');
}

/// A reply in a chat bubble: bold as bold, list items as bullets, steps kept on their own lines.
class ReplyText extends StatelessWidget {
  const ReplyText(this.text, {super.key, required this.style});

  final String text;
  final TextStyle style;

  static const _strong = TextStyle(fontWeight: FontWeight.w700);

  @override
  Widget build(BuildContext context) {
    final spans = <InlineSpan>[];
    var blank = false;
    for (final raw in text.replaceAllMapped(_link, (m) => m[1] ?? '').split('\n')) {
      var line = raw.trimRight();
      if (line.trim().isEmpty) {
        blank = true;
        continue;
      }
      if (spans.isNotEmpty) spans.add(TextSpan(text: blank ? '\n\n' : '\n'));
      blank = false;
      final heading = _heading.hasMatch(line);
      line = line.replaceFirst(_heading, '');
      final bullet = _bullet.firstMatch(line);
      if (bullet != null) {
        line = '${bullet[1] ?? ''}•  ${line.substring(bullet.end)}';
      }
      spans.addAll(_inline(line, heading));
    }
    return Text.rich(TextSpan(style: style, children: spans));
  }

  List<InlineSpan> _inline(String line, bool allBold) {
    final out = <InlineSpan>[];
    var last = 0;
    for (final m in _bold.allMatches(line)) {
      if (m.start > last) {
        out.add(TextSpan(text: _tidy(line.substring(last, m.start)), style: allBold ? _strong : null));
      }
      out.add(TextSpan(text: _tidy(m[1] ?? m[2] ?? ''), style: _strong));
      last = m.end;
    }
    if (last < line.length) {
      out.add(TextSpan(text: _tidy(line.substring(last)), style: allBold ? _strong : null));
    }
    return out;
  }

  static String _tidy(String s) => s.replaceAll('`', '');
}

import 'package:flutter/material.dart';

import '../../core/theme/app_theme.dart';
import '../../core/theme/sb_colors.dart';

/// A Markdown block, as the Help Center's articles use them.
sealed class MdBlock {
  const MdBlock();
}

class MdHeading extends MdBlock {
  const MdHeading(this.level, this.text);
  final int level;
  final String text;
}

class MdParagraph extends MdBlock {
  const MdParagraph(this.text);
  final String text;
}

class MdList extends MdBlock {
  const MdList(this.items, {this.numbered = false});
  final List<String> items;
  final bool numbered;
}

class MdQuote extends MdBlock {
  const MdQuote(this.text);
  final String text;
}

class MdCode extends MdBlock {
  const MdCode(this.text);
  final String text;
}

class MdTable extends MdBlock {
  const MdTable(this.rows);
  final List<List<String>> rows;
}

/// Splits Markdown into blocks: headings, paragraphs, lists, quotes, code and tables. Enough for help
/// articles; anything else reads as a paragraph.
List<MdBlock> parseMarkdown(String md) {
  final lines = md.replaceAll('\r\n', '\n').split('\n');
  final out = <MdBlock>[];
  final para = <String>[];
  void flush() {
    if (para.isNotEmpty) out.add(MdParagraph(para.join(' ').trim()));
    para.clear();
  }

  final bullet = RegExp(r'^\s{0,3}[-*+]\s+(.*)$');
  final number = RegExp(r'^\s{0,3}\d+[.)]\s+(.*)$');
  var i = 0;
  while (i < lines.length) {
    final line = lines[i];
    final t = line.trim();
    if (t.isEmpty) {
      flush();
      i++;
    } else if (t.startsWith('```')) {
      flush();
      final code = <String>[];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        code.add(lines[i]);
        i++;
      }
      i++;
      out.add(MdCode(code.join('\n')));
    } else if (RegExp(r'^#{1,6}\s').hasMatch(t)) {
      flush();
      final level = t.indexOf(' ');
      out.add(MdHeading(level, t.substring(level).trim()));
      i++;
    } else if (bullet.hasMatch(line) || number.hasMatch(line)) {
      flush();
      final numbered = number.hasMatch(line);
      final items = <String>[];
      while (i < lines.length) {
        final m = (numbered ? number : bullet).firstMatch(lines[i]);
        if (m != null) {
          items.add(m.group(1)!.trim());
        } else if (lines[i].trim().isNotEmpty && items.isNotEmpty && lines[i].startsWith('  ')) {
          items[items.length - 1] = '${items.last} ${lines[i].trim()}';
        } else {
          break;
        }
        i++;
      }
      out.add(MdList(items, numbered: numbered));
    } else if (t.startsWith('>')) {
      flush();
      final q = <String>[];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        q.add(lines[i].trim().substring(1).trim());
        i++;
      }
      out.add(MdQuote(q.join(' ')));
    } else if (t.startsWith('|')) {
      flush();
      final rows = <List<String>>[];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        final cells = lines[i].trim().split('|').map((s) => s.trim()).toList();
        if (cells.isNotEmpty && cells.first.isEmpty) cells.removeAt(0);
        if (cells.isNotEmpty && cells.last.isEmpty) cells.removeLast();
        if (!cells.every((c) => RegExp(r'^:?-{2,}:?$').hasMatch(c))) rows.add(cells);
        i++;
      }
      out.add(MdTable(rows));
    } else {
      para.add(t);
      i++;
    }
  }
  flush();
  return out;
}

/// Inline Markdown as spans: **bold**, *italic*, `code`, [links](…) (shown as text), [[check: …]].
List<InlineSpan> inlineSpans(String text, {required Color link, required Color codeBg}) {
  final out = <InlineSpan>[];
  final re = RegExp(r'\*\*(.+?)\*\*|__(.+?)__|\*(.+?)\*|_(.+?)_|`([^`]+)`|\[([^\]]+)\]\([^)]*\)|\[\[check:([^\]]*)\]\]');
  var at = 0;
  for (final m in re.allMatches(text)) {
    if (m.start > at) out.add(TextSpan(text: text.substring(at, m.start)));
    if (m.group(1) != null || m.group(2) != null) {
      out.add(TextSpan(children: inlineSpans(m.group(1) ?? m.group(2)!, link: link, codeBg: codeBg), style: const TextStyle(fontWeight: FontWeight.w600)));
    } else if (m.group(3) != null || m.group(4) != null) {
      out.add(TextSpan(text: m.group(3) ?? m.group(4), style: const TextStyle(fontStyle: FontStyle.italic)));
    } else if (m.group(5) != null) {
      out.add(TextSpan(text: m.group(5), style: TextStyle(fontFamily: SbFonts.mono, fontSize: 13.5, backgroundColor: codeBg)));
    } else if (m.group(6) != null) {
      out.add(TextSpan(text: m.group(6), style: TextStyle(color: link, fontWeight: FontWeight.w500)));
    } else {
      out.add(TextSpan(text: m.group(7)!.trim()));
    }
    at = m.end;
  }
  if (at < text.length) out.add(TextSpan(text: text.substring(at)));
  return out;
}

/// An article's Markdown, in the app's type.
class MarkdownText extends StatelessWidget {
  const MarkdownText(this.markdown, {super.key});
  final String markdown;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final body = TextStyle(fontSize: 15.5, height: 1.55, color: c.tx);
    Text rich(String s, [TextStyle? style]) => Text.rich(TextSpan(children: inlineSpans(s, link: c.acText, codeBg: c.sf2)), style: style ?? body);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final b in parseMarkdown(markdown))
          Padding(
            padding: EdgeInsets.only(bottom: b is MdHeading ? 6 : 12, top: b is MdHeading ? 8 : 0),
            child: switch (b) {
              MdHeading(:final level, :final text) => rich(text, TextStyle(fontSize: level <= 2 ? 19 : 16.5, fontWeight: FontWeight.w600, height: 1.3, color: c.tx)),
              MdParagraph(:final text) => rich(text),
              MdList(:final items, :final numbered) => Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    for (final (i, item) in items.indexed)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 6),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            SizedBox(width: 24, child: Text(numbered ? '${i + 1}.' : '•', style: body.copyWith(color: c.mu))),
                            Expanded(child: rich(item)),
                          ],
                        ),
                      ),
                  ],
                ),
              MdQuote(:final text) => Container(
                  padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
                  decoration: BoxDecoration(color: c.acSoft, borderRadius: BorderRadius.circular(12)),
                  child: rich(text),
                ),
              MdCode(:final text) => Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(color: c.sf2, borderRadius: BorderRadius.circular(12)),
                  child: Text(text, style: TextStyle(fontFamily: SbFonts.mono, fontSize: 13, color: c.tx, height: 1.4)),
                ),
              MdTable(:final rows) => Container(
                  decoration: BoxDecoration(border: Border.all(color: c.ln2), borderRadius: BorderRadius.circular(12)),
                  child: Column(
                    children: [
                      for (final (i, r) in rows.indexed)
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                          decoration: BoxDecoration(
                            color: i == 0 ? c.sf2 : null,
                            border: i == 0 ? null : Border(top: BorderSide(color: c.ln)),
                          ),
                          child: Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              for (final cell in r)
                                Expanded(child: rich(cell, body.copyWith(fontSize: 14, fontWeight: i == 0 ? FontWeight.w600 : FontWeight.w400, height: 1.35))),
                            ],
                          ),
                        ),
                    ],
                  ),
                ),
            },
          ),
      ],
    );
  }
}

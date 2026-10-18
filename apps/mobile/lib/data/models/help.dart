import 'package:flutter/foundation.dart';

import 'json.dart';

/// One Help Center article (`/help/feed?articles=1&view=customer`), Markdown in [body].
@immutable
class HelpArticle {
  const HelpArticle({required this.id, required this.title, this.category = 'USAGE', this.tags = const [], this.body = '', this.updatedAt});

  factory HelpArticle.fromJson(Json j) => HelpArticle(
        id: str(j['id']),
        title: str(j['title'], 'Article'),
        category: str(j['category'], 'USAGE'),
        tags: strList(j['tags']),
        body: str(j['body']),
        updatedAt: dateOrNull(j['updatedAt']),
      );

  final String id, title, category;
  final List<String> tags;
  final String body;
  final DateTime? updatedAt;
}

/// A Help Center section, as the web names them (lib/help.ts).
@immutable
class HelpSection {
  const HelpSection(this.id, this.label, this.blurb);
  final String id, label, blurb;
}

const helpSections = [
  HelpSection('USAGE', 'Using it', 'Switching, timers, scenes, family, the assistant'),
  HelpSection('TROUBLESHOOTING', 'Problems', 'Something isn’t working? Start here'),
  HelpSection('PROCESS', 'How we work', 'Visits, installation day, support'),
  HelpSection('POLICY', 'Policies', 'Warranty, charges, refunds, privacy'),
  HelpSection('FAQ', 'Questions', 'Short answers to common questions'),
];

HelpSection helpSection(String id) => helpSections.firstWhere((s) => s.id == id, orElse: () => helpSections.first);

final _checks = RegExp(r'\[\[check:([^\]]*)\]\]');

/// Article text without Markdown signs, for snippets and search (like the web's `plainText`).
String plainText(String md) => md
    .replaceAllMapped(_checks, (m) => m.group(1)!.trim())
    .replaceAll(RegExp(r'```[\s\S]*?```'), ' ')
    .replaceAll(RegExp(r'!\[[^\]]*\]\([^)]*\)'), ' ')
    .replaceAllMapped(RegExp(r'\[([^\]]+)\]\([^)]*\)'), (m) => m.group(1)!)
    .replaceAll(RegExp(r'^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+', multiLine: true), '')
    .replaceAll('|', ' ')
    .replaceAll(RegExp(r'[*_`~]+'), '')
    .replaceAll(RegExp(r'^\s*:?-{3,}:?\s*$', multiLine: true), ' ')
    .replaceAll(RegExp(r'\s+'), ' ')
    .trim();

String _norm(String s) => s.toLowerCase();

/// ~180 characters of the article around the first matching word.
String snippet(String text, [List<String> words = const []]) {
  final low = _norm(text);
  final hits = words.map(low.indexOf).where((i) => i >= 0).toList()..sort();
  final at = hits.isEmpty ? 0 : hits.first;
  final start = at - 60 < 0 ? 0 : at - 60;
  final end = start + 180 > text.length ? text.length : start + 180;
  return '${start > 0 ? '…' : ''}${text.substring(start, end)}${end < text.length ? '…' : ''}';
}

/// Simple ranked search, like the web's: every word must appear somewhere; titles and keywords count
/// most (they carry the words people use, Roman Urdu included).
List<(HelpArticle, String)> searchHelp(List<HelpArticle> articles, String query) {
  final words = _norm(query).split(RegExp(r'[^\p{L}\p{N}]+', unicode: true)).where((w) => w.length > 1).toList();
  if (words.isEmpty) return const [];
  final scored = <(HelpArticle, int, String)>[];
  for (final a in articles) {
    final title = _norm(a.title), tags = _norm(a.tags.join(' ')), text = plainText(a.body), low = _norm(text);
    var score = 0;
    var all = true;
    for (final w in words) {
      final s = (title.contains(w) ? 6 : 0) + (tags.contains(w) ? 4 : 0) + (low.contains(w) ? 1 : 0);
      if (s == 0) {
        all = false;
        break;
      }
      score += s;
    }
    if (all) scored.add((a, score, snippet(text, words)));
  }
  scored.sort((x, y) => y.$2.compareTo(x.$2));
  return [for (final s in scored) (s.$1, s.$3)];
}

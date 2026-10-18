import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../core/routing/routes.dart';
import '../../core/theme/app_theme.dart';
import '../../core/theme/sb_colors.dart';
import '../../core/theme/sb_icons.dart';
import '../../core/theme/sb_icons_more.dart';
import '../../data/models/help.dart';
import '../../data/repositories/help_repository.dart';
import '../../shared/widgets/common.dart';
import '../../shared/widgets/markdown_text.dart';
import '../../shared/widgets/pill.dart';
import '../../state/session.dart';
import '../health/ask_for_help.dart';

SbIconData _sectionIcon(String id) => switch (id) {
      'TROUBLESHOOTING' => MoreIcons.lifebuoy,
      'PROCESS' => SbIcons.users,
      'POLICY' => SbIcons.shield,
      'FAQ' => MoreIcons.question,
      _ => SbIcons.lightbulb,
    };

/// The Help Center, like the web's /help: search, the sections with their articles, one section.
class HelpCenterScreen extends ConsumerStatefulWidget {
  const HelpCenterScreen({super.key});

  @override
  ConsumerState<HelpCenterScreen> createState() => _HelpCenterScreenState();
}

class _HelpCenterScreenState extends ConsumerState<HelpCenterScreen> {
  final _q = TextEditingController();
  String? _section;

  @override
  void dispose() {
    _q.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final articles = ref.watch(helpArticlesProvider);
    final q = _q.text.trim();
    return RefreshIndicator(
      color: c.on,
      onRefresh: () => ref.refresh(helpArticlesProvider.future),
      child: ListView(
        padding: EdgeInsets.fromLTRB(18, MediaQuery.paddingOf(context).top + 4, 18, 130),
        children: [
          BackPill(onTap: () => _section != null && q.isEmpty ? setState(() => _section = null) : context.pop()),
          const SizedBox(height: 12),
          PageTitle(_section == null ? 'How can we help?' : helpSection(_section!).label, subtitle: _section == null ? 'Search the Help Center, or pick a topic.' : helpSection(_section!).blurb),
          const SizedBox(height: 16),
          TextField(
            controller: _q,
            textInputAction: TextInputAction.search,
            onChanged: (_) => setState(() {}),
            style: TextStyle(fontSize: 15.5, color: c.tx),
            decoration: InputDecoration(
              hintText: 'Search: offline board, add family, batti…',
              prefixIcon: Padding(padding: const EdgeInsets.only(left: 14, right: 10), child: SbIcon(MoreIcons.search, size: 18, color: c.mu)),
              prefixIconConstraints: const BoxConstraints(minWidth: 42),
              suffixIcon: q.isEmpty
                  ? null
                  : IconButton(
                      tooltip: 'Clear',
                      onPressed: () => setState(_q.clear),
                      icon: SbIcon(SbIcons.x, size: 16, color: c.mu),
                    ),
            ),
          ),
          const SizedBox(height: 18),
          articles.when(
            loading: () => const LoadingView(label: 'Loading help…'),
            error: (e, _) => ErrorView(error: e, onRetry: () => ref.invalidate(helpArticlesProvider)),
            data: (list) {
              if (list.isEmpty) {
                return const EmptyView(icon: MoreIcons.book, title: 'The Help Center is being written', text: 'Ask the assistant, or send a help request from Me.');
              }
              if (q.isNotEmpty) return _Results(articles: list, q: q);
              if (_section != null) return _Section(articles: list.where((a) => a.category == _section).toList());
              return _Sections(articles: list, onSection: (id) => setState(() => _section = id));
            },
          ),
          const SizedBox(height: 22),
          const AskLine(),
        ],
      ),
    );
  }
}

class _Sections extends StatelessWidget {
  const _Sections({required this.articles, required this.onSection});
  final List<HelpArticle> articles;
  final ValueChanged<String> onSection;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final s in helpSections)
          if (articles.any((a) => a.category == s.id)) ...[
            GroupCard(
              radius: 22,
              children: [
                InfoRow(
                  icon: _sectionIcon(s.id),
                  tint: (c.acSoft, c.acText),
                  title: s.label,
                  subtitle: s.blurb,
                  trailing: Pill('${articles.where((a) => a.category == s.id).length}'),
                  onTap: () => onSection(s.id),
                ),
                for (final a in articles.where((a) => a.category == s.id).take(3)) _ArticleLink(article: a),
              ],
            ),
            const SizedBox(height: 12),
          ],
      ],
    );
  }
}

class _Section extends StatelessWidget {
  const _Section({required this.articles});
  final List<HelpArticle> articles;

  @override
  Widget build(BuildContext context) => articles.isEmpty
      ? const EmptyView(icon: MoreIcons.book, title: 'Nothing here yet')
      : GroupCard(radius: 22, children: [for (final a in articles) _ArticleLink(article: a, snippet: snippet(plainText(a.body)))]);
}

class _Results extends StatelessWidget {
  const _Results({required this.articles, required this.q});
  final List<HelpArticle> articles;
  final String q;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final hits = searchHelp(articles, q);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(hits.isEmpty ? 'Nothing found for “$q”' : '${hits.length} article${hits.length == 1 ? '' : 's'} for “$q”', style: SbText.cardTitle.copyWith(color: c.tx)),
        const SizedBox(height: 10),
        if (hits.isEmpty)
          Text('Try other words, or ask the assistant: it understands whole questions, also in Urdu.', style: TextStyle(fontSize: 14, color: c.mu))
        else
          GroupCard(radius: 22, children: [for (final (a, s) in hits) _ArticleLink(article: a, snippet: s)]),
      ],
    );
  }
}

class _ArticleLink extends StatelessWidget {
  const _ArticleLink({required this.article, this.snippet});
  final HelpArticle article;
  final String? snippet;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    return InkWell(
      onTap: () => context.openInTab(Routes.articleOf(article.id)),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 12, 12, 12),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(article.title, style: TextStyle(fontSize: 15, fontWeight: FontWeight.w500, color: c.tx)),
                  if (snippet != null) ...[
                    const SizedBox(height: 2),
                    Text(snippet!, maxLines: 2, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 13, color: c.mu, height: 1.35)),
                  ],
                ],
              ),
            ),
            const SizedBox(width: 6),
            SbIcon(SbIcons.caretRight, size: 15, color: c.mu),
          ],
        ),
      ),
    );
  }
}

/// "Didn't find it?": the assistant, or a help request (not for read-only support looking in).
class AskLine extends ConsumerWidget {
  const AskLine({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.sb;
    final readOnly = ref.watch(meProvider.select((m) => m.home?.readOnly ?? true));
    if (readOnly) return const SizedBox.shrink();
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: c.sf2, borderRadius: BorderRadius.circular(20)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Didn’t find it?', style: TextStyle(fontSize: 15.5, fontWeight: FontWeight.w600, color: c.tx)),
          const SizedBox(height: 4),
          Text('Ask the assistant in your own words, or send a help request to your installer’s team.', style: TextStyle(fontSize: 13.5, color: c.mu, height: 1.35)),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(child: BigButton(label: 'Ask', icon: SbIcons.mic, height: 46, onTap: () => context.push(Routes.ask))),
              const SizedBox(width: 8),
              Expanded(child: BigButton(label: 'Help request', icon: SbIcons.envelope, height: 46, color: c.sf, foreground: c.tx, onTap: () => showHelpRequests(context))),
            ],
          ),
        ],
      ),
    );
  }
}

/// One article, like the web's /help/:id.
class HelpArticleScreen extends ConsumerWidget {
  const HelpArticleScreen({super.key, required this.articleId});
  final String articleId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.sb;
    final articles = ref.watch(helpArticlesProvider);
    final list = articles.value;
    final a = list?.where((x) => x.id == articleId).firstOrNull;
    final related = a == null ? const <HelpArticle>[] : list!.where((x) => x.category == a.category && x.id != a.id).take(5).toList();
    return ListView(
      padding: EdgeInsets.fromLTRB(18, MediaQuery.paddingOf(context).top + 4, 18, 130),
      children: [
        BackPill(onTap: () => context.pop()),
        const SizedBox(height: 16),
        if (list == null)
          articles.hasError ? ErrorView(error: articles.error!, onRetry: () => ref.invalidate(helpArticlesProvider)) : const LoadingView(label: 'Loading the article…')
        else if (a == null)
          const EmptyView(icon: MoreIcons.book, title: 'This article isn’t available', text: 'It may have been moved or taken down.')
        else ...[
          Text(helpSection(a.category).label.toUpperCase(), style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, letterSpacing: .3, color: c.acText)),
          const SizedBox(height: 6),
          Text(a.title, style: SbText.title.copyWith(color: c.tx, fontSize: 26, height: 1.2)),
          if (a.updatedAt != null) ...[
            const SizedBox(height: 4),
            Text('Updated ${DateFormat('d MMMM y').format(a.updatedAt!)}', style: TextStyle(fontSize: 13, color: c.mu)),
          ],
          const SizedBox(height: 16),
          MarkdownText(a.body),
          const SizedBox(height: 12),
          const AskLine(),
          if (related.isNotEmpty) ...[
            const SizedBox(height: 22),
            GroupLabel('More in ${helpSection(a.category).label}'),
            GroupCard(radius: 22, children: [for (final r in related) _ArticleLink(article: r)]),
          ],
        ],
      ],
    );
  }
}

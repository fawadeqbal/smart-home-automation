import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme/app_theme.dart';
import '../../core/theme/sb_colors.dart';
import '../../core/theme/sb_icons.dart';
import '../../data/models/work/homes.dart';
import '../../shared/widgets/common.dart';
import '../../shared/widgets/pressable.dart';
import '../../shared/widgets/sb_chip.dart';
import '../../state/work.dart';
import 'work_icons.dart';
import 'work_routes.dart';
import 'work_widgets.dart';

/// The homes this person looks after (installers: the ones assigned to them), with how each is doing.
class HomesScreen extends ConsumerStatefulWidget {
  const HomesScreen({super.key});

  @override
  ConsumerState<HomesScreen> createState() => _HomesScreenState();
}

class _HomesScreenState extends ConsumerState<HomesScreen> {
  final _search = TextEditingController();
  String _filter = 'all';

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  bool _in(HomeRow h, String f) => f == 'all' ? h.status != 'archived' : h.status == f;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final rights = ref.watch(workRightsProvider);
    final homes = ref.watch(workHomesProvider);
    final list = homes.value;
    final installer = rights?.isInstaller ?? false;
    final shown = (list ?? const <HomeRow>[]).where((h) => _in(h, _filter) && h.matches(_search.text)).toList();
    int n(String f) => (list ?? const <HomeRow>[]).where((h) => _in(h, f)).length;

    return WorkPage(
      back: false,
      onRefresh: () => ref.refresh(workHomesProvider.future),
      children: [
        PageTitle(
          installer ? 'My homes' : 'Homes',
          subtitle: installer
              ? 'Homes you’re installing or looking after.'
              : list == null
              ? 'Every customer’s home.'
              : '${n('all')} homes · ${n('attention')} need a look · ${n('setup')} being installed',
        ),
        const SizedBox(height: 14),
        TextField(
          controller: _search,
          onChanged: (_) => setState(() {}),
          textInputAction: TextInputAction.search,
          decoration: InputDecoration(
            hintText: 'Search by name, owner or city',
            prefixIcon: Padding(
              padding: const EdgeInsets.only(left: 12, right: 6),
              child: SbIcon(WorkIcons.search, size: 18, color: c.mu),
            ),
            prefixIconConstraints: const BoxConstraints(minWidth: 36),
          ),
        ),
        const SizedBox(height: 10),
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Row(
            children: [
              for (final (f, label) in [
                ('all', 'All'),
                ('attention', 'Needs a look'),
                ('setup', 'Installing'),
                ('live', 'Live'),
                if (n('archived') > 0) ('archived', 'Archived'),
              ])
                Padding(
                  padding: const EdgeInsets.only(right: 6),
                  child: SbChip(
                    label: list == null ? label : '$label ${n(f)}',
                    height: 34,
                    selected: _filter == f,
                    onTap: () => setState(() => _filter = f),
                  ),
                ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        if (list == null && homes.hasError)
          ErrorView(error: homes.error!, onRetry: () => ref.invalidate(workHomesProvider))
        else if (list == null)
          const LoadingView(label: 'Loading homes…')
        else if (list.isEmpty)
          EmptyView(
            icon: SbIcons.house,
            title: 'No homes yet',
            text: installer
                ? 'No homes are assigned to you yet. Your administrator assigns homes to installers.'
                : 'Homes are created in the web console.',
          )
        else if (shown.isEmpty)
          EmptyView(
            icon: WorkIcons.search,
            title: 'No homes match',
            text: _search.text.isEmpty ? null : 'Nothing called “${_search.text.trim()}”.',
          )
        else
          for (final h in shown)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: _HomeCard(home: h, showInstaller: !installer),
            ),
      ],
    );
  }
}

class _HomeCard extends StatelessWidget {
  const _HomeCard({required this.home, required this.showInstaller});
  final HomeRow home;
  final bool showInstaller;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final h = home;
    final tone = toneColors(context, h.tone);
    final facts = [
      if (h.city.isNotEmpty) h.city,
      if (h.owner != null) '${h.owner}${h.ownerPending ? ' (invited)' : ''}',
      if (showInstaller && h.installer != null) 'Installer ${h.installer}',
    ];
    return Pressable(
      scale: .98,
      onTap: () => context.openWork(WorkRoutes.home(h.id)),
      child: WorkCard(
        padding: const EdgeInsets.all(14),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 44,
              height: 44,
              decoration: BoxDecoration(color: tone.bg, borderRadius: BorderRadius.circular(14)),
              child: Center(
                child: SbIcon(SbIcons.house, size: 22, color: tone.fg, weight: IconWeight.duotone),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        child: Text(
                          h.name,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: SbText.cardTitle.copyWith(fontSize: 16, color: c.tx),
                        ),
                      ),
                      const SizedBox(width: 8),
                      ToneBadge(h.badge, h.tone),
                    ],
                  ),
                  if (facts.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 3),
                      child: Text(
                        facts.join(' · '),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(fontSize: 13.5, color: c.mu, height: 1.3),
                      ),
                    ),
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 12,
                    runSpacing: 4,
                    children: [
                      _Fact(
                        icon: WorkIcons.cpu,
                        text: h.boardsInstalled == 0 && h.boardsTotal == 0
                            ? 'No boards yet'
                            : '${h.boardsOnline} of ${h.boardsInstalled} boards online',
                        warn: h.boardsOnline < h.boardsInstalled,
                      ),
                      if (h.boardsWaiting > 0)
                        _Fact(
                          icon: WorkIcons.package,
                          text: '${h.boardsWaiting} new board${h.boardsWaiting == 1 ? '' : 's'} to install',
                          info: true,
                        ),
                      if (h.status == 'setup') _Fact(icon: WorkIcons.checklist, text: 'Setup ${h.steps} of 6'),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Fact extends StatelessWidget {
  const _Fact({required this.icon, required this.text, this.warn = false, this.info = false});
  final SbIconData icon;
  final String text;
  final bool warn, info;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final color = warn
        ? c.onText
        : info
        ? c.acText
        : c.mu;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        SbIcon(icon, size: 14, color: color),
        const SizedBox(width: 4),
        Text(
          text,
          style: TextStyle(fontSize: 13, color: color, fontWeight: warn || info ? FontWeight.w600 : FontWeight.w400),
        ),
      ],
    );
  }
}

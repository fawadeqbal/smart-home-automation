import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme/app_theme.dart';
import '../../core/theme/sb_colors.dart';
import '../../core/theme/sb_icons.dart';
import '../../core/util/format.dart';
import '../../data/models/json.dart';
import '../../data/models/work/board.dart';
import '../../data/repositories/work_repository.dart';
import '../../shared/widgets/common.dart';
import '../../state/work.dart';
import 'work_icons.dart';
import 'work_widgets.dart';

/// Updates over Wi-Fi need this firmware (or newer) on the board.
const otaFrom = '2.2';

enum FwStage { sent, restarting, done, failed }

@immutable
class FirmwareJob {
  const FirmwareJob({
    required this.version,
    required this.stage,
    required this.since,
    this.error,
    this.failedLate = false,
  });
  final String version;
  final FwStage stage;
  final DateTime since;
  final String? error;

  /// It failed after the restart: the board came back on another version.
  final bool failedLate;

  bool get running => stage == FwStage.sent || stage == FwStage.restarting;

  FirmwareJob to(FwStage s, {String? error, bool late = false}) =>
      FirmwareJob(version: version, stage: s, since: since, error: error, failedLate: late);
}

/// A firmware update in progress on one board: sent → downloading and checking → restarting → running
/// the new version. The board reports the download over the socket (`node.network` with `ota`), then
/// restarts and announces its new version. Kept per board, so it survives switching tabs.
class FirmwareJobs extends Notifier<FirmwareJob?> {
  FirmwareJobs(this.key);
  final ({String homeId, String nodeId}) key;
  Timer? _timeout;

  @override
  FirmwareJob? build() {
    final live = ref.watch(workLiveProvider(key.homeId));
    final sub = live.on('node.network').listen((e) {
      if (str(e.map['nodeId']) != key.nodeId) return;
      final ota = asJson(e.map['ota']);
      final job = state;
      if (ota.isEmpty || job == null || !job.running) return;
      state = boolean(ota['ok'])
          ? job.to(FwStage.restarting)
          : job.to(FwStage.failed, error: str(ota['message'], 'the update failed'));
    });
    // the board came back on the new version
    ref.listen(workNodeProvider(key), (_, node) {
      final job = state;
      if (job == null || !job.running || node?.firmware == null) return;
      if (node!.firmware == job.version) {
        state = job.to(FwStage.done);
      } else if (job.stage == FwStage.restarting &&
          node.online &&
          compareVersions(node.firmware!, job.version) != 0 &&
          DateTime.now().difference(job.since).inSeconds > 20) {
        state = job.to(FwStage.failed, error: 'came back on ${node.firmware}, not ${job.version}', late: true);
      }
    });
    ref.onDispose(() {
      sub.cancel();
      _timeout?.cancel();
    });
    return null;
  }

  Future<void> install(FirmwareImage img) async {
    final version = await ref.read(workRepositoryProvider).installFirmware(key.homeId, key.nodeId, img.id);
    state = FirmwareJob(version: version.isEmpty ? img.version : version, stage: FwStage.sent, since: DateTime.now());
    _timeout?.cancel();
    // no word for 3 minutes: stop waiting
    _timeout = Timer(const Duration(minutes: 3), () {
      final j = state;
      if (j != null && j.running) state = j.to(FwStage.failed, error: 'no answer from the board within 3 minutes');
    });
  }

  void dismiss() => state = null;
}

final firmwareJobProvider = NotifierProvider.autoDispose
    .family<FirmwareJobs, FirmwareJob?, ({String homeId, String nodeId})>(FirmwareJobs.new);

/// The board's firmware: what it runs, the company's builds, installing one over Wi-Fi with progress.
class BoardFirmware extends ConsumerWidget {
  const BoardFirmware({super.key, required this.homeId, required this.node, this.latest});
  final String homeId;
  final BoardNode node;
  final String? latest;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.sb;
    final key = (homeId: homeId, nodeId: node.id);
    final job = ref.watch(firmwareJobProvider(key));
    final builds = ref.watch(firmwareProvider);
    final list = builds.value ?? const <FirmwareImage>[];
    final newest = list.firstOrNull;
    final running = node.firmware;
    final otaOk = running == null || compareVersions(running, otaFrom) >= 0;
    final behind = newest != null && running != null && compareVersions(newest.version, running) > 0;
    final free = node.health?.freeSketchKb;
    final blocked = !node.online
        ? 'The board is offline'
        : !otaOk
        ? 'Needs firmware $otaFrom or newer on the board'
        : job?.running ?? false
        ? 'An update is running'
        : null;

    Future<void> ask(FirmwareImage img) async {
      final back = running != null && compareVersions(img.version, running) < 0;
      final ok = await confirmSheet(
        context,
        title: '${back ? 'Roll back' : 'Update'} ${node.name} to ${img.version}?',
        body:
            'The board downloads the build over Wi-Fi, checks it, installs it and restarts — about 30–60 seconds. Lights keep their last state; its devices, pins and Wi-Fi stay as they are. Don’t unplug it meanwhile: if the download fails it keeps running ${running ?? 'its current firmware'}.',
        yes: 'Install ${img.version}',
        danger: false,
      );
      if (!ok) return;
      try {
        await ref.read(firmwareJobProvider(key).notifier).install(img);
      } catch (e) {
        toastError(ref, e);
      }
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (job != null) ...[
          _Progress(job: job, onClose: () => ref.read(firmwareJobProvider(key).notifier).dismiss()),
          const SizedBox(height: 12),
        ],
        WorkCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('THIS BOARD RUNS', style: SbText.mono.copyWith(color: c.mu)),
              const SizedBox(height: 4),
              Row(
                children: [
                  Text(
                    running ?? '—',
                    style: TextStyle(fontFamily: SbFonts.mono, fontSize: 22, fontWeight: FontWeight.w500, color: c.tx),
                  ),
                  const SizedBox(width: 10),
                  if (running != null && newest != null)
                    ToneBadge(behind ? 'Update available' : 'Up to date', behind ? Tone.warn : Tone.ok),
                ],
              ),
              const SizedBox(height: 4),
              Text(
                running == null
                    ? 'The board hasn’t reported its firmware yet.'
                    : newest == null
                    ? 'No builds yet. A super admin uploads builds in the web console; then you can install them here.'
                    : behind
                    ? '${newest.version} is the newest build${newest.notes.isNotEmpty ? ' — ${newest.notes}' : ''}.'
                    : 'This is the newest build in your library.',
                style: TextStyle(fontSize: 13.5, color: c.mu, height: 1.4),
              ),
              if (behind) ...[
                const SizedBox(height: 12),
                BigButton(
                  label: 'Install ${newest.version}',
                  icon: WorkIcons.download,
                  height: 48,
                  onTap: blocked == null ? () => ask(newest) : null,
                ),
                if (blocked != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 6),
                    child: Text(blocked, style: TextStyle(fontSize: 13, color: c.mu)),
                  ),
              ],
            ],
          ),
        ),
        if (!otaOk) ...[
          const SizedBox(height: 10),
          const Note(
            tone: NoteTone.warn,
            icon: SbIcons.warning,
            child: Text(
              'Updates over Wi-Fi start with firmware $otaFrom. Flash this board once with a USB cable; after that every update is over Wi-Fi.',
            ),
          ),
        ],
        const SizedBox(height: 10),
        Row(
          children: [
            Expanded(
              child: _Mini(label: 'Free for updates', value: free == null ? '—' : '$free KB'),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: _Mini(label: 'Last restart', value: node.health?.reset ?? '—'),
            ),
          ],
        ),
        GroupLabel(
          'Builds',
          trailing: Text('newest first', style: TextStyle(fontSize: 12.5, color: c.mu)),
        ),
        if (builds.hasError && list.isEmpty)
          ErrorView(error: builds.error!, onRetry: () => ref.invalidate(firmwareProvider))
        else if (!builds.hasValue)
          const LoadingView()
        else if (list.isEmpty)
          const EmptyView(
            icon: WorkIcons.package,
            title: 'No firmware builds yet',
            text: 'A super admin uploads builds in the web console. They appear here, ready to install.',
          )
        else
          GroupCard(
            children: [
              for (final img in list)
                _BuildRow(
                  img: img,
                  running: img.version == running,
                  newest: img.id == newest?.id,
                  older: running != null && compareVersions(img.version, running) < 0,
                  tooBig: free != null && img.kb > free,
                  blocked: blocked,
                  onInstall: () => ask(img),
                ),
            ],
          ),
      ],
    );
  }
}

class _BuildRow extends StatelessWidget {
  const _BuildRow({
    required this.img,
    required this.running,
    required this.newest,
    required this.older,
    required this.tooBig,
    required this.blocked,
    required this.onInstall,
  });
  final FirmwareImage img;
  final bool running, newest, older, tooBig;
  final String? blocked;
  final VoidCallback onInstall;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    return Padding(
      padding: const EdgeInsets.fromLTRB(14, 10, 10, 10),
      child: Row(
        children: [
          SbIcon(running ? WorkIcons.cpu : WorkIcons.package, size: 18, color: running ? c.okText : c.mu),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Wrap(
                  spacing: 6,
                  runSpacing: 4,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    Text(
                      img.version,
                      style: TextStyle(
                        fontFamily: SbFonts.mono,
                        fontSize: 14.5,
                        fontWeight: FontWeight.w500,
                        color: c.tx,
                      ),
                    ),
                    if (newest) const ToneBadge('Newest', Tone.info),
                    if (running) const ToneBadge('On this board', Tone.ok),
                  ],
                ),
                Text(
                  '${img.notes.isEmpty ? 'No notes' : img.notes} · ${img.kb} KB${tooBig ? ' · too big' : ''}${img.createdAt != null ? ' · ${Fmt.day(img.createdAt!)}' : ''}',
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(fontSize: 12.5, color: tooBig ? c.badText : c.mu),
                ),
              ],
            ),
          ),
          if (!running)
            TextButton(
              onPressed: blocked == null && !tooBig ? onInstall : null,
              style: TextButton.styleFrom(
                textStyle: const TextStyle(fontFamily: SbFonts.sans, fontSize: 14, fontWeight: FontWeight.w600),
              ),
              child: Text(older ? 'Roll back' : 'Install'),
            ),
        ],
      ),
    );
  }
}

class _Mini extends StatelessWidget {
  const _Mini({required this.label, required this.value});
  final String label, value;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    return WorkCard(
      padding: const EdgeInsets.all(12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: TextStyle(fontSize: 12.5, color: c.mu)),
          const SizedBox(height: 2),
          Text(
            value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: c.tx),
          ),
        ],
      ),
    );
  }
}

class _Progress extends StatefulWidget {
  const _Progress({required this.job, required this.onClose});
  final FirmwareJob job;
  final VoidCallback onClose;

  @override
  State<_Progress> createState() => _ProgressState();
}

class _ProgressState extends State<_Progress> {
  Timer? _tick;

  @override
  void initState() {
    super.initState();
    _tick = Timer.periodic(const Duration(seconds: 1), (_) => mounted && widget.job.running ? setState(() {}) : null);
  }

  @override
  void dispose() {
    _tick?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final j = widget.job;
    final sec = DateTime.now().difference(j.since).inSeconds;
    final steps = [
      ('Sent to the board', true, false),
      (
        'Downloading & checking',
        j.stage != FwStage.sent && !(j.stage == FwStage.failed && !j.failedLate),
        j.stage == FwStage.failed && !j.failedLate,
      ),
      ('Restarting', j.stage == FwStage.done || j.failedLate, false),
      ('Running ${j.version}', j.stage == FwStage.done, j.failedLate),
    ];
    final active = switch (j.stage) {
      FwStage.sent => 1,
      FwStage.restarting => 2,
      _ => -1,
    };
    final (bg, fg) = switch (j.stage) {
      FwStage.done => (c.okSoft, c.okText),
      FwStage.failed => (c.badSoft, c.badText),
      _ => (c.acSoft, c.acText),
    };
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(18)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              if (j.running)
                SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: fg))
              else
                SbIcon(
                  j.stage == FwStage.done ? SbIcons.check : SbIcons.warning,
                  size: 17,
                  color: fg,
                  weight: IconWeight.bold,
                ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  switch (j.stage) {
                    FwStage.done => 'Updated to ${j.version}',
                    FwStage.failed => 'Update to ${j.version} failed',
                    _ => 'Updating to ${j.version}…',
                  },
                  style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: fg),
                ),
              ),
              if (!j.running)
                GestureDetector(
                  onTap: widget.onClose,
                  child: SbIcon(SbIcons.x, size: 17, color: fg),
                ),
            ],
          ),
          if (j.running) ...[
            const SizedBox(height: 4),
            Text(
              '$sec s · usually 30–60 s',
              style: TextStyle(fontFamily: SbFonts.mono, fontSize: 11.5, color: fg),
            ),
            const SizedBox(height: 8),
            ClipRRect(
              borderRadius: BorderRadius.circular(99),
              child: LinearProgressIndicator(
                value: (sec / 60).clamp(0, .95),
                minHeight: 6,
                color: fg,
                backgroundColor: fg.withValues(alpha: .15),
              ),
            ),
          ],
          const SizedBox(height: 10),
          for (final (i, (label, done, bad)) in steps.indexed)
            Padding(
              padding: const EdgeInsets.only(bottom: 4),
              child: Row(
                children: [
                  Container(
                    width: 18,
                    height: 18,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: done
                          ? c.ok
                          : bad
                          ? c.bad
                          : Colors.transparent,
                      border: done || bad ? null : Border.all(color: i == active ? fg : c.ln2, width: 2),
                    ),
                    child: done || bad
                        ? Center(
                            child: SbIcon(
                              done ? SbIcons.check : SbIcons.x,
                              size: 11,
                              color: Colors.white,
                              weight: IconWeight.bold,
                            ),
                          )
                        : null,
                  ),
                  const SizedBox(width: 10),
                  Text(
                    label,
                    style: TextStyle(
                      fontSize: 13.5,
                      color: c.tx,
                      fontWeight: i == active ? FontWeight.w600 : FontWeight.w400,
                    ),
                  ),
                ],
              ),
            ),
          const SizedBox(height: 4),
          Text(
            switch (j.stage) {
              FwStage.failed when j.failedLate =>
                'The board ${j.error}. The build was labelled with the wrong version.',
              FwStage.failed => 'The board said: ${j.error}. It keeps running its old firmware.',
              FwStage.done => 'The board restarted on the new firmware. Its devices and pins are unchanged.',
              _ => 'Keep the board powered. Lights keep their last state; the board is offline for a few seconds while it restarts.',
            },
            style: TextStyle(fontSize: 13, color: c.tx, height: 1.4),
          ),
        ],
      ),
    );
  }
}

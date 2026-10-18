import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../core/config/app_settings.dart';
import '../../core/network/api_client.dart';
import '../../core/network/api_exception.dart';
import '../../core/theme/sb_colors.dart';
import '../../core/theme/sb_icons.dart';
import '../../core/theme/sb_icons_more.dart';
import '../../data/models/installation.dart';
import '../../data/models/json.dart';
import '../../shared/widgets/common.dart';
import '../../shared/widgets/pill.dart';
import '../../state/session.dart';
import '../../state/toast.dart';
import '../auth/auth_widgets.dart';
import 'sign_off_pad.dart';

/// The home's installation report (null until the installer starts it).
final installReportProvider = FutureProvider.autoDispose<InstallReport?>((ref) async {
  final raw = await ref.read(apiClientProvider).get<Object?>('/home/installation');
  return raw is Map ? InstallReport.fromJson(asJson(raw)) : null;
});

/// The installation report, like the web's /installation: what the installer did and checked, the
/// photos, and the owner's sign-off with a signature drawn on the phone.
class InstallationScreen extends ConsumerWidget {
  const InstallationScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.sb;
    final report = ref.watch(installReportProvider);
    final server = ref.watch(serverUrlProvider) ?? '';
    return RefreshIndicator(
      color: c.on,
      onRefresh: () => ref.refresh(installReportProvider.future),
      child: ListView(
        padding: EdgeInsets.fromLTRB(18, MediaQuery.paddingOf(context).top + 4, 18, 130),
        children: [
          BackPill(onTap: () => context.pop()),
          const SizedBox(height: 12),
          const PageTitle('Installation', subtitle: 'What your installer did and checked, with photos — and your sign-off.'),
          const SizedBox(height: 18),
          report.when(
            loading: () => const LoadingView(),
            error: (e, _) => ErrorView(error: e, onRetry: () => ref.invalidate(installReportProvider)),
            data: (r) => r == null
                ? const EmptyView(icon: MoreIcons.listChecks, title: 'Not started yet', text: 'Your installer hasn’t started the installation report yet.')
                : _Report(report: r, server: server),
          ),
        ],
      ),
    );
  }
}

class _Report extends StatelessWidget {
  const _Report({required this.report, required this.server});
  final InstallReport report;
  final String server;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final r = report;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            r.signed ? const Pill('Signed off', tone: PillTone.ok, icon: SbIcons.check) : const Pill('Waiting for your signature', tone: PillTone.warn),
            const SizedBox(width: 8),
            Expanded(child: Text('${r.installer != null ? 'By ${r.installer} · ' : ''}${r.done} of ${r.total} checked', style: TextStyle(fontSize: 13, color: c.mu))),
          ],
        ),
        const SizedBox(height: 18),
        const SectionHeader('What was checked'),
        const SizedBox(height: 10),
        GroupCard(
          radius: 22,
          children: [
            for (final i in r.items)
              Padding(
                padding: const EdgeInsets.fromLTRB(14, 11, 14, 11),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Container(
                      width: 24,
                      height: 24,
                      decoration: BoxDecoration(color: i.done ? c.okSoft : c.sf2, shape: BoxShape.circle),
                      child: Center(child: SbIcon(i.done ? SbIcons.check : SbIcons.x, size: 13, color: i.done ? c.okText : c.mu)),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(i.label, style: TextStyle(fontSize: 14.5, color: c.tx, height: 1.3)),
                          if (i.note != null) Text(i.note!, style: TextStyle(fontSize: 13, color: c.mu)),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
          ],
        ),
        if (r.notes.isNotEmpty) ...[
          const SizedBox(height: 12),
          Note(tone: NoteTone.info, icon: MoreIcons.fileText, child: Text(r.notes)),
        ],
        const SizedBox(height: 22),
        SectionHeader('Photos', subtitle: r.photos.isEmpty ? 'None yet' : '${r.photos.length} from the installation day'),
        const SizedBox(height: 10),
        if (r.photos.isNotEmpty)
          SizedBox(
            height: 190,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: r.photos.length,
              separatorBuilder: (_, _) => const SizedBox(width: 10),
              itemBuilder: (_, i) => _Photo(photo: r.photos[i], server: server),
            ),
          ),
        const SizedBox(height: 22),
        const SectionHeader('Sign-off'),
        const SizedBox(height: 10),
        if (r.signed)
          _Signed(report: r)
        else if (r.canSign && r.complete)
          const _SignOff()
        else
          Text(
            !r.complete ? 'Your installer is still finishing the checklist.' : 'The home’s owner signs here.',
            style: TextStyle(fontSize: 14, color: c.mu),
          ),
      ],
    );
  }
}

class _Photo extends StatelessWidget {
  const _Photo({required this.photo, required this.server});
  final InstallPhoto photo;
  final String server;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    return GestureDetector(
      onTap: () => showDialog<void>(
        context: context,
        builder: (ctx) => Dialog(
          insetPadding: const EdgeInsets.all(12),
          clipBehavior: Clip.antiAlias,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              InteractiveViewer(child: Image.network(photo.on(server), fit: BoxFit.contain)),
              if (photo.caption.isNotEmpty) Padding(padding: const EdgeInsets.all(12), child: Text(photo.caption, style: TextStyle(color: ctx.sb.tx))),
            ],
          ),
        ),
      ),
      child: SizedBox(
        width: 220,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(16),
              child: Image.network(
                photo.on(server),
                width: 220,
                height: 150,
                fit: BoxFit.cover,
                semanticLabel: photo.caption.isEmpty ? 'Installation photo' : photo.caption,
                errorBuilder: (_, _, _) => Container(width: 220, height: 150, color: c.sf2, child: Center(child: SbIcon(MoreIcons.image, size: 28, color: c.mu))),
              ),
            ),
            const SizedBox(height: 6),
            Text(photo.caption.isEmpty ? 'Photo' : photo.caption, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 12.5, color: c.mu)),
          ],
        ),
      ),
    );
  }
}

class _Signed extends StatelessWidget {
  const _Signed({required this.report});
  final InstallReport report;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final png = report.signaturePng;
    return GroupCard(
      radius: 22,
      children: [
        if (png != null)
          Container(
            color: Colors.white,
            height: 120,
            padding: const EdgeInsets.all(8),
            child: Image.memory(png, fit: BoxFit.contain, semanticLabel: 'Signature of ${report.signedName ?? 'the owner'}'),
          ),
        Padding(
          padding: const EdgeInsets.all(14),
          child: Text.rich(
            TextSpan(children: [
              TextSpan(text: report.signedName ?? 'Signed', style: const TextStyle(fontWeight: FontWeight.w600)),
              if (report.signedAt != null) TextSpan(text: ' signed on ${DateFormat('d MMMM y, h:mm a').format(report.signedAt!)}'),
            ]),
            style: TextStyle(fontSize: 14, color: c.tx),
          ),
        ),
      ],
    );
  }
}

/// The owner's sign-off: their name and a signature drawn with a finger.
class _SignOff extends ConsumerStatefulWidget {
  const _SignOff();

  @override
  ConsumerState<_SignOff> createState() => _SignOffState();
}

class _SignOffState extends ConsumerState<_SignOff> {
  late final _name = TextEditingController(text: ref.read(meProvider).name);
  final _pad = SignOffController();
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _pad.addListener(_changed);
  }

  void _changed() => setState(() {});

  @override
  void dispose() {
    _pad.removeListener(_changed);
    _pad.dispose();
    _name.dispose();
    super.dispose();
  }

  Future<void> _sign() async {
    final name = _name.text.trim();
    if (name.length < 2) {
      setState(() => _error = 'Type the name of the person signing.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final png = await _pad.toPng();
      if (png == null) throw const ApiException(400, 'Draw your signature in the box.');
      await ref.read(apiClientProvider).post<Object?>('/home/installation/sign', {'name': name, 'signature': pngDataUrl(png)});
      ref.invalidate(installReportProvider);
      ref.read(toastProvider.notifier).show('Installation signed off. Thank you!');
    } catch (e) {
      if (mounted) {
        setState(() {
          _busy = false;
          _error = ApiException.from(e).message;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        LabeledField(label: 'Name of the person signing', controller: _name, icon: SbIcons.me),
        const SizedBox(height: 12),
        SignOffPad(controller: _pad),
        Row(
          children: [
            Expanded(child: Text('Sign above with your finger', style: TextStyle(fontSize: 12.5, color: c.mu))),
            TextButton(onPressed: _pad.isEmpty ? null : _pad.clear, child: Text('Clear', style: TextStyle(color: c.acText))),
          ],
        ),
        Text('By signing, you confirm the work above was done and shown to you.', style: TextStyle(fontSize: 13, color: c.mu)),
        if (_error != null) ...[
          const SizedBox(height: 12),
          Note(tone: NoteTone.bad, icon: SbIcons.warning, child: Text(_error!)),
        ],
        const SizedBox(height: 14),
        BigButton(label: 'Sign off the installation', icon: MoreIcons.signature, busy: _busy, onTap: _pad.isEmpty ? null : _sign),
      ],
    );
  }
}

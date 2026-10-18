import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import 'package:intl/intl.dart';

import '../../core/config/app_settings.dart';
import '../../core/theme/app_theme.dart';
import '../../core/theme/sb_colors.dart';
import '../../core/theme/sb_icons.dart';
import '../../data/models/work/installation.dart';
import '../../shared/widgets/common.dart';
import '../../shared/widgets/pressable.dart';
import '../../shared/widgets/sheet.dart';
import '../../state/installation_work.dart';
import '../../state/toast.dart';
import '../../state/work.dart';
import 'board_screen.dart';
import 'signature_pad.dart';
import 'work_icons.dart';
import 'work_widgets.dart';

/// The installation report on site: the checklist (tick + notes), photos from the camera or the
/// gallery, and the customer's signature with their name. It works without signal: changes are saved
/// on this phone and sent when it's back online ("Saved on this phone").
class InstallationScreen extends ConsumerWidget {
  const InstallationScreen({super.key, required this.homeId});
  final String homeId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.sb;
    final state = ref.watch(installProvider(homeId));
    final v = state.value;
    if (v == null) {
      return WorkPage(
        children: [
          if (state.hasError)
            ErrorView(error: state.error!, onRetry: () => ref.invalidate(installProvider(homeId)))
          else
            const LoadingView(label: 'Opening the report…'),
        ],
      );
    }
    final r = v.shown;
    final ctl = ref.read(installProvider(homeId).notifier);
    final locked = r.locked;
    final home = ref.watch(workspaceProvider(homeId)).value?.name ?? r.home;

    return WorkPage(
      onRefresh: () async {
        await ctl.sync();
        ref.invalidate(installProvider(homeId));
      },
      children: [
        Text('INSTALLATION REPORT', style: SbText.mono.copyWith(color: c.mu)),
        const SizedBox(height: 4),
        Text(home, style: SbText.title.copyWith(color: c.tx)),
        const SizedBox(height: 6),
        Row(
          children: [
            Expanded(
              child: Text(
                '${r.installer != null ? 'By ${r.installer} · ' : ''}${r.done} of ${r.total} checked · ${r.photos.length + v.pending.photos.length} photo${r.photos.length + v.pending.photos.length == 1 ? '' : 's'}',
                style: TextStyle(fontSize: 13.5, color: c.mu),
              ),
            ),
            r.signed ? const ToneBadge('Signed off', Tone.ok) : const ToneBadge('Not signed yet', Tone.warn),
          ],
        ),
        if (!r.canEdit && !r.signed) ...[
          const SizedBox(height: 12),
          const ReadOnlyBar(text: 'The home’s installer fills in the report and gets the customer to sign.'),
        ],
        if (v.fromCache) ...[
          const SizedBox(height: 12),
          const Note(
            tone: NoteTone.info,
            icon: WorkIcons.cloudSlash,
            child: Text(
              'No signal: showing the copy saved on this phone. Your changes are kept here and sent when you’re back online.',
            ),
          ),
        ],
        if (v.waiting) ...[
          const SizedBox(height: 12),
          _WaitingNote(count: v.pending.count, sending: v.sending, onSend: ctl.sync),
        ],
        if (v.refused != null) ...[
          const SizedBox(height: 12),
          Note(
            tone: NoteTone.bad,
            icon: SbIcons.warning,
            child: Text('The server didn’t take a change saved on this phone: ${v.refused}'),
          ),
        ],

        if (r.toInstall.isNotEmpty) ...[
          GroupLabel(
            'What to install',
            trailing: Text('Accepted in ${r.quoteRefs.join(', ')}', style: TextStyle(fontSize: 12.5, color: c.mu)),
          ),
          WorkCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                for (final i in r.toInstall)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 3),
                    child: Text.rich(
                      TextSpan(
                        children: [
                          TextSpan(
                            text: '${i.qty} × ',
                            style: const TextStyle(fontWeight: FontWeight.w700),
                          ),
                          TextSpan(text: i.name),
                          if (i.unit != 'each')
                            TextSpan(
                              text: ' (per ${i.unit})',
                              style: TextStyle(color: c.mu),
                            ),
                        ],
                      ),
                      style: TextStyle(fontSize: 14.5, color: c.tx),
                    ),
                  ),
              ],
            ),
          ),
        ],

        GroupLabel(
          'Checklist',
          trailing: Text('${r.done}/${r.total}', style: TextStyle(fontSize: 13, color: c.mu)),
        ),
        GroupCard(
          children: [
            for (final i in r.items)
              _ItemRow(
                item: i,
                waiting: v.pending.ticks.any((t) => t.key == i.key),
                locked: locked,
                onTick: (done) => ctl.tick(i.key, done),
                onNote: () async {
                  final text = await askText(
                    context,
                    title: 'Note',
                    note: i.label,
                    hint: 'e.g. Used 2.5 mm wire for the geyser',
                    initial: i.note ?? '',
                    yes: 'Save note',
                    maxLength: 300,
                    maxLines: 3,
                  );
                  if (text != null) await ctl.note(i.key, text);
                },
              ),
          ],
        ),
        _NotesBox(report: r, locked: locked, onSave: ctl.setNotes),

        GroupLabel(
          'Photos',
          trailing: Text('Boards in their boxes, the DB, switch plates', style: TextStyle(fontSize: 12, color: c.mu)),
        ),
        _Photos(homeId: homeId, view: v, locked: locked),

        const GroupLabel('Customer sign-off'),
        _SignOff(homeId: homeId, view: v),
      ],
    );
  }
}

class _WaitingNote extends StatelessWidget {
  const _WaitingNote({required this.count, required this.sending, required this.onSend});
  final int count;
  final bool sending;
  final Future<void> Function() onSend;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    return Container(
      padding: const EdgeInsets.fromLTRB(14, 10, 8, 10),
      decoration: BoxDecoration(
        color: c.onSoft,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: c.onBorder),
      ),
      child: Row(
        children: [
          SbIcon(WorkIcons.cloudSlash, size: 18, color: c.onText),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              'Saved on this phone — will send when online ($count change${count == 1 ? '' : 's'}).',
              style: TextStyle(fontSize: 13.5, color: c.onText, height: 1.35, fontWeight: FontWeight.w500),
            ),
          ),
          if (sending)
            const Padding(
              padding: EdgeInsets.all(10),
              child: SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)),
            )
          else
            TextButton(
              onPressed: onSend,
              style: TextButton.styleFrom(
                foregroundColor: c.onText,
                textStyle: const TextStyle(fontFamily: SbFonts.sans, fontSize: 14, fontWeight: FontWeight.w600),
              ),
              child: const Text('Send now'),
            ),
        ],
      ),
    );
  }
}

class _ItemRow extends StatelessWidget {
  const _ItemRow({
    required this.item,
    required this.waiting,
    required this.locked,
    required this.onTick,
    required this.onNote,
  });
  final InstallItem item;
  final bool waiting, locked;
  final ValueChanged<bool> onTick;
  final VoidCallback onNote;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final i = item;
    return InkWell(
      onTap: locked ? null : () => onTick(!i.done),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 12, 12, 10),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            AnimatedContainer(
              duration: const Duration(milliseconds: 180),
              width: 26,
              height: 26,
              decoration: BoxDecoration(
                color: i.done ? c.ok : Colors.transparent,
                borderRadius: BorderRadius.circular(8),
                border: i.done ? null : Border.all(color: c.ln2, width: 2),
              ),
              child: i.done
                  ? const Center(
                      child: SbIcon(SbIcons.check, size: 16, color: Colors.white, weight: IconWeight.bold),
                    )
                  : null,
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text.rich(
                    TextSpan(
                      children: [
                        TextSpan(text: i.label),
                        if (waiting)
                          TextSpan(
                            text: ' · on this phone',
                            style: TextStyle(fontSize: 12.5, color: c.onText, fontWeight: FontWeight.w500),
                          ),
                      ],
                    ),
                    style: TextStyle(
                      fontSize: 15,
                      color: c.tx,
                      height: 1.35,
                      decoration: i.done ? TextDecoration.none : null,
                    ),
                  ),
                  if (i.check != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 4),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          SbIcon(
                            i.check!.ok ? SbIcons.check : SbIcons.warning,
                            size: 13,
                            color: i.check!.ok ? c.okText : c.badText,
                          ),
                          const SizedBox(width: 5),
                          Expanded(
                            child: Text(
                              i.check!.text,
                              style: TextStyle(fontSize: 12.5, color: i.check!.ok ? c.okText : c.badText, height: 1.3),
                            ),
                          ),
                        ],
                      ),
                    ),
                  if (i.note != null && i.note!.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 4),
                      child: Text('Note: ${i.note}', style: TextStyle(fontSize: 13, color: c.mu, height: 1.35)),
                    ),
                  if (!locked)
                    GestureDetector(
                      onTap: onNote,
                      child: Padding(
                        padding: const EdgeInsets.only(top: 6),
                        child: Text(
                          i.note?.isNotEmpty ?? false ? 'Change note' : 'Add a note',
                          style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: c.acText),
                        ),
                      ),
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

class _NotesBox extends StatefulWidget {
  const _NotesBox({required this.report, required this.locked, required this.onSave});
  final InstallReport report;
  final bool locked;
  final Future<void> Function(String) onSave;

  @override
  State<_NotesBox> createState() => _NotesBoxState();
}

class _NotesBoxState extends State<_NotesBox> {
  late final _ctl = TextEditingController(text: widget.report.notes);

  @override
  void dispose() {
    _ctl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final changed = _ctl.text != widget.report.notes;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const FieldLabel('Notes for the customer and the team'),
        TextField(
          controller: _ctl,
          enabled: !widget.locked,
          maxLines: 4,
          minLines: 2,
          maxLength: 4000,
          onChanged: (_) => setState(() {}),
          decoration: InputDecoration(
            hintText: widget.locked ? 'No notes' : 'e.g. Router moved to the hallway; the motor needs a 20 A breaker.',
            counterText: '',
          ),
        ),
        if (!widget.locked && changed)
          Align(
            alignment: Alignment.centerRight,
            child: Padding(
              padding: const EdgeInsets.only(top: 8),
              child: PillButton(
                label: 'Save notes',
                icon: SbIcons.check,
                primary: true,
                onTap: () => widget.onSave(_ctl.text),
              ),
            ),
          ),
      ],
    );
  }
}

class _Photos extends ConsumerStatefulWidget {
  const _Photos({required this.homeId, required this.view, required this.locked});
  final String homeId;
  final InstallView view;
  final bool locked;

  @override
  ConsumerState<_Photos> createState() => _PhotosState();
}

class _PhotosState extends ConsumerState<_Photos> {
  final _caption = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    _caption.dispose();
    super.dispose();
  }

  Future<void> _take(ImageSource source) async {
    setState(() => _busy = true);
    try {
      // big enough to read a terminal, small enough for a slow connection
      final x = await ImagePicker().pickImage(source: source, maxWidth: 1600, maxHeight: 1600, imageQuality: 80);
      if (x == null) return;
      final bytes = await x.readAsBytes();
      final name = x.name.toLowerCase();
      final mime =
          x.mimeType ??
          (name.endsWith('.png')
              ? 'image/png'
              : name.endsWith('.webp')
              ? 'image/webp'
              : 'image/jpeg');
      await ref.read(installProvider(widget.homeId).notifier).addPhoto(bytes, mime: mime, caption: _caption.text);
      _caption.clear();
    } catch (e) {
      ref.read(toastProvider.notifier).show('Couldn’t get the photo: ${messageOf(e)}', error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final v = widget.view;
    final server = ref.watch(serverUrlProvider) ?? '';
    final tiles = <Widget>[
      for (final p in v.report.photos)
        _PhotoTile(
          image: NetworkImage('$server${p.url}'),
          caption: p.caption,
          onDelete: widget.locked
              ? null
              : () async {
                  if (!await confirmSheet(
                    context,
                    title: 'Delete this photo?',
                    body: 'It’s removed from the report.',
                    yes: 'Delete',
                  )) {
                    return;
                  }
                  try {
                    await ref.read(installProvider(widget.homeId).notifier).removePhoto(p.id);
                  } catch (e) {
                    toastError(ref, e);
                  }
                },
        ),
      for (final p in v.pending.photos)
        _PhotoTile(
          image: kIsWeb ? null : FileImage(File(p.file)),
          caption: p.caption,
          waiting: true,
          onDelete: () => ref.read(installProvider(widget.homeId).notifier).dropWaitingPhoto(p),
        ),
    ];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (tiles.isEmpty)
          Text('No photos yet.', style: TextStyle(fontSize: 14, color: c.mu))
        else
          GridView.count(
            crossAxisCount: 3,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            mainAxisSpacing: 8,
            crossAxisSpacing: 8,
            children: tiles,
          ),
        if (!widget.locked) ...[
          const SizedBox(height: 12),
          TextField(
            controller: _caption,
            maxLength: 140,
            decoration: const InputDecoration(hintText: 'Caption (optional)', counterText: ''),
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: BigButton(
                  label: 'Camera',
                  icon: WorkIcons.camera,
                  height: 48,
                  busy: _busy,
                  onTap: () => _take(ImageSource.camera),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: BigButton(
                  label: 'Gallery',
                  icon: WorkIcons.images,
                  height: 48,
                  color: c.sf2,
                  foreground: c.tx,
                  onTap: _busy ? null : () => _take(ImageSource.gallery),
                ),
              ),
            ],
          ),
        ],
      ],
    );
  }
}

class _PhotoTile extends StatelessWidget {
  const _PhotoTile({required this.image, required this.caption, this.waiting = false, this.onDelete});
  final ImageProvider? image;
  final String caption;
  final bool waiting;
  final VoidCallback? onDelete;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    return Pressable(
      scale: .97,
      onTap: image == null ? null : () => _showPhoto(context, image!, caption),
      onLongPress: onDelete,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(14),
        child: Stack(
          fit: StackFit.expand,
          children: [
            Container(color: c.sf2),
            if (image != null)
              Image(
                image: image!,
                fit: BoxFit.cover,
                errorBuilder: (_, _, _) => Center(child: SbIcon(WorkIcons.image, size: 26, color: c.mu)),
              ),
            if (waiting)
              Positioned(
                left: 6,
                top: 6,
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(color: c.on, borderRadius: BorderRadius.circular(6)),
                  child: const Text(
                    'On phone',
                    style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w700, color: SbColors.onInk),
                  ),
                ),
              ),
            if (onDelete != null)
              Positioned(
                right: 4,
                top: 4,
                child: GestureDetector(
                  onTap: onDelete,
                  child: Container(
                    width: 26,
                    height: 26,
                    decoration: const BoxDecoration(color: Color(0x99000000), shape: BoxShape.circle),
                    child: const Center(child: SbIcon(WorkIcons.trash, size: 14, color: Colors.white)),
                  ),
                ),
              ),
            if (caption.isNotEmpty)
              Positioned(
                left: 0,
                right: 0,
                bottom: 0,
                child: Container(
                  padding: const EdgeInsets.fromLTRB(6, 10, 6, 4),
                  decoration: const BoxDecoration(
                    gradient: LinearGradient(
                      begin: Alignment.topCenter,
                      end: Alignment.bottomCenter,
                      colors: [Color(0x00000000), Color(0xAA000000)],
                    ),
                  ),
                  child: Text(
                    caption,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 11, color: Colors.white),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

void _showPhoto(BuildContext context, ImageProvider image, String caption) {
  showSbSheet<void>(
    context,
    builder: (ctx) => Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SheetTitle(caption.isEmpty ? 'Photo' : caption),
        const SizedBox(height: 12),
        ClipRRect(
          borderRadius: BorderRadius.circular(16),
          child: Image(image: image, fit: BoxFit.contain),
        ),
      ],
    ),
  );
}

class _SignOff extends ConsumerWidget {
  const _SignOff({required this.homeId, required this.view});
  final String homeId;
  final InstallView view;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.sb;
    final r = view.shown;
    final ctl = ref.read(installProvider(homeId).notifier);
    if (r.signed) {
      return WorkCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (r.signature != null && r.signature!.startsWith('data:image/png;base64,'))
              Container(
                height: 110,
                decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12)),
                padding: const EdgeInsets.all(6),
                child: Image.memory(UriData.parse(r.signature!).contentAsBytes(), fit: BoxFit.contain),
              ),
            const SizedBox(height: 10),
            Text.rich(
              TextSpan(
                children: [
                  TextSpan(
                    text: r.signedName ?? 'The customer',
                    style: const TextStyle(fontWeight: FontWeight.w700),
                  ),
                  TextSpan(
                    text: r.signedAt != null
                        ? ' signed on ${DateFormat('d MMMM y, h:mm a').format(r.signedAt!)}'
                        : ' signed',
                  ),
                ],
              ),
              style: TextStyle(fontSize: 14.5, color: c.tx),
            ),
            if (r.canReopen) ...[
              const SizedBox(height: 12),
              PillButton(
                label: 'Open again',
                icon: WorkIcons.pencil,
                onTap: () async {
                  if (!await confirmSheet(
                    context,
                    title: 'Open the report again?',
                    body: 'The signature is removed and the customer signs again.',
                    yes: 'Open again',
                    danger: false,
                  )) {
                    return;
                  }
                  try {
                    await ctl.reopen();
                  } catch (e) {
                    toastError(ref, e);
                  }
                },
              ),
            ],
          ],
        ),
      );
    }
    final waitingSig = view.pending.signature;
    if (waitingSig != null) {
      return Note(
        tone: NoteTone.warn,
        icon: WorkIcons.signature,
        child: Text(
          '${waitingSig.name} signed on this phone. The signature is sent with the ticks when you’re back online.',
        ),
      );
    }
    if (!r.canEdit) {
      return Text(
        'The installer gets the customer to sign when the work is done. The owner can also sign in their own app.',
        style: TextStyle(fontSize: 14, color: c.mu),
      );
    }
    if (!r.allTicked) {
      return Text(
        'Tick every item first, then hand the phone to the customer to sign. The owner can also sign from their own app.',
        style: TextStyle(fontSize: 14, color: c.mu, height: 1.4),
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          'Every item is ticked. Hand the phone to the customer: they write their name and sign with a finger.',
          style: TextStyle(fontSize: 14, color: c.mu, height: 1.4),
        ),
        const SizedBox(height: 12),
        BigButton(label: 'Customer signs', icon: WorkIcons.signature, onTap: () => _showSign(context, ref, homeId)),
      ],
    );
  }
}

void _showSign(BuildContext context, WidgetRef ref, String homeId) {
  showSbSheet<void>(context, scrollable: false, builder: (_) => _SignSheet(homeId: homeId));
}

class _SignSheet extends ConsumerStatefulWidget {
  const _SignSheet({required this.homeId});
  final String homeId;

  @override
  ConsumerState<_SignSheet> createState() => _SignSheetState();
}

class _SignSheetState extends ConsumerState<_SignSheet> {
  final _name = TextEditingController();
  final _pad = SignatureController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _name.dispose();
    _pad.dispose();
    super.dispose();
  }

  Future<void> _sign() async {
    if (_name.text.trim().length < 2) return setState(() => _error = 'Write the name of the person signing.');
    if (_pad.isEmpty) return setState(() => _error = 'Sign in the white box with a finger.');
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final png = await _pad.toDataUrl();
      if (png == null) throw const FormatException('Sign again, please.');
      await ref.read(installProvider(widget.homeId).notifier).sign(_name.text, png);
      if (mounted) Navigator.of(context).pop();
      ref.read(toastProvider.notifier).show('Signed — thank you!');
    } catch (e) {
      setState(() => _error = messageOf(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SheetTitle(
          'Sign off the installation',
          subtitle: 'By signing, the customer confirms the work was done and shown to them.',
        ),
        const FieldLabel('Name of the person signing'),
        TextField(
          controller: _name,
          textCapitalization: TextCapitalization.words,
          maxLength: 80,
          decoration: const InputDecoration(hintText: 'Ayesha Khan', counterText: ''),
        ),
        const SizedBox(height: 12),
        SignaturePad(controller: _pad, onChanged: () => setState(() {})),
        if (_error != null)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Text(_error!, style: TextStyle(fontSize: 13.5, color: c.badText)),
          ),
        const SizedBox(height: 10),
        BigButton(label: 'Sign off', icon: SbIcons.check, busy: _busy, onTap: _sign),
      ],
    );
  }
}

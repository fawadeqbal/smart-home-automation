import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/network/api_exception.dart';
import '../../core/theme/app_theme.dart';
import '../../core/theme/sb_colors.dart';
import '../../core/theme/sb_icons.dart';
import '../../data/models/work/homes.dart';
import '../../shared/widgets/common.dart';
import '../../shared/widgets/pressable.dart';
import '../../shared/widgets/sheet.dart';
import '../../state/toast.dart';
import 'work_icons.dart';

export '../../data/models/work/homes.dart' show Tone, toneOf;

/// The soft background and readable text colour of a [Tone].
({Color bg, Color fg, Color dot}) toneColors(BuildContext context, Tone tone) {
  final c = context.sb;
  return switch (tone) {
    Tone.ok => (bg: c.okSoft, fg: c.okText, dot: c.ok),
    Tone.info => (bg: c.acSoft, fg: c.acText, dot: c.ac),
    Tone.warn => (bg: c.onSoft, fg: c.onText, dot: c.on),
    Tone.bad => (bg: c.badSoft, fg: c.badText, dot: c.bad),
    Tone.mute => (bg: c.sf2, fg: c.mu, dot: c.mu),
  };
}

/// "Live", "Board offline", "Urgent" — a small coloured pill.
class ToneBadge extends StatelessWidget {
  const ToneBadge(this.text, this.tone, {super.key, this.icon});
  final String text;
  final Tone tone;
  final SbIconData? icon;

  @override
  Widget build(BuildContext context) {
    final t = toneColors(context, tone);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
      decoration: BoxDecoration(color: t.bg, borderRadius: BorderRadius.circular(999)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[
            SbIcon(icon!, size: 12, color: t.fg, weight: IconWeight.bold),
            const SizedBox(width: 4),
          ],
          Flexible(
            child: Text(
              text,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: t.fg),
            ),
          ),
        ],
      ),
    );
  }
}

class ToneDot extends StatelessWidget {
  const ToneDot(this.tone, {super.key, this.size = 10});
  final Tone tone;
  final double size;

  @override
  Widget build(BuildContext context) {
    final t = toneColors(context, tone);
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: t.dot,
        shape: BoxShape.circle,
        boxShadow: [BoxShadow(color: t.dot.withValues(alpha: .35), blurRadius: size * .8)],
      ),
    );
  }
}

/// A page inside a work tab: scrolls, room for the tab bar, and a Back pill when it was opened from a list.
class WorkPage extends StatelessWidget {
  const WorkPage({super.key, required this.children, this.back = true, this.onRefresh});
  final List<Widget> children;
  final bool back;
  final Future<void> Function()? onRefresh;

  @override
  Widget build(BuildContext context) {
    final list = ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: EdgeInsets.fromLTRB(18, MediaQuery.paddingOf(context).top + 4, 18, 130),
      children: [
        if (back) ...[
          BackPill(onTap: () => context.canPop() ? context.pop() : context.go('/work/today')),
          const SizedBox(height: 14),
        ],
        ...children,
      ],
    );
    return onRefresh == null ? list : RefreshIndicator(onRefresh: onRefresh!, child: list);
  }
}

/// A small outlined pill button: "Directions", "Call", "WhatsApp".
class PillButton extends StatelessWidget {
  const PillButton({
    super.key,
    required this.label,
    required this.icon,
    required this.onTap,
    this.primary = false,
    this.green = false,
  });
  final String label;
  final SbIconData icon;
  final VoidCallback? onTap;
  final bool primary, green;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final bg = primary
        ? c.tx
        : green
        ? const Color(0xFF1FA855)
        : c.sf;
    final fg = primary
        ? c.bg
        : green
        ? Colors.white
        : c.tx;
    return Pressable(
      onTap: onTap,
      scale: .95,
      child: Opacity(
        opacity: onTap == null ? .5 : 1,
        child: Container(
          height: 38,
          padding: const EdgeInsets.symmetric(horizontal: 13),
          decoration: BoxDecoration(
            color: bg,
            borderRadius: BorderRadius.circular(999),
            border: primary || green ? null : Border.all(color: c.ln2),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              SbIcon(icon, size: 16, color: fg, weight: primary || green ? IconWeight.fill : IconWeight.regular),
              const SizedBox(width: 6),
              Text(
                label,
                style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: fg),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// A card on a work page: white, rounded, with an optional title row.
class WorkCard extends StatelessWidget {
  const WorkCard({super.key, required this.child, this.padding = const EdgeInsets.all(16), this.color, this.border});
  final Widget child;
  final EdgeInsets padding;
  final Color? color, border;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    return Container(
      width: double.infinity,
      padding: padding,
      decoration: BoxDecoration(
        color: color ?? c.sf,
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: border ?? c.ln2),
      ),
      child: child,
    );
  }
}

/// One fact: "Wi-Fi · HomeWiFi · Good (-64 dBm)".
class FactRow extends StatelessWidget {
  const FactRow(this.label, this.value, {super.key, this.trailing, this.mono = false});
  final String label;
  final String value;
  final Widget? trailing;
  final bool mono;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 7),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 118,
            child: Text(label, style: TextStyle(fontSize: 14, color: c.mu)),
          ),
          Expanded(
            child: Text(
              value,
              style: TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.w500,
                color: c.tx,
                fontFamily: mono ? SbFonts.mono : null,
                height: 1.35,
              ),
            ),
          ),
          if (trailing != null) ...[const SizedBox(width: 8), trailing!],
        ],
      ),
    );
  }
}

/// A list row with an icon tile, a title, a line under it, and an optional value and arrow.
class WorkRow extends StatelessWidget {
  const WorkRow({
    super.key,
    required this.icon,
    required this.title,
    this.subtitle,
    this.value,
    this.onTap,
    this.iconBg,
    this.iconFg,
    this.trailing,
  });
  final SbIconData icon;
  final String title;
  final String? subtitle, value;
  final VoidCallback? onTap;
  final Color? iconBg, iconFg;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    return InkWell(
      onTap: onTap,
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: 58),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
          child: Row(
            children: [
              Container(
                width: 36,
                height: 36,
                decoration: BoxDecoration(color: iconBg ?? c.sf2, borderRadius: BorderRadius.circular(11)),
                child: Center(
                  child: SbIcon(icon, size: 18, color: iconFg ?? c.tx, weight: IconWeight.duotone),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(fontSize: 15.5, fontWeight: FontWeight.w500, color: c.tx),
                    ),
                    if (subtitle != null && subtitle!.isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(top: 1),
                        child: Text(
                          subtitle!,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(fontSize: 13, color: c.mu, height: 1.3),
                        ),
                      ),
                  ],
                ),
              ),
              if (value != null) ...[
                const SizedBox(width: 8),
                Text(value!, style: TextStyle(fontSize: 13.5, color: c.mu)),
              ],
              ?trailing,
              if (onTap != null && trailing == null) ...[
                const SizedBox(width: 6),
                SbIcon(SbIcons.caretRight, size: 16, color: c.mu),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// Small caps label over a group ("BOARDS", "WAITING TO BE INSTALLED").
class GroupLabel extends StatelessWidget {
  const GroupLabel(this.text, {super.key, this.trailing});
  final String text;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    return Padding(
      padding: const EdgeInsets.fromLTRB(4, 20, 4, 8),
      child: Row(
        children: [
          Expanded(
            child: Text(
              text.toUpperCase(),
              style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, letterSpacing: .4, color: c.mu),
            ),
          ),
          ?trailing,
        ],
      ),
    );
  }
}

/// The grey bar telling support staff they only look.
class ReadOnlyBar extends StatelessWidget {
  const ReadOnlyBar({super.key, this.text = 'Wiring, Wi-Fi and firmware are changed by the installer.'});
  final String text;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
      decoration: BoxDecoration(color: c.sf2, borderRadius: BorderRadius.circular(14)),
      child: Row(
        children: [
          SbIcon(WorkIcons.eye, size: 17, color: c.mu),
          const SizedBox(width: 10),
          Expanded(
            child: Text.rich(
              TextSpan(
                children: [
                  TextSpan(
                    text: 'Read-only. ',
                    style: TextStyle(fontWeight: FontWeight.w600, color: c.tx),
                  ),
                  TextSpan(text: text),
                ],
              ),
              style: TextStyle(fontSize: 13.5, color: c.mu, height: 1.35),
            ),
          ),
        ],
      ),
    );
  }
}

/// A form field's label.
class FieldLabel extends StatelessWidget {
  const FieldLabel(this.text, {super.key, this.hint});
  final String text;
  final String? hint;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    return Padding(
      padding: const EdgeInsets.only(top: 14, bottom: 6, left: 2),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            text,
            style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600, color: c.tx),
          ),
          if (hint != null)
            Padding(
              padding: const EdgeInsets.only(top: 2),
              child: Text(hint!, style: TextStyle(fontSize: 12.5, color: c.mu, height: 1.35)),
            ),
        ],
      ),
    );
  }
}

/// A field that opens a list to pick from (a room, a model, a sensor kind).
class PickField<T> extends StatelessWidget {
  const PickField({
    super.key,
    required this.title,
    required this.value,
    required this.options,
    required this.onChanged,
    this.enabled = true,
  });
  final String title;
  final T value;
  final List<(T, String)> options;
  final ValueChanged<T> onChanged;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final label = options.where((o) => o.$1 == value).firstOrNull?.$2 ?? '—';
    return Pressable(
      scale: .98,
      onTap: !enabled
          ? null
          : () async {
              final picked = await pickOne<T>(context, title: title, options: options, value: value);
              if (picked != null) onChanged(picked.$1);
            },
      child: Container(
        constraints: const BoxConstraints(minHeight: 50),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        decoration: BoxDecoration(
          color: enabled ? c.sf : c.sf2,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: c.ln2),
        ),
        child: Row(
          children: [
            Expanded(
              child: Text(label, style: TextStyle(fontSize: 15, color: enabled ? c.tx : c.mu, height: 1.3)),
            ),
            if (enabled) SbIcon(SbIcons.caretDown, size: 16, color: c.mu),
          ],
        ),
      ),
    );
  }
}

/// A sheet with options; returns the picked one (in a record, so a null value can be picked too).
Future<(T,)?> pickOne<T>(
  BuildContext context, {
  required String title,
  required List<(T, String)> options,
  T? value,
  String? subtitle,
}) => showSbSheet<(T,)>(
  context,
  builder: (ctx) {
    final c = ctx.sb;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(title, style: SbText.title.copyWith(color: c.tx)),
        if (subtitle != null)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text(subtitle, style: TextStyle(fontSize: 14, color: c.mu)),
          ),
        const SizedBox(height: 12),
        for (final (v, label) in options)
          Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: Pressable(
              scale: .98,
              onTap: () => Navigator.of(ctx).pop((v,)),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
                decoration: BoxDecoration(
                  color: v == value ? c.onSoft : c.sf2,
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: v == value ? c.on : Colors.transparent),
                ),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        label,
                        style: TextStyle(fontSize: 15, fontWeight: FontWeight.w500, color: c.tx),
                      ),
                    ),
                    if (v == value) SbIcon(SbIcons.check, size: 17, color: c.onText, weight: IconWeight.bold),
                  ],
                ),
              ),
            ),
          ),
      ],
    );
  },
);

/// Asks before doing something that can't be undone easily. True when they said yes.
Future<bool> confirmSheet(
  BuildContext context, {
  required String title,
  required String body,
  required String yes,
  bool danger = true,
  String no = 'Cancel',
}) async {
  final ok = await showSbSheet<bool>(
    context,
    builder: (ctx) {
      final c = ctx.sb;
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(title, style: SbText.title.copyWith(color: c.tx)),
          const SizedBox(height: 8),
          Text(body, style: TextStyle(fontSize: 15, color: c.mu, height: 1.45)),
          const SizedBox(height: 20),
          BigButton(
            label: yes,
            color: danger ? c.bad : null,
            foreground: danger ? Colors.white : null,
            onTap: () => Navigator.of(ctx).pop(true),
          ),
          const SizedBox(height: 6),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: Text(
              no,
              style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: c.tx),
            ),
          ),
        ],
      );
    },
  );
  return ok ?? false;
}

/// A sheet's title row with a close button.
class SheetTitle extends StatelessWidget {
  const SheetTitle(this.title, {super.key, this.subtitle});
  final String title;
  final String? subtitle;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title, style: SbText.title.copyWith(color: c.tx)),
              if (subtitle != null)
                Padding(
                  padding: const EdgeInsets.only(top: 3),
                  child: Text(subtitle!, style: TextStyle(fontSize: 14, color: c.mu, height: 1.35)),
                ),
            ],
          ),
        ),
        const SizedBox(width: 8),
        RoundButton(icon: SbIcons.x, label: 'Close', onTap: () => Navigator.of(context).pop()),
      ],
    );
  }
}

// ---------------------------------------------------------------- calling, WhatsApp, maps

/// Opens a link in the app made for it (Google Maps, the dialer, WhatsApp); says so when it can't.
Future<void> openExternal(WidgetRef ref, String url) async {
  var ok = false;
  try {
    ok = await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
  } catch (_) {
    ok = false;
  }
  if (!ok) {
    await Clipboard.setData(ClipboardData(text: url));
    ref.read(toastProvider.notifier).show('Couldn’t open it on this phone — the link is copied', error: true);
  }
}

/// Calls a number as people typed it ("0300 1234567") or as WhatsApp digits ("923001234567").
Future<void> callNumber(WidgetRef ref, String phone) {
  final digits = whatsappDigits(phone);
  final dial = digits != null ? '+$digits' : phone.replaceAll(RegExp(r'[^\d+]'), '');
  return openExternal(ref, 'tel:$dial');
}

/// WhatsApp to that number with the message ready (without a number, WhatsApp asks who to send it to).
Future<void> whatsApp(WidgetRef ref, String? digits, String text) {
  final to = digits != null && RegExp(r'^\d{8,15}$').hasMatch(digits) ? digits : '';
  return openExternal(ref, 'https://wa.me/$to?text=${Uri.encodeComponent(text)}');
}

/// Messages the team sends customers (the same words as the web console's `lib/whatsapp.ts`).
abstract final class WorkMessages {
  static String _first(String? name) => (name ?? '').trim().split(RegExp(r'\s+')).first;

  static String onMyWay(String? installer) =>
      'Assalam o Alaikum, this is ${_first(installer).isEmpty ? 'your installer' : _first(installer)}. I\'m on my way to you now. See you soon!';

  static String hello(String? name, String company) =>
      '${_first(name).isEmpty ? 'Assalam o Alaikum,' : 'Assalam o Alaikum ${_first(name)},'}\nThis is $company about your home.';

  static String ticketUpdate({
    String? name,
    required int number,
    required String title,
    required String status,
    String? reply,
    required String company,
  }) =>
      '${_first(name).isEmpty ? 'Assalam o Alaikum,' : 'Assalam o Alaikum ${_first(name)},'}\nAn update on your request #$number ($title): *$status*.'
      '${reply != null ? '\n\n"${reply.length > 500 ? reply.substring(0, 500) : reply}"' : ''}\n\nYou can see it in the Switchboard app.\n— $company';
}

/// Shows an API error as a toast (the server's own words).
void toastError(WidgetRef ref, Object e) =>
    ref.read(toastProvider.notifier).show(ApiException.from(e).message, error: true);

/// A short answer in a sheet (a name, a note). Null when closed; '' allowed when [optional].
Future<String?> askText(
  BuildContext context, {
  required String title,
  required String hint,
  String initial = '',
  String? note,
  String yes = 'Save',
  bool optional = false,
  int maxLength = 60,
  int maxLines = 1,
}) => showSbSheet<String>(
  context,
  builder: (_) => _AskText(
    title: title,
    hint: hint,
    initial: initial,
    note: note,
    yes: yes,
    optional: optional,
    maxLength: maxLength,
    maxLines: maxLines,
  ),
);

class _AskText extends StatefulWidget {
  const _AskText({
    required this.title,
    required this.hint,
    required this.initial,
    required this.note,
    required this.yes,
    required this.optional,
    required this.maxLength,
    required this.maxLines,
  });
  final String title, hint, initial, yes;
  final String? note;
  final bool optional;
  final int maxLength, maxLines;

  @override
  State<_AskText> createState() => _AskTextState();
}

class _AskTextState extends State<_AskText> {
  // owned by the sheet, so it lives as long as the sheet's closing animation
  late final _ctl = TextEditingController(text: widget.initial);

  @override
  void dispose() {
    _ctl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SheetTitle(widget.title, subtitle: widget.note),
        const SizedBox(height: 14),
        TextField(
          controller: _ctl,
          autofocus: true,
          maxLength: widget.maxLength,
          maxLines: widget.maxLines,
          minLines: 1,
          decoration: InputDecoration(hintText: widget.hint, counterText: ''),
        ),
        if (widget.optional)
          Padding(
            padding: const EdgeInsets.only(top: 6, left: 2),
            child: Text('Optional', style: TextStyle(fontSize: 12.5, color: c.mu)),
          ),
        const SizedBox(height: 14),
        BigButton(label: widget.yes, onTap: () => Navigator.of(context).pop(_ctl.text.trim())),
      ],
    );
  }
}

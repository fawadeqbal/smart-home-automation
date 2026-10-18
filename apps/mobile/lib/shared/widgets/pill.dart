import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/theme/sb_colors.dart';
import '../../core/theme/sb_icons.dart';
import '../../core/theme/sb_icons_more.dart';

/// A small status label: "Paid" (ok), "Overdue" (bad), "Due" (warn), "On" (info), "Off" (mute).
enum PillTone { ok, bad, warn, info, mute }

class Pill extends StatelessWidget {
  const Pill(this.text, {super.key, this.tone = PillTone.mute, this.icon});
  final String text;
  final PillTone tone;
  final SbIconData? icon;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final (bg, fg) = switch (tone) {
      PillTone.ok => (c.okSoft, c.okText),
      PillTone.bad => (c.badSoft, c.badText),
      PillTone.warn => (c.onSoft, c.onText),
      PillTone.info => (c.acSoft, c.acText),
      PillTone.mute => (c.sf2, c.mu),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(99)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[SbIcon(icon!, size: 12, color: fg), const SizedBox(width: 4)],
          Text(text, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: fg)),
        ],
      ),
    );
  }
}

/// A row of a settings-like card: an icon tile, a title and a line under it, something on the right.
class InfoRow extends StatelessWidget {
  const InfoRow({super.key, required this.icon, required this.title, this.subtitle, this.trailing, this.onTap, this.tint, this.titleColor});
  final SbIconData icon;
  final String title;
  final String? subtitle;
  final Color? titleColor;
  final Widget? trailing;
  final VoidCallback? onTap;

  /// The icon tile's colours (background, icon); grey when not given.
  final (Color, Color)? tint;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final (bg, fg) = tint ?? (c.sf2, c.tx);
    return InkWell(
      onTap: onTap,
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: 56),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          child: Row(
            children: [
              Container(
                width: 34,
                height: 34,
                decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(10)),
                child: Center(child: SbIcon(icon, size: 18, color: fg, weight: IconWeight.duotone)),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, style: TextStyle(fontSize: 15.5, fontWeight: FontWeight.w500, color: titleColor ?? c.tx)),
                    if (subtitle != null) Text(subtitle!, style: TextStyle(fontSize: 13, color: c.mu, height: 1.3)),
                  ],
                ),
              ),
              if (trailing != null) ...[const SizedBox(width: 8), trailing!],
              if (onTap != null && trailing == null) ...[const SizedBox(width: 6), SbIcon(SbIcons.caretRight, size: 16, color: c.mu)],
            ],
          ),
        ),
      ),
    );
  }
}

/// A value to copy (a JazzCash number, a key): the label, the value, and a Copy button that says "Copied".
class CopyRow extends StatefulWidget {
  const CopyRow({super.key, required this.label, required this.value, this.mono = false});
  final String label, value;
  final bool mono;

  @override
  State<CopyRow> createState() => _CopyRowState();
}

class _CopyRowState extends State<CopyRow> {
  bool _copied = false;

  Future<void> _copy() async {
    await Clipboard.setData(ClipboardData(text: widget.value));
    if (!mounted) return;
    setState(() => _copied = true);
    Future<void>.delayed(const Duration(milliseconds: 1600), () {
      if (mounted) setState(() => _copied = false);
    });
  }

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(widget.label, style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w500, color: c.mu)),
                const SizedBox(height: 2),
                SelectableText(
                  widget.value,
                  style: TextStyle(fontSize: 15, fontWeight: FontWeight.w500, color: c.tx, fontFamily: widget.mono ? 'GeistMono' : null, height: 1.3),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Semantics(
            button: true,
            label: 'Copy ${widget.label}',
            child: TextButton.icon(
              onPressed: _copy,
              icon: SbIcon(_copied ? SbIcons.check : MoreIcons.copy, size: 15, color: _copied ? c.okText : c.acText),
              label: Text(_copied ? 'Copied' : 'Copy'),
              style: TextButton.styleFrom(
                foregroundColor: _copied ? c.okText : c.acText,
                minimumSize: const Size(44, 40),
                textStyle: const TextStyle(fontFamily: 'Geist', fontSize: 14, fontWeight: FontWeight.w600),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// A grey heading over a group of rows ("YOUR HOME").
class GroupLabel extends StatelessWidget {
  const GroupLabel(this.text, {super.key});
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(left: 4, bottom: 8),
        child: Text(text.toUpperCase(), style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, letterSpacing: .2, color: context.sb.mu)),
      );
}

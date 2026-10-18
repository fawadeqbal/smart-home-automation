import 'dart:ui';

import 'package:flutter/material.dart';

import '../../core/network/api_exception.dart';
import '../../core/theme/app_theme.dart';
import '../../core/theme/sb_colors.dart';
import '../../core/theme/sb_icons.dart';
import 'pressable.dart';

/// "Scenes", "Favourites" … with an optional action on the right ("See all").
class SectionHeader extends StatelessWidget {
  const SectionHeader(
    this.title, {
    super.key,
    this.subtitle,
    this.action,
    this.onAction,
  });
  final String title;
  final String? subtitle, action;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title, style: SbText.section.copyWith(color: c.tx)),
              if (subtitle != null) Text(subtitle!, style: TextStyle(fontSize: 13.5, color: c.mu)),
            ],
          ),
        ),
        if (action != null)
          TextButton(
            onPressed: onAction,
            style: TextButton.styleFrom(
              foregroundColor: c.acText,
              minimumSize: const Size(44, 36),
              // a button's text style replaces the theme's, so it must name the app font itself
              textStyle: const TextStyle(
                fontFamily: SbFonts.sans,
                fontSize: 14,
                fontWeight: FontWeight.w500,
              ),
            ),
            child: Text(action!),
          ),
      ],
    );
  }
}

/// The page title of a tab ("Rooms", "Routines").
class PageTitle extends StatelessWidget {
  const PageTitle(this.text, {super.key, this.trailing, this.subtitle});
  final String text;
  final String? subtitle;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Semantics(
                  header: true,
                  child: Text(
                    text,
                    style: SbText.display.copyWith(color: c.tx),
                  ),
                ),
                if (subtitle != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Text(
                      subtitle!,
                      style: TextStyle(fontSize: 14.5, color: c.mu),
                    ),
                  ),
              ],
            ),
          ),
          ?trailing,
        ],
      ),
    );
  }
}

/// "← Back" pill used on pushed pages.
class BackPill extends StatelessWidget {
  const BackPill({super.key, required this.onTap});
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    return Align(
      alignment: Alignment.centerLeft,
      child: Pressable(
        onTap: onTap,
        semanticLabel: 'Back',
        child: Container(
          height: 44,
          padding: const EdgeInsets.fromLTRB(8, 0, 14, 0),
          decoration: BoxDecoration(
            color: c.sf,
            borderRadius: BorderRadius.circular(999),
            boxShadow: c.shadow1,
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              SbIcon(SbIcons.arrowLeft, size: 17, color: c.tx),
              const SizedBox(width: 6),
              Text(
                'Back',
                style: TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w500,
                  color: c.tx,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// A round icon button (close ×, +).
class RoundButton extends StatelessWidget {
  const RoundButton({
    super.key,
    required this.icon,
    required this.onTap,
    required this.label,
    this.dark = false,
    this.size = 44,
  });
  final SbIconData icon;
  final VoidCallback onTap;
  final String label;
  final bool dark;
  final double size;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    return Pressable(
      onTap: onTap,
      semanticLabel: label,
      scale: .9,
      child: Container(
        width: size,
        height: size,
        decoration: BoxDecoration(
          color: dark ? c.tx : c.sf2,
          shape: BoxShape.circle,
        ),
        child: Center(child: SbIcon(icon, size: 19, color: dark ? c.bg : c.tx)),
      ),
    );
  }
}

/// A grouped list card with hairlines between its rows.
class GroupCard extends StatelessWidget {
  const GroupCard({super.key, required this.children, this.radius = 20});
  final List<Widget> children;
  final double radius;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    return Container(
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: c.sf,
        borderRadius: BorderRadius.circular(radius),
        border: Border.all(color: c.ln2),
      ),
      child: Column(
        children: [
          for (final (i, child) in children.indexed) ...[
            if (i > 0) Divider(height: 1, thickness: 1, color: c.ln),
            child,
          ],
        ],
      ),
    );
  }
}

/// Initials in a circle.
class Avatar extends StatelessWidget {
  const Avatar(
    this.initials, {
    super.key,
    this.size = 44,
    this.background,
    this.foreground,
  });
  final String initials;
  final double size;
  final Color? background, foreground;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: background ?? c.sf2,
        shape: BoxShape.circle,
      ),
      alignment: Alignment.center,
      child: Text(
        initials,
        style: TextStyle(
          fontSize: size * .32,
          fontWeight: FontWeight.w600,
          color: foreground ?? c.tx,
        ),
      ),
    );
  }
}

/// Frosted glass (the tab bar, the hero's "on now" bar).
class Glass extends StatelessWidget {
  const Glass({
    super.key,
    required this.child,
    required this.radius,
    required this.color,
    this.border,
    this.blur = 22,
    this.highlight,
  });
  final Widget child;
  final double radius, blur;
  final Color color;
  final Color? border, highlight;

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(radius),
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: blur, sigmaY: blur),
        child: Container(
          decoration: BoxDecoration(
            color: color,
            borderRadius: BorderRadius.circular(radius),
            border: border == null ? null : Border.all(color: border!, width: .5),
            gradient: highlight == null
                ? null
                : LinearGradient(
                    begin: Alignment.topCenter,
                    end: const Alignment(0, -.85),
                    colors: [highlight!, color],
                  ),
          ),
          child: child,
        ),
      ),
    );
  }
}

/// A coloured note: info (blue), bad (red), ok (green), warn (amber).
enum NoteTone { info, bad, ok, warn }

class Note extends StatelessWidget {
  const Note({
    super.key,
    required this.tone,
    required this.icon,
    required this.child,
  });
  final NoteTone tone;
  final SbIconData icon;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final (bg, fg) = switch (tone) {
      NoteTone.info => (c.acSoft, c.tx),
      NoteTone.bad => (c.badSoft, c.badText),
      NoteTone.ok => (c.okSoft, c.okText),
      NoteTone.warn => (c.onSoft, c.onText),
    };
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(16),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(top: 1),
            child: SbIcon(icon, size: 18, color: fg),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: DefaultTextStyle.merge(
              style: TextStyle(fontSize: 14, height: 1.45, color: fg),
              child: child,
            ),
          ),
        ],
      ),
    );
  }
}

/// Loading, failed and empty states, in the design's voice.
class LoadingView extends StatelessWidget {
  const LoadingView({super.key, this.label});
  final String? label;

  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(40),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const SizedBox(
            width: 28,
            height: 28,
            child: CircularProgressIndicator(strokeWidth: 2.5),
          ),
          if (label != null) ...[
            const SizedBox(height: 14),
            Text(label!, style: TextStyle(color: context.sb.mu)),
          ],
        ],
      ),
    ),
  );
}

class ErrorView extends StatelessWidget {
  const ErrorView({super.key, required this.error, this.onRetry});
  final Object error;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final e = ApiException.from(error);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 56,
            height: 56,
            decoration: BoxDecoration(color: c.badSoft, shape: BoxShape.circle),
            child: Center(
              child: SbIcon(
                e.isOffline ? SbIcons.wifiSlash : SbIcons.warning,
                size: 26,
                color: c.badText,
              ),
            ),
          ),
          const SizedBox(height: 12),
          Text(
            e.message,
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 15, color: c.tx),
          ),
          if (onRetry != null) ...[
            const SizedBox(height: 12),
            FilledButton(
              onPressed: onRetry,
              style: FilledButton.styleFrom(
                backgroundColor: c.tx,
                foregroundColor: c.bg,
                minimumSize: const Size(120, 46),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(14),
                ),
              ),
              child: const Text(
                'Try again',
                style: TextStyle(fontWeight: FontWeight.w600),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class EmptyView extends StatelessWidget {
  const EmptyView({
    super.key,
    required this.icon,
    required this.title,
    this.text,
    this.action,
  });
  final SbIconData icon;
  final String title;
  final String? text;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 28),
      decoration: BoxDecoration(
        color: c.sf,
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: c.ln2),
      ),
      child: Column(
        children: [
          Container(
            width: 48,
            height: 48,
            decoration: BoxDecoration(color: c.sf2, shape: BoxShape.circle),
            child: Center(child: SbIcon(icon, size: 22, color: c.mu)),
          ),
          const SizedBox(height: 12),
          Text(
            title,
            textAlign: TextAlign.center,
            style: SbText.cardTitle.copyWith(fontSize: 16, color: c.tx),
          ),
          if (text != null)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(
                text!,
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 14, color: c.mu, height: 1.4),
              ),
            ),
          if (action != null) Padding(padding: const EdgeInsets.only(top: 14), child: action),
        ],
      ),
    );
  }
}

/// The big dark (or amber, or blue) action button.
class BigButton extends StatelessWidget {
  const BigButton({
    super.key,
    required this.label,
    required this.onTap,
    this.busy = false,
    this.icon,
    this.color,
    this.foreground,
    this.height = 56,
  });
  final String label;
  final VoidCallback? onTap;
  final bool busy;
  final SbIconData? icon;
  final Color? color, foreground;
  final double height;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final bg = color ?? c.tx, fg = foreground ?? c.bg;
    return Pressable(
      onTap: busy ? null : onTap,
      scale: .97,
      child: AnimatedOpacity(
        duration: const Duration(milliseconds: 150),
        opacity: onTap == null || busy ? .65 : 1,
        child: Container(
          height: height,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: bg,
            borderRadius: BorderRadius.circular(18),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (busy)
                SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2, color: fg),
                )
              else if (icon != null)
                SbIcon(icon!, size: 18, color: fg),
              if (busy || icon != null) const SizedBox(width: 10),
              Text(
                label,
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w600,
                  color: fg,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

import 'package:flutter/material.dart';

import '../../core/theme/app_theme.dart';
import '../../core/theme/sb_colors.dart';
import '../../core/theme/sb_icons.dart';

/// The Switchboard mark and name.
class Brand extends StatelessWidget {
  const Brand({super.key, this.size = 30});
  final double size;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: size,
          height: size,
          decoration: BoxDecoration(
            color: const Color(0xFF2F5BFF),
            borderRadius: BorderRadius.circular(size * .27),
          ),
          child: Center(
            child: SbIcon(
              SbIcons.toggle,
              size: size * .57,
              color: Colors.white,
              weight: IconWeight.bold,
            ),
          ),
        ),
        const SizedBox(width: 10),
        Text(
          'Switchboard',
          style: TextStyle(
            fontSize: size * .57,
            fontWeight: FontWeight.w600,
            letterSpacing: -.3,
            color: c.tx,
          ),
        ),
      ],
    );
  }
}

/// "Welcome *back.*" — a heading with its last word in the serif.
class SerifHeading extends StatelessWidget {
  const SerifHeading(this.plain, this.serif, {super.key, this.size = 40});
  final String plain, serif;
  final double size;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    return Semantics(
      header: true,
      child: Text.rich(
        TextSpan(
          children: [
            TextSpan(text: '$plain '),
            TextSpan(
              text: serif,
              style: SbText.serif.copyWith(fontSize: size * 1.05),
            ),
          ],
        ),
        style: TextStyle(
          fontSize: size,
          fontWeight: FontWeight.w600,
          letterSpacing: -size * .045,
          height: 1.05,
          color: c.tx,
        ),
      ),
    );
  }
}

/// A labelled field with an icon, like the design's sign-in form.
class LabeledField extends StatelessWidget {
  const LabeledField({
    super.key,
    required this.label,
    required this.controller,
    required this.icon,
    this.hint,
    this.obscure = false,
    this.trailing,
    this.keyboardType,
    this.autofillHints,
    this.textInputAction,
    this.onSubmitted,
    this.error = false,
    this.extra,
    this.autofocus = false,
  });

  final String label;
  final TextEditingController controller;
  final SbIconData icon;
  final String? hint;
  final bool obscure, error, autofocus;
  final Widget? trailing, extra;
  final TextInputType? keyboardType;
  final Iterable<String>? autofillHints;
  final TextInputAction? textInputAction;
  final ValueChanged<String>? onSubmitted;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                label,
                style: TextStyle(
                  fontSize: 13.5,
                  fontWeight: FontWeight.w500,
                  color: c.tx,
                ),
              ),
            ),
            ?extra,
          ],
        ),
        const SizedBox(height: 7),
        TextField(
          controller: controller,
          obscureText: obscure,
          keyboardType: keyboardType,
          autofillHints: autofillHints,
          textInputAction: textInputAction,
          onSubmitted: onSubmitted,
          autofocus: autofocus,
          autocorrect: false,
          enableSuggestions: !obscure,
          style: TextStyle(fontSize: 15.5, color: c.tx),
          decoration: InputDecoration(
            hintText: hint,
            prefixIcon: Padding(
              padding: const EdgeInsets.only(left: 14, right: 10),
              child: SbIcon(icon, size: 18, color: c.mu),
            ),
            prefixIconConstraints: const BoxConstraints(minWidth: 42),
            suffixIcon: trailing,
            enabledBorder: error
                ? OutlineInputBorder(
                    borderRadius: BorderRadius.circular(14),
                    borderSide: BorderSide(color: c.bad),
                  )
                : null,
          ),
        ),
      ],
    );
  }
}

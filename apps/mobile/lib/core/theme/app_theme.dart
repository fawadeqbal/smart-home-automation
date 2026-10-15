import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'sb_colors.dart';

/// Fonts from the design: Geist for text, Instrument Serif (italic) for the warm accents, Geist Mono for labels.
abstract final class SbFonts {
  static const sans = 'Geist';
  static const serif = 'InstrumentSerif';
  static const mono = 'GeistMono';
}

/// The design's text styles. Sizes are the design's px; letter spacing follows its `em` values.
abstract final class SbText {
  static const display = TextStyle(
    fontFamily: SbFonts.sans,
    fontSize: 32,
    fontWeight: FontWeight.w600,
    letterSpacing: -1.28,
    height: 1.1,
  );
  static const hero = TextStyle(
    fontFamily: SbFonts.sans,
    fontSize: 36,
    fontWeight: FontWeight.w600,
    letterSpacing: -1.62,
    height: 1.02,
  );
  static const section = TextStyle(
    fontFamily: SbFonts.sans,
    fontSize: 20,
    fontWeight: FontWeight.w600,
    letterSpacing: -.6,
    height: 1.2,
  );
  static const title = TextStyle(
    fontFamily: SbFonts.sans,
    fontSize: 22,
    fontWeight: FontWeight.w600,
    letterSpacing: -.44,
    height: 1.25,
  );
  static const cardTitle = TextStyle(
    fontFamily: SbFonts.sans,
    fontSize: 15,
    fontWeight: FontWeight.w600,
    height: 1.25,
  );
  static const body = TextStyle(
    fontFamily: SbFonts.sans,
    fontSize: 15,
    fontWeight: FontWeight.w500,
    height: 1.35,
  );
  static const bodyRegular = TextStyle(
    fontFamily: SbFonts.sans,
    fontSize: 15,
    fontWeight: FontWeight.w400,
    height: 1.45,
  );
  static const small = TextStyle(
    fontFamily: SbFonts.sans,
    fontSize: 13,
    fontWeight: FontWeight.w400,
    height: 1.3,
  );
  static const label = TextStyle(
    fontFamily: SbFonts.sans,
    fontSize: 13,
    fontWeight: FontWeight.w600,
    letterSpacing: .2,
  );
  static const mono = TextStyle(
    fontFamily: SbFonts.mono,
    fontSize: 11,
    fontWeight: FontWeight.w500,
    letterSpacing: .9,
  );
  static const serif = TextStyle(
    fontFamily: SbFonts.serif,
    fontStyle: FontStyle.italic,
    fontWeight: FontWeight.w400,
    letterSpacing: 0,
  );
}

abstract final class AppTheme {
  static ThemeData light() => _build(SbColors.light);
  static ThemeData dark() => _build(SbColors.dark);

  static ThemeData _build(SbColors c) {
    final scheme = ColorScheme.fromSeed(
      seedColor: c.ac,
      brightness: c.brightness,
      surface: c.sf,
      onSurface: c.tx,
      primary: c.tx,
      onPrimary: c.bg,
      secondary: c.on,
      error: c.bad,
    );
    final base = ThemeData(
      useMaterial3: true,
      brightness: c.brightness,
      colorScheme: scheme,
      fontFamily: SbFonts.sans,
      scaffoldBackgroundColor: c.bg,
      canvasColor: c.bg,
      splashFactory: InkSparkle.splashFactory,
      extensions: [c],
    );
    return base.copyWith(
      textTheme: base.textTheme.apply(
        bodyColor: c.tx,
        displayColor: c.tx,
        fontFamily: SbFonts.sans,
      ),
      dividerColor: c.ln,
      appBarTheme: AppBarTheme(
        backgroundColor: c.bg,
        foregroundColor: c.tx,
        elevation: 0,
        systemOverlayStyle: c.isDark ? SystemUiOverlayStyle.light : SystemUiOverlayStyle.dark,
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: c.sf,
        hintStyle: TextStyle(color: c.mu.withValues(alpha: .75)),
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 14,
          vertical: 15,
        ),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: BorderSide(color: c.ln2),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: BorderSide(color: c.ln2),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: BorderSide(color: c.ac, width: 1.5),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: BorderSide(color: c.bad),
        ),
      ),
      textSelectionTheme: TextSelectionThemeData(
        cursorColor: c.ac,
        selectionColor: c.acSoft,
      ),
      progressIndicatorTheme: ProgressIndicatorThemeData(color: c.on),
      pageTransitionsTheme: const PageTransitionsTheme(
        builders: {
          TargetPlatform.android: FadeForwardsPageTransitionsBuilder(),
          TargetPlatform.iOS: CupertinoPageTransitionsBuilder(),
        },
      ),
    );
  }
}

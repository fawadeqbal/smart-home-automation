import 'package:flutter/material.dart';

/// The design's colour tokens (Home App v2), for light and dark. Read them with `context.sb`.
///
/// Names follow the design: bg (page), sf/sf2/sf3 (surfaces), tx (text), mu (muted text),
/// ln/ln2 (lines), ac (accent blue), on (amber, "it's on"), ok, bad — each with a soft background
/// (…Soft) and a readable text colour (…Text).
@immutable
class SbColors extends ThemeExtension<SbColors> {
  const SbColors({
    required this.brightness,
    required this.bg,
    required this.sf,
    required this.sf2,
    required this.sf3,
    required this.tx,
    required this.mu,
    required this.ln,
    required this.ln2,
    required this.ac,
    required this.acText,
    required this.acSoft,
    required this.on,
    required this.onSoft,
    required this.onBorder,
    required this.onText,
    required this.ok,
    required this.okSoft,
    required this.okText,
    required this.bad,
    required this.badSoft,
    required this.badText,
    required this.switchOff,
    required this.glass,
    required this.glassBar,
    required this.glassBorder,
    required this.glassHighlight,
    required this.lens,
    required this.tint,
    required this.shadow,
  });

  final Brightness brightness;
  final Color bg, sf, sf2, sf3, tx, mu, ln, ln2;
  final Color ac, acText, acSoft;
  final Color on, onSoft, onBorder, onText;
  final Color ok, okSoft, okText;
  final Color bad, badSoft, badText;
  final Color switchOff;
  final Color glass, glassBar, glassBorder, glassHighlight, lens, tint;
  final Color shadow;

  bool get isDark => brightness == Brightness.dark;

  /// The amber of a tile that is on (the same in both themes, like the design).
  static const onTileFrom = Color(0xFFFFDC92);
  static const onTileTo = Color(0xFFF7AB2C);
  static const onInk = Color(0xFF1A1204);
  static const ink = Color(0xFF0D0E11);
  static const inkText = Color(0xFFF4F3EF);

  List<BoxShadow> get shadow1 => [
    BoxShadow(
      color: shadow.withValues(alpha: isDark ? .35 : .05),
      blurRadius: 2,
      offset: const Offset(0, 1),
    ),
  ];
  List<BoxShadow> get shadow2 => [
    BoxShadow(
      color: shadow.withValues(alpha: isDark ? .3 : .04),
      blurRadius: 2,
      offset: const Offset(0, 1),
    ),
    BoxShadow(
      color: shadow.withValues(alpha: isDark ? .7 : .22),
      blurRadius: 60,
      spreadRadius: -24,
      offset: const Offset(0, 24),
    ),
  ];

  static const light = SbColors(
    brightness: Brightness.light,
    bg: Color(0xFFF6F5F2),
    sf: Color(0xFFFFFFFF),
    sf2: Color(0xFFEFEEE9),
    sf3: Color(0xFFE2E0D9),
    tx: Color(0xFF0F1115),
    mu: Color(0xFF5A5D64),
    ln: Color(0xFFE7E5DF),
    ln2: Color(0xFFD9D6CE),
    ac: Color(0xFF2F5BFF),
    acText: Color(0xFF1F43D1),
    acSoft: Color(0xFFE9EEFF),
    on: Color(0xFFF59E0B),
    onSoft: Color(0xFFFFF4DD),
    onBorder: Color(0xFFF6D99C),
    onText: Color(0xFF985805),
    ok: Color(0xFF1F9D63),
    okSoft: Color(0xFFE3F4EA),
    okText: Color(0xFF116C46),
    bad: Color(0xFFE5484D),
    badSoft: Color(0xFFFDECEC),
    badText: Color(0xFFBF262B),
    switchOff: Color(0xFFD5D3CC),
    glass: Color(0x9EFFFFFF),
    glassBar: Color(0xA8FAFAFA),
    glassBorder: Color(0xD9FFFFFF),
    glassHighlight: Color(0xCCFFFFFF),
    lens: Color(0x120F1115),
    tint: Color(0xFFB45F00),
    shadow: Color(0xFF101828),
  );

  static const dark = SbColors(
    brightness: Brightness.dark,
    bg: Color(0xFF0B0C0E),
    sf: Color(0xFF16181C),
    sf2: Color(0xFF1D2025),
    sf3: Color(0xFF2A2E35),
    tx: Color(0xFFECEEF2),
    mu: Color(0xFF9A9FA9),
    ln: Color(0xFF22252B),
    ln2: Color(0xFF2E323A),
    ac: Color(0xFF5B7CFF),
    acText: Color(0xFFA6B6FF),
    acSoft: Color(0xFF161C38),
    on: Color(0xFFF5A524),
    onSoft: Color(0xFF2A200F),
    onBorder: Color(0xFF4A3816),
    onText: Color(0xFFF7C46A),
    ok: Color(0xFF3CCF8E),
    okSoft: Color(0xFF10261C),
    okText: Color(0xFF62DCA5),
    bad: Color(0xFFFF6369),
    badSoft: Color(0xFF2B1416),
    badText: Color(0xFFFF8A8F),
    switchOff: Color(0xFF3A3E48),
    glass: Color(0x1AFFFFFF),
    glassBar: Color(0xBD1C1E23),
    glassBorder: Color(0x14FFFFFF),
    glassHighlight: Color(0x1FFFFFFF),
    lens: Color(0x24FFFFFF),
    tint: Color(0xFFF7C46A),
    shadow: Color(0xFF000000),
  );

  @override
  SbColors copyWith() => this;

  @override
  SbColors lerp(ThemeExtension<SbColors>? other, double t) {
    if (other is! SbColors) return this;
    Color l(Color a, Color b) => Color.lerp(a, b, t)!;
    return SbColors(
      brightness: t < .5 ? brightness : other.brightness,
      bg: l(bg, other.bg),
      sf: l(sf, other.sf),
      sf2: l(sf2, other.sf2),
      sf3: l(sf3, other.sf3),
      tx: l(tx, other.tx),
      mu: l(mu, other.mu),
      ln: l(ln, other.ln),
      ln2: l(ln2, other.ln2),
      ac: l(ac, other.ac),
      acText: l(acText, other.acText),
      acSoft: l(acSoft, other.acSoft),
      on: l(on, other.on),
      onSoft: l(onSoft, other.onSoft),
      onBorder: l(onBorder, other.onBorder),
      onText: l(onText, other.onText),
      ok: l(ok, other.ok),
      okSoft: l(okSoft, other.okSoft),
      okText: l(okText, other.okText),
      bad: l(bad, other.bad),
      badSoft: l(badSoft, other.badSoft),
      badText: l(badText, other.badText),
      switchOff: l(switchOff, other.switchOff),
      glass: l(glass, other.glass),
      glassBar: l(glassBar, other.glassBar),
      glassBorder: l(glassBorder, other.glassBorder),
      glassHighlight: l(glassHighlight, other.glassHighlight),
      lens: l(lens, other.lens),
      tint: l(tint, other.tint),
      shadow: l(shadow, other.shadow),
    );
  }
}

/// A room's colours: a soft gradient for its card and an "ink" for its icon. Rooms get one by their
/// position, so every home looks like the design however its rooms are named.
@immutable
class RoomPalette {
  const RoomPalette({
    required this.name,
    required this.lightFrom,
    required this.lightTo,
    required this.lightInk,
    required this.darkFrom,
    required this.darkTo,
    required this.darkInk,
  });

  final String name;
  final Color lightFrom, lightTo, lightInk, darkFrom, darkTo, darkInk;

  Gradient gradient(bool dark) => LinearGradient(
    begin: const Alignment(-.6, -1),
    end: const Alignment(.6, 1),
    colors: dark ? [darkFrom, darkTo] : [lightFrom, lightTo],
  );
  Color ink(bool dark) => dark ? darkInk : lightInk;

  static const all = <RoomPalette>[
    RoomPalette(
      name: 'amber',
      lightFrom: Color(0xFFFFF0CC),
      lightTo: Color(0xFFFBC592),
      lightInk: Color(0xFF8D5406),
      darkFrom: Color(0xFF443617),
      darkTo: Color(0xFF2A1907),
      darkInk: Color(0xFFEDC388),
    ),
    RoomPalette(
      name: 'violet',
      lightFrom: Color(0xFFF1EDFF),
      lightTo: Color(0xFFCAC9FF),
      lightInk: Color(0xFF5E589F),
      darkFrom: Color(0xFF373350),
      darkTo: Color(0xFF1B1A2F),
      darkInk: Color(0xFFC4C3FF),
    ),
    RoomPalette(
      name: 'rose',
      lightFrom: Color(0xFFFFE5F3),
      lightTo: Color(0xFFFFB9D9),
      lightInk: Color(0xFF90466C),
      darkFrom: Color(0xFF4C2D39),
      darkTo: Color(0xFF2B1520),
      darkInk: Color(0xFFF8B3D3),
    ),
    RoomPalette(
      name: 'green',
      lightFrom: Color(0xFFDBFCE0),
      lightTo: Color(0xFFA1E3B7),
      lightInk: Color(0xFF397247),
      darkFrom: Color(0xFF243F2A),
      darkTo: Color(0xFF0B2214),
      darkInk: Color(0xFFA0DCAC),
    ),
    RoomPalette(
      name: 'sky',
      lightFrom: Color(0xFFD1F9FF),
      lightTo: Color(0xFF95DBFF),
      lightInk: Color(0xFF006D95),
      darkFrom: Color(0xFF193D4D),
      darkTo: Color(0xFF06202D),
      darkInk: Color(0xFF8BD6FA),
    ),
    RoomPalette(
      name: 'coral',
      lightFrom: Color(0xFFFFE7D9),
      lightTo: Color(0xFFFFBCA9),
      lightInk: Color(0xFF974936),
      darkFrom: Color(0xFF4E2F24),
      darkTo: Color(0xFF2D1610),
      darkInk: Color(0xFFFFB6A3),
    ),
  ];

  static RoomPalette at(int index) => all[index % all.length];
}

/// A scene card's colours (the design's morning / away / movie / night looks).
@immutable
class ScenePalette {
  const ScenePalette(this.from, this.to, this.fg, this.sub, this.iconBg);
  final Color from, to, fg, sub, iconBg;

  Gradient get gradient => LinearGradient(
    begin: const Alignment(-.5, -1),
    end: const Alignment(.5, 1),
    colors: [from, to],
  );

  static const morning = ScenePalette(
    Color(0xFFFFE9BD),
    Color(0xFFFFAE5E),
    Color(0xFF3A2200),
    Color(0xB83A2200),
    Color(0x80FFFFFF),
  );
  static const away = ScenePalette(
    Color(0xFFE4EDFF),
    Color(0xFF9DB6FF),
    Color(0xFF0D1A4A),
    Color(0xB80D1A4A),
    Color(0x80FFFFFF),
  );
  static const movie = ScenePalette(
    Color(0xFFF0E4FF),
    Color(0xFFB294FF),
    Color(0xFF2A1050),
    Color(0xB82A1050),
    Color(0x80FFFFFF),
  );
  static const night = ScenePalette(
    Color(0xFF363D6B),
    Color(0xFF12142B),
    Color(0xFFFFFFFF),
    Color(0xB8FFFFFF),
    Color(0x24FFFFFF),
  );
  static const fresh = ScenePalette(
    Color(0xFFDBFCE0),
    Color(0xFF8FD9A8),
    Color(0xFF0F3A1E),
    Color(0xB80F3A1E),
    Color(0x80FFFFFF),
  );

  static const rotation = [morning, away, movie, night, fresh];
}

extension SbColorsContext on BuildContext {
  SbColors get sb => Theme.of(this).extension<SbColors>()!;
}

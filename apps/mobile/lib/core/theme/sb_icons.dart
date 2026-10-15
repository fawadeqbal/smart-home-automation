import 'package:flutter/widgets.dart';

/// How an icon is drawn — the design uses regular lines, filled when something is on, duotone in cards.
enum IconWeight { regular, fill, duotone, bold }

/// One icon in every weight, from the Phosphor icon fonts (MIT, bundled in assets/fonts/phosphor).
/// Add an icon by adding one line to [SbIcons] (the code points are in the font; phosphoricons.com lists them).
/// Every IconData is const, so release builds keep only the glyphs the app uses.
@immutable
class SbIconData {
  const SbIconData(
    this.regular,
    this.fill,
    this.duotone,
    this.duotoneBack,
    this.bold,
  );
  final IconData regular;
  final IconData fill;

  /// Duotone icons are two glyphs: the outline, and a soft fill drawn behind it ([duotoneBack]).
  final IconData duotone;
  final IconData duotoneBack;
  final IconData bold;

  IconData weight(IconWeight w) => switch (w) {
    IconWeight.regular => regular,
    IconWeight.fill => fill,
    IconWeight.duotone => duotone,
    IconWeight.bold => bold,
  };
}

/// The app's icon set (Phosphor, like the design).
abstract final class SbIcons {
  static const house = SbIconData(
    IconData(0xe2c2, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe2c2, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe2c3, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe2c2, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe2c2, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // house
  static const rooms = SbIconData(
    IconData(0xe464, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe464, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe465, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe464, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe464, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // squaresFour
  static const routines = SbIconData(
    IconData(0xe1a0, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe1a0, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe1a1, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe1a0, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe1a0, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // clockCounterClockwise
  static const me = SbIconData(
    IconData(0xe4c4, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe4c4, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe4c5, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe4c4, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe4c4, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // userCircle
  static const mic = SbIconData(
    IconData(0xe326, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe326, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe327, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe326, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe326, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // microphone
  static const lightbulb = SbIconData(
    IconData(0xe2dc, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe2dc, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe2dd, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe2dc, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe2dc, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // lightbulb
  static const fan = SbIconData(
    IconData(0xe9f2, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe9f2, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe9f3, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe9f2, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe9f2, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // fan
  static const snowflake = SbIconData(
    IconData(0xe5aa, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe5aa, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe5ab, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe5aa, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe5aa, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // snowflake
  static const monitor = SbIconData(
    IconData(0xe754, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe754, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe755, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe754, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe754, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // television
  static const zap = SbIconData(
    IconData(0xe2de, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe2de, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe2df, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe2de, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe2de, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // lightning
  static const droplet = SbIconData(
    IconData(0xe210, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe210, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe211, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe210, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe210, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // drop
  static const plug = SbIconData(
    IconData(0xe946, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe946, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe947, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe946, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe946, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // plug
  static const thermometer = SbIconData(
    IconData(0xe5c6, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe5c6, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe5c7, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe5c6, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe5c6, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // thermometer
  static const door = SbIconData(
    IconData(0xe7e6, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe7e6, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe7e7, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe7e6, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe7e6, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // doorOpen
  static const waves = SbIconData(
    IconData(0xe6de, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe6de, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe6df, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe6de, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe6de, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // waves
  static const person = SbIconData(
    IconData(0xe73a, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe73a, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe73b, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe73a, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe73a, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // personSimpleWalk
  static const sofa = SbIconData(
    IconData(0xe7f6, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe7f6, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe7f7, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe7f6, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe7f6, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // couch
  static const bed = SbIconData(
    IconData(0xe0cc, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe0cc, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe0cd, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe0cc, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe0cc, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // bed
  static const kitchen = SbIconData(
    IconData(0xe262, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe262, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe263, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe262, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe262, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // forkKnife
  static const bath = SbIconData(
    IconData(0xe81e, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe81e, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe81f, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe81e, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe81e, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // bathtub
  static const car = SbIconData(
    IconData(0xe112, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe112, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe113, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe112, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe112, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // car
  static const tree = SbIconData(
    IconData(0xe6da, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe6da, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe6db, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe6da, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe6da, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // tree
  static const desk = SbIconData(
    IconData(0xed16, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xed16, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xed17, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xed16, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xed16, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // desk
  static const sun = SbIconData(
    IconData(0xe472, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe472, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe473, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe472, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe472, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // sun
  static const moon = SbIconData(
    IconData(0xe330, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe330, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe331, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe330, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe330, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // moon
  static const sparkle = SbIconData(
    IconData(0xe6a2, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe6a2, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe6a3, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe6a2, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe6a2, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // sparkle
  static const signOut = SbIconData(
    IconData(0xe42a, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe42a, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe42b, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe42a, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe42a, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // signOut
  static const filmStrip = SbIconData(
    IconData(0xe792, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe792, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe793, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe792, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe792, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // filmStrip
  static const caretDown = SbIconData(
    IconData(0xe136, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe136, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe137, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe136, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe136, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // caretDown
  static const caretRight = SbIconData(
    IconData(0xe13a, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe13a, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe13b, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe13a, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe13a, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // caretRight
  static const arrowLeft = SbIconData(
    IconData(0xe058, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe058, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe059, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe058, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe058, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // arrowLeft
  static const arrowRight = SbIconData(
    IconData(0xe06c, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe06c, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe06d, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe06c, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe06c, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // arrowRight
  static const check = SbIconData(
    IconData(0xe182, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe182, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe183, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe182, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe182, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // check
  static const x = SbIconData(
    IconData(0xe4f6, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe4f6, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe4f7, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe4f6, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe4f6, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // x
  static const plus = SbIconData(
    IconData(0xe3d4, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe3d4, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe3d5, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe3d4, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe3d4, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // plus
  static const warning = SbIconData(
    IconData(0xe4e0, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe4e0, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe4e1, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe4e0, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe4e0, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // warning
  static const clock = SbIconData(
    IconData(0xe19a, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe19a, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe19b, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe19a, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe19a, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // clock
  static const users = SbIconData(
    IconData(0xe4d6, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe4d6, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe4d7, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe4d6, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe4d6, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // users
  static const userPlus = SbIconData(
    IconData(0xe4d0, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe4d0, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe4d1, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe4d0, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe4d0, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // userPlus
  static const shield = SbIconData(
    IconData(0xe40c, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe40c, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe40f, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe40c, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe40c, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // shieldCheck
  static const pulse = SbIconData(
    IconData(0xe000, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe000, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe001, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe000, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe000, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // pulse
  static const message = SbIconData(
    IconData(0xe168, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe168, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe169, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe168, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe168, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // chatCircle
  static const smartphone = SbIconData(
    IconData(0xe1e0, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe1e0, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe1e1, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe1e0, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe1e0, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // deviceMobile
  static const toggle = SbIconData(
    IconData(0xe676, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe676, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe677, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe676, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe676, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // toggleRight
  static const lock = SbIconData(
    IconData(0xe2fa, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe2fa, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe2fb, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe2fa, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe2fa, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // lock
  static const envelope = SbIconData(
    IconData(0xe214, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe214, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe215, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe214, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe214, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // envelope
  static const eye = SbIconData(
    IconData(0xe220, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe220, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe221, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe220, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe220, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // eye
  static const eyeSlash = SbIconData(
    IconData(0xe224, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe224, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe225, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe224, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe224, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // eyeSlash
  static const globe = SbIconData(
    IconData(0xe288, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe288, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe289, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe288, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe288, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // globe
  static const bell = SbIconData(
    IconData(0xe0ce, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe0ce, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe0cf, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe0ce, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe0ce, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // bell
  static const star = SbIconData(
    IconData(0xe46a, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe46a, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe46b, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe46a, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe46a, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // star
  static const trash = SbIconData(
    IconData(0xe4a6, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe4a6, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe4a7, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe4a6, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe4a6, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // trash
  static const share = SbIconData(
    IconData(0xe408, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe408, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe40b, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe408, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe408, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // shareNetwork
  static const keyboard = SbIconData(
    IconData(0xe2d8, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe2d8, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe2d9, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe2d8, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe2d8, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // keyboard
  static const paperPlane = SbIconData(
    IconData(0xe398, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe398, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe399, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe398, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe398, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // paperPlaneTilt
  static const wifiSlash = SbIconData(
    IconData(0xe4f2, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe4f2, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe4f3, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe4f2, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe4f2, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // wifiSlash
  static const speaker = SbIconData(
    IconData(0xe44a, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe44a, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe44b, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe44a, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe44a, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // speakerHigh
  static const speakerOff = SbIconData(
    IconData(0xe45a, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe45a, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe45b, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe45a, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe45a, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // speakerSlash
}

/// Draws an [SbIconData] in a weight. Duotone icons get their soft second tone from the same colour.
class SbIcon extends StatelessWidget {
  const SbIcon(
    this.icon, {
    super.key,
    this.size = 20,
    this.color,
    this.weight = IconWeight.regular,
    this.semanticLabel,
  });

  final SbIconData icon;
  final double size;
  final Color? color;
  final IconWeight weight;
  final String? semanticLabel;

  @override
  Widget build(BuildContext context) {
    final glyph = Icon(
      icon.weight(weight),
      size: size,
      color: color,
      semanticLabel: semanticLabel,
    );
    if (weight != IconWeight.duotone) return glyph;
    final c = color ?? IconTheme.of(context).color ?? const Color(0xFF000000);
    return Stack(
      alignment: Alignment.center,
      children: [
        Icon(icon.duotoneBack, size: size, color: c.withValues(alpha: .2)),
        glyph,
      ],
    );
  }
}

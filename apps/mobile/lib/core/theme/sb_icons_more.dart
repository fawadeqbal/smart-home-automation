import 'package:flutter/widgets.dart';

import 'sb_icons.dart';

/// More Phosphor icons for the pages home-mobile added (electricity, bills, account, help…), kept apart from
/// [SbIcons] so the two lists don't collide when other work adds icons too. Same fonts, same weights.
abstract final class MoreIcons {
  static const copy = SbIconData(
    IconData(0xe1ca, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe1ca, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe1cb, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe1ca, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe1ca, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // copy
  static const wallet = SbIconData(
    IconData(0xe68a, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe68a, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe68b, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe68a, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe68a, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // wallet
  static const receipt = SbIconData(
    IconData(0xe3ec, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe3ec, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe3ed, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe3ec, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe3ec, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // receipt
  static const phone = SbIconData(
    IconData(0xe3b8, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe3b8, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe3b9, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe3b8, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe3b8, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // phone
  static const key = SbIconData(
    IconData(0xe2d6, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe2d6, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe2d7, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe2d6, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe2d6, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // key
  static const question = SbIconData(
    IconData(0xe3e8, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe3e8, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe3e9, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe3e8, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe3e8, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // question
  static const book = SbIconData(
    IconData(0xe0e6, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe0e6, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe0e7, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe0e6, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe0e6, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // book-open
  static const search = SbIconData(
    IconData(0xe30c, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe30c, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe30d, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe30c, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe30c, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // magnifying-glass
  static const pencil = SbIconData(
    IconData(0xe3b4, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe3b4, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe3b5, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe3b4, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe3b4, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // pencil-simple
  static const signature = SbIconData(
    IconData(0xebac, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xebac, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xebad, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xebac, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xebac, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // signature
  static const image = SbIconData(
    IconData(0xe2ca, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe2ca, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe2cb, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe2ca, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe2ca, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // image
  static const wifi = SbIconData(
    IconData(0xe4ea, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe4ea, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe4eb, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe4ea, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe4ea, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // wifi-high
  static const cpu = SbIconData(
    IconData(0xe610, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe610, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe611, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe610, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe610, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // cpu
  static const chart = SbIconData(
    IconData(0xe150, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe150, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe151, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe150, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe150, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // chart-bar
  static const fileText = SbIconData(
    IconData(0xe23a, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe23a, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe23b, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe23a, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe23a, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // file-text
  static const arrowUp = SbIconData(
    IconData(0xe08e, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe08e, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe08f, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe08e, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe08e, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // arrow-up
  static const arrowDown = SbIconData(
    IconData(0xe03e, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe03e, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe03f, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe03e, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe03e, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // arrow-down
  static const lifebuoy = SbIconData(
    IconData(0xe63a, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe63a, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe63b, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe63a, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe63a, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // lifebuoy
  static const gear = SbIconData(
    IconData(0xe270, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe270, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe271, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe270, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe270, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // gear
  static const dots = SbIconData(
    IconData(0xe1fe, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe1fe, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe1ff, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe1fe, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe1fe, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // dots-three
  static const listChecks = SbIconData(
    IconData(0xeadc, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xeadc, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xeadd, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xeadc, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xeadc, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // list-checks
  static const sealCheck = SbIconData(
    IconData(0xe606, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe606, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe607, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe606, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe606, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // seal-check
  static const bank = SbIconData(
    IconData(0xe0b4, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe0b4, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe0b5, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe0b4, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe0b4, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // bank
  static const calendar = SbIconData(
    IconData(0xe108, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe108, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe109, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe108, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe108, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // calendar
  static const info = SbIconData(
    IconData(0xe2ce, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe2ce, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe2cf, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe2ce, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe2ce, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // info
  static const deviceMobile = SbIconData(
    IconData(0xe1e0, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe1e0, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe1e1, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe1e0, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe1e0, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // device-mobile
  static const desktop = SbIconData(
    IconData(0xe560, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe560, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe561, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe560, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe560, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // desktop
  static const lockKey = SbIconData(
    IconData(0xe2fe, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe2fe, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe2ff, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe2fe, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe2fe, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // lock-key
  static const thermometer = SbIconData(
    IconData(0xe5c6, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe5c6, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe5c7, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe5c6, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe5c6, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // thermometer
}

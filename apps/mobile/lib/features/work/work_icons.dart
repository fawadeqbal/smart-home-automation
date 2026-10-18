import 'package:flutter/widgets.dart';

import '../../core/theme/sb_icons.dart';

/// Icons the staff screens use (Phosphor, like [SbIcons]). Kept here so the work screens don't
/// collide with the home app's icon list; every IconData is const, so release builds keep only these glyphs.
abstract final class WorkIcons {
  static const mapPin = SbIconData(
    IconData(0xe316, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe316, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe317, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe316, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe316, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // map-pin
  static const phone = SbIconData(
    IconData(0xe3b8, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe3b8, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe3b9, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe3b8, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe3b8, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // phone
  static const whatsapp = SbIconData(
    IconData(0xe5d0, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe5d0, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe5d1, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe5d0, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe5d0, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // whatsapp-logo
  static const wrench = SbIconData(
    IconData(0xe5d4, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe5d4, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe5d5, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe5d4, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe5d4, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // wrench
  static const cpu = SbIconData(
    IconData(0xe610, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe610, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe611, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe610, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe610, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // cpu
  static const ticket = SbIconData(
    IconData(0xe490, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe490, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe491, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe490, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe490, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // ticket
  static const terminal = SbIconData(
    IconData(0xe47e, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe47e, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe47f, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe47e, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe47e, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // terminal
  static const download = SbIconData(
    IconData(0xe20a, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe20a, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe20b, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe20a, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe20a, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // download
  static const restart = SbIconData(
    IconData(0xe094, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe094, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe095, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe094, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe094, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // arrows-clockwise
  static const package = SbIconData(
    IconData(0xe390, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe390, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe391, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe390, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe390, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // package
  static const camera = SbIconData(
    IconData(0xe10e, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe10e, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe10f, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe10e, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe10e, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // camera
  static const image = SbIconData(
    IconData(0xe2ca, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe2ca, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe2cb, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe2ca, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe2ca, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // image
  static const signature = SbIconData(
    IconData(0xebac, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xebac, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xebad, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xebac, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xebac, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // signature
  static const search = SbIconData(
    IconData(0xe30c, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe30c, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe30d, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe30c, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe30c, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // magnifying-glass
  static const checklist = SbIconData(
    IconData(0xeadc, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xeadc, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xeadd, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xeadc, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xeadc, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // list-checks
  static const calendar = SbIconData(
    IconData(0xe10a, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe10a, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe10b, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe10a, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe10a, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // calendar-blank
  static const route = SbIconData(
    IconData(0xe39c, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe39c, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe39d, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe39c, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe39c, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // path
  static const navigate = SbIconData(
    IconData(0xeade, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xeade, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xeadf, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xeade, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xeade, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // navigation-arrow
  static const swap = SbIconData(
    IconData(0xe83c, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe83c, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe83d, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe83c, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe83c, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // swap
  static const wifi = SbIconData(
    IconData(0xe4ea, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe4ea, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe4eb, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe4ea, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe4ea, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // wifi-high
  static const wifiMedium = SbIconData(
    IconData(0xe4ee, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe4ee, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe4ef, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe4ee, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe4ee, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // wifi-medium
  static const wifiLow = SbIconData(
    IconData(0xe4ec, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe4ec, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe4ed, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe4ec, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe4ec, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // wifi-low
  static const key = SbIconData(
    IconData(0xe2d6, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe2d6, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe2d7, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe2d6, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe2d6, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // key
  static const note = SbIconData(
    IconData(0xe34c, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe34c, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe34d, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe34c, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe34c, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // note-pencil
  static const pencil = SbIconData(
    IconData(0xe3b4, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe3b4, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe3b5, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe3b4, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe3b4, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // pencil-simple
  static const chat = SbIconData(
    IconData(0xe16e, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe16e, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe16f, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe16e, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe16e, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // chat-circle-text
  static const circuit = SbIconData(
    IconData(0xe9c2, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe9c2, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe9c3, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe9c2, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe9c2, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // circuitry
  static const checkSquare = SbIconData(
    IconData(0xe186, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe186, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe187, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe186, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe186, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // check-square
  static const square = SbIconData(
    IconData(0xe45e, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe45e, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe45f, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe45e, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe45e, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // square
  static const briefcase = SbIconData(
    IconData(0xe0ee, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe0ee, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe0ef, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe0ee, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe0ee, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // briefcase
  static const eye = SbIconData(
    IconData(0xe220, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe220, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe221, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe220, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe220, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // eye
  static const caretLeft = SbIconData(
    IconData(0xe138, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe138, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe139, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe138, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe138, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // caret-left
  static const info = SbIconData(
    IconData(0xe2ce, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe2ce, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe2cf, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe2ce, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe2ce, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // info
  static const trash = SbIconData(
    IconData(0xe4a6, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe4a6, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe4a7, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe4a6, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe4a6, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // trash
  static const clipboard = SbIconData(
    IconData(0xe198, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe198, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe199, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe198, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe198, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // clipboard-text
  static const openOut = SbIconData(
    IconData(0xe5de, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe5de, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe5df, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe5de, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe5de, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // arrow-square-out
  static const lockSimple = SbIconData(
    IconData(0xe308, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe308, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe309, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe308, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe308, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // lock-simple
  static const send = SbIconData(
    IconData(0xe398, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe398, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe399, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe398, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe398, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // paper-plane-tilt
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
  static const cloudSlash = SbIconData(
    IconData(0xe1b6, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe1b6, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe1b7, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe1b6, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe1b6, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // cloud-slash
  static const cloudCheck = SbIconData(
    IconData(0xe1b0, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe1b0, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe1b1, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe1b0, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe1b0, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // cloud-check
  static const images = SbIconData(
    IconData(0xe836, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe836, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe837, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe836, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe836, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // images
  static const toolbox = SbIconData(
    IconData(0xeca0, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xeca0, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xeca1, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xeca0, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xeca0, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // toolbox
  static const userSwitch = SbIconData(
    IconData(0xe756, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe756, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe757, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe756, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe756, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // user-switch
  static const receipt = SbIconData(
    IconData(0xe3ec, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe3ec, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(
      0xe3f1,
      fontFamily: 'PhosphorDuotone',
      matchTextDirection: true,
    ), // its outline isn't next to the fill in this font
    IconData(0xe3ec, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe3ec, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // receipt
  static const lightning = SbIconData(
    IconData(0xe2de, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe2de, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe2df, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe2de, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe2de, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // lightning
  static const plugs = SbIconData(
    IconData(0xeb5a, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xeb5a, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xeb5b, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xeb5a, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xeb5a, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // plugs-connected
  static const checkCircle = SbIconData(
    IconData(0xe184, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe184, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe185, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe184, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe184, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // check-circle
  static const arrowUp = SbIconData(
    IconData(0xe08e, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe08e, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe08f, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe08e, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe08e, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // arrow-up
  static const stack = SbIconData(
    IconData(0xe466, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe466, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe467, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe466, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe466, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // stack
  static const xCircle = SbIconData(
    IconData(0xe4f8, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe4f8, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe4f9, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe4f8, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe4f8, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // x-circle
  static const house = SbIconData(
    IconData(0xe2c4, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe2c4, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe2c5, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe2c4, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe2c4, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // house-line
  static const power = SbIconData(
    IconData(0xe3da, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe3da, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe3db, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe3da, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe3da, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // power
  static const broadcast = SbIconData(
    IconData(0xe0f2, fontFamily: 'PhosphorRegular', matchTextDirection: true),
    IconData(0xe0f2, fontFamily: 'PhosphorFill', matchTextDirection: true),
    IconData(0xe0f3, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe0f2, fontFamily: 'PhosphorDuotone', matchTextDirection: true),
    IconData(0xe0f2, fontFamily: 'PhosphorBold', matchTextDirection: true),
  ); // broadcast
}

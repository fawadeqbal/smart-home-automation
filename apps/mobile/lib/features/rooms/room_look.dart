import '../../core/theme/sb_icons.dart';

/// A room's icon from its name (the web app's rules, plus a few more). First match wins.
final _rules = <(RegExp, SbIconData)>[
  (RegExp('living|lounge|hall|drawing|sitting'), SbIcons.sofa),
  (RegExp('kitchen|dining'), SbIcons.kitchen),
  (RegExp('bath|wash|toilet'), SbIcons.bath),
  (RegExp('garage|parking|car porch'), SbIcons.car),
  (RegExp('garden|lawn|balcony|terrace|yard'), SbIcons.tree),
  (RegExp('roof|chhat'), SbIcons.sun),
  (RegExp('gate|porch|entrance|door'), SbIcons.door),
  (RegExp('study|office'), SbIcons.desk),
  (RegExp('pump|utility|store'), SbIcons.zap),
  (RegExp(r'bed|kids|master|guest|nursery|room$'), SbIcons.bed),
];

SbIconData roomIcon(String name) {
  final n = name.toLowerCase();
  for (final (re, icon) in _rules) {
    if (re.hasMatch(n)) return icon;
  }
  return SbIcons.house;
}

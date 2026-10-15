import '../../core/theme/sb_colors.dart';
import '../../core/theme/sb_icons.dart';
import '../../data/models/automation.dart';

/// A scene's colours and icon, from its icon name or its name ("Good night" → the night look).
(ScenePalette, SbIconData) sceneLook(Scene s, int index) {
  final key = '${s.icon} ${s.name}'.toLowerCase();
  if (RegExp('moon|night|sleep|so ').hasMatch(key)) return (ScenePalette.night, SbIcons.moon);
  if (RegExp('sun|morning|wake|subah').hasMatch(key)) return (ScenePalette.morning, SbIcons.sun);
  if (RegExp('movie|film|tv|monitor|cinema').hasMatch(key)) return (ScenePalette.movie, SbIcons.filmStrip);
  if (RegExp('away|leave|out|log-out|bahar').hasMatch(key)) return (ScenePalette.away, SbIcons.signOut);
  return (
    ScenePalette.rotation[index % ScenePalette.rotation.length],
    SbIcons.sparkle,
  );
}

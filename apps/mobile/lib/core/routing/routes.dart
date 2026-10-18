import 'package:flutter/widgets.dart';
import 'package:go_router/go_router.dart';

/// Every path in the app. Pages that can open inside any tab (a room, activity, health, family)
/// live under each tab, so the tab bar stays and Back returns to where you were.
abstract final class Routes {
  static const splash = '/';
  static const server = '/server';
  static const login = '/login';
  static const noHome = '/no-home';
  static const ask = '/ask';
  /// switching the home over its Wi‑Fi when the internet is down (open whatever the session)
  static const local = '/local';

  static const home = '/home';
  static const rooms = '/rooms';
  static const routines = '/routines';
  static const me = '/me';
  static const tabs = [home, rooms, routines, me];

  // pages opened inside a tab
  static const room = 'room/:roomId';
  static const activity = 'activity';
  static const health = 'health';
  static const family = 'family';
  static const energy = 'energy';
}

extension TabNavigation on BuildContext {
  /// The tab this page belongs to ("/home", "/rooms", …).
  String get tabRoot {
    final segments = GoRouterState.of(this).uri.pathSegments;
    final root = segments.isEmpty ? Routes.home : '/${segments.first}';
    return Routes.tabs.contains(root) ? root : Routes.home;
  }

  /// Opens a page inside the current tab: `openInTab('room/123')`, `openInTab('activity')`.
  void openInTab(String sub) => go('$tabRoot/$sub');
}

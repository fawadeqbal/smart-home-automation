import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../features/activity/activity_screen.dart';
import '../../features/assistant/ask_screen.dart';
import '../../features/auth/login_screen.dart';
import '../../features/auth/no_home_screen.dart';
import '../../features/auth/server_screen.dart';
import '../../features/auth/splash_screen.dart';
import '../../features/energy/energy_screen.dart';
import '../../features/family/family_screen.dart';
import '../../features/health/health_screen.dart';
import '../../features/home/home_screen.dart';
import '../../features/local/local_control_screen.dart';
import '../../features/me/me_screen.dart';
import '../../features/notices/notifications_screen.dart';
import '../../features/rooms/room_screen.dart';
import '../../features/rooms/rooms_screen.dart';
import '../../features/routines/routines_screen.dart';
import '../../features/shell/app_shell.dart';
import '../../features/work/work_routes.dart';
import '../../state/session.dart';
import '../../state/work.dart';
import '../config/app_settings.dart';
import 'routes.dart';

final _rootKey = GlobalKey<NavigatorState>(debugLabel: 'root');

/// Pages that open inside whichever tab you're in (the tab bar stays; Back returns to the tab).
List<RouteBase> _insideTab() => [
  GoRoute(
    path: Routes.room,
    builder: (_, s) => RoomScreen(roomId: s.pathParameters['roomId']!),
  ),
  GoRoute(path: Routes.activity, builder: (_, _) => const ActivityScreen()),
  GoRoute(path: Routes.health, builder: (_, _) => const HealthScreen()),
  GoRoute(path: Routes.family, builder: (_, _) => const FamilyScreen()),
  GoRoute(path: Routes.energy, builder: (_, _) => const EnergyScreen()),
  GoRoute(path: Routes.notifications, builder: (_, _) => const NotificationsScreen()),
];

StatefulShellBranch _tab(String path, Widget screen) => StatefulShellBranch(
  routes: [
    GoRoute(
      path: path,
      pageBuilder: (_, _) => NoTransitionPage(child: screen),
      routes: _insideTab(),
    ),
  ],
);

/// Where someone may be, given the server address and the session.
String? _redirect(Ref ref, GoRouterState state) {
  final loc = state.matchedLocation;
  final server = ref.read(serverUrlProvider);
  if (server == null) return loc == Routes.server ? null : Routes.server;
  if (loc == Routes.local) return null; // works signed in or not: it uses the passes on the phone
  final session = ref.read(sessionProvider);
  if (!session.hasValue) return loc == Routes.splash ? null : Routes.splash;
  final me = session.value;
  if (me == null) return loc == Routes.login || loc == Routes.server ? null : Routes.login;
  // staff: the work tabs, or the home app (their own home, or a customer's "as the customer sees it")
  final work = workRedirect(ref, me, loc);
  if (work.handled) return work.to == loc ? null : work.to;
  if (me.home == null) return loc == Routes.noHome ? null : Routes.noHome;
  const outside = [Routes.splash, Routes.login, Routes.server, Routes.noHome];
  return outside.contains(loc) ? Routes.home : null;
}

final routerProvider = Provider<GoRouter>((ref) {
  // re-check the redirect whenever the server or the session changes
  final refresh = ValueNotifier<int>(0);
  ref.listen(serverUrlProvider, (_, _) => refresh.value++);
  ref.listen(sessionProvider, (_, _) => refresh.value++);
  ref.listen(atWorkProvider, (_, _) => refresh.value++);
  ref.listen(customerViewProvider, (_, _) => refresh.value++);
  ref.onDispose(refresh.dispose);

  return GoRouter(
    navigatorKey: _rootKey,
    initialLocation: Routes.home,
    refreshListenable: refresh,
    redirect: (_, state) => _redirect(ref, state),
    routes: [
      GoRoute(path: Routes.splash, builder: (_, _) => const SplashScreen()),
      GoRoute(path: Routes.server, builder: (_, _) => const ServerScreen()),
      GoRoute(path: Routes.login, builder: (_, _) => const LoginScreen()),
      GoRoute(path: Routes.noHome, builder: (_, _) => const NoHomeScreen()),
      GoRoute(path: Routes.local, builder: (_, _) => const LocalControlScreen()),
      GoRoute(
        path: Routes.ask,
        parentNavigatorKey: _rootKey,
        pageBuilder: (_, state) => CustomTransitionPage(
          key: state.pageKey,
          fullscreenDialog: true,
          transitionDuration: const Duration(milliseconds: 450),
          reverseTransitionDuration: const Duration(milliseconds: 300),
          child: const AskScreen(),
          transitionsBuilder: (_, a, _, child) => SlideTransition(
            position: Tween(begin: const Offset(0, 1), end: Offset.zero).animate(
              CurvedAnimation(parent: a, curve: const Cubic(.2, .9, .3, 1)),
            ),
            child: FadeTransition(opacity: a, child: child),
          ),
        ),
      ),
      StatefulShellRoute.indexedStack(
        builder: (_, _, shell) => AppShell(shell: shell),
        branches: [
          _tab(Routes.home, const HomeScreen()),
          _tab(Routes.rooms, const RoomsScreen()),
          _tab(Routes.routines, const RoutinesScreen()),
          _tab(Routes.me, const MeScreen()),
        ],
      ),
      workShellRoute(),
    ],
  );
});

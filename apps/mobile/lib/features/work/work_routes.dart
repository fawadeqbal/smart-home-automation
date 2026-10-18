import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/routing/routes.dart';
import '../../data/models/session.dart';
import '../../state/work.dart';
import 'board_screen.dart';
import 'homes_screen.dart';
import 'installation_screen.dart';
import 'office_screens.dart';
import 'ticket_screen.dart';
import 'tickets_screen.dart';
import 'today_screen.dart';
import 'work_home_screen.dart';
import 'work_me_screen.dart';
import 'work_shell.dart';

/// Every path of the staff screens ("Work"). Pages open inside the tab you're in, so Back returns there.
abstract final class WorkRoutes {
  static const root = '/work';
  static const today = '/work/today';
  static const homes = '/work/homes';
  static const tickets = '/work/tickets';
  static const me = '/work/me';
  static const tabs = [today, homes, tickets, me];

  // pages inside a tab: `home/<id>`, `home/<id>/board/<board id>`, `home/<id>/installation`, `ticket/<id>`…
  static String home(String homeId) => 'home/$homeId';
  static String board(String homeId, String nodeId) => 'home/$homeId/board/${Uri.encodeComponent(nodeId)}';
  static String install(String homeId) => 'home/$homeId/installation';
  static String ticket(String id) => 'ticket/$id';
  static const stock = 'stock';
  static const requests = 'requests';
  static const quotes = 'quotes';
  static const outages = 'outages';
}

extension WorkNavigation on BuildContext {
  /// The work tab this page belongs to ("/work/today", "/work/homes", …).
  String get workTab {
    final s = GoRouterState.of(this).uri.pathSegments;
    final root = s.length >= 2 && s.first == 'work' ? '/work/${s[1]}' : WorkRoutes.today;
    return WorkRoutes.tabs.contains(root) ? root : WorkRoutes.today;
  }

  /// Opens a page inside the current work tab: `openWork(WorkRoutes.home(id))`.
  void openWork(String sub) => go('$workTab/$sub');
}

/// Where a staff member belongs. `handled`: the work rules decided (go to [to], or stay when it is
/// null); not handled: the home app's usual rules apply.
///
/// * at work, they see the work tabs — and the home app only for a customer's home they opened "as the
///   customer sees it";
/// * in "My home" (or not staff), the work pages send them back to the home app.
({bool handled, String? to}) workRedirect(Ref ref, Me me, String loc) {
  final inWork = loc == WorkRoutes.root || loc.startsWith('${WorkRoutes.root}/');
  if (me.staff == null) return inWork ? (handled: true, to: Routes.home) : (handled: false, to: null);
  if (!ref.read(atWorkProvider)) return inWork ? (handled: true, to: Routes.home) : (handled: false, to: null);
  final viewing = ref.read(customerViewProvider);
  if (viewing != null && me.home?.id == viewing) {
    // a customer's home, as they see it: the home app (and the way back to work) both work
    return inWork || !const [Routes.splash, Routes.login, Routes.server, Routes.noHome].contains(loc)
        ? (handled: true, to: null)
        : (handled: true, to: Routes.home);
  }
  if (inWork || loc == Routes.local) return (handled: true, to: loc == WorkRoutes.root ? WorkRoutes.today : null);
  return (handled: true, to: WorkRoutes.today);
}

List<RouteBase> _insideWorkTab() => [
  GoRoute(
    path: 'home/:homeId',
    builder: (_, s) => WorkHomeScreen(homeId: s.pathParameters['homeId']!),
    routes: [
      GoRoute(
        path: 'board/:nodeId',
        builder: (_, s) => BoardScreen(
          homeId: s.pathParameters['homeId']!,
          nodeId: Uri.decodeComponent(s.pathParameters['nodeId']!),
          tab: s.uri.queryParameters['tab'],
        ),
      ),
      GoRoute(
        path: 'installation',
        builder: (_, s) => InstallationScreen(homeId: s.pathParameters['homeId']!),
      ),
    ],
  ),
  GoRoute(
    path: 'ticket/:ticketId',
    builder: (_, s) => TicketScreen(ticketId: s.pathParameters['ticketId']!),
  ),
  GoRoute(path: WorkRoutes.stock, builder: (_, _) => const StockScreen()),
  GoRoute(path: WorkRoutes.requests, builder: (_, _) => const VisitRequestsScreen()),
  GoRoute(path: WorkRoutes.quotes, builder: (_, _) => const QuotesScreen()),
  GoRoute(path: WorkRoutes.outages, builder: (_, _) => const StaffOutagesScreen()),
];

StatefulShellBranch _tab(String path, Widget screen) => StatefulShellBranch(
  routes: [
    GoRoute(
      path: path,
      pageBuilder: (_, _) => NoTransitionPage(child: screen),
      routes: _insideWorkTab(),
    ),
  ],
);

/// The work tabs (Today · Homes · Tickets · Me) under their own tab bar.
RouteBase workShellRoute() => StatefulShellRoute.indexedStack(
  builder: (_, _, shell) => WorkShell(shell: shell),
  branches: [
    _tab(WorkRoutes.today, const TodayScreen()),
    _tab(WorkRoutes.homes, const HomesScreen()),
    _tab(WorkRoutes.tickets, const TicketsScreen()),
    _tab(WorkRoutes.me, const WorkMeScreen()),
  ],
);

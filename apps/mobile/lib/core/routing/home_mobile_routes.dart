import 'package:go_router/go_router.dart';

import '../../features/account/account_screen.dart';
import '../../features/billing/billing_screen.dart';
import '../../features/billing/invoice_screen.dart';
import '../../features/devices/device_screen.dart';
import '../../features/help/help_center_screen.dart';
import '../../features/installation/installation_screen.dart';
import '../../features/notices/alert_settings_screen.dart';
import '../../features/summary/summary_screen.dart';
import 'routes.dart';

/// The pages that make the phone app complete without the web (home-mobile): a device's own page,
/// plan & bills, account, help center, summary, installation report, notification settings. They
/// open inside whichever tab you're in, like the other pages in `_insideTab`.
List<RouteBase> homeMobileRoutes() => [
  GoRoute(path: Routes.device, builder: (_, s) => DeviceScreen(deviceId: s.pathParameters['deviceId']!)),
  GoRoute(
    path: Routes.billing,
    builder: (_, _) => const BillingScreen(),
    routes: [GoRoute(path: ':invoiceId', builder: (_, s) => InvoiceScreen(invoiceId: s.pathParameters['invoiceId']!))],
  ),
  GoRoute(path: Routes.account, builder: (_, _) => const AccountScreen()),
  GoRoute(
    path: Routes.help,
    builder: (_, _) => const HelpCenterScreen(),
    routes: [GoRoute(path: ':articleId', builder: (_, s) => HelpArticleScreen(articleId: s.pathParameters['articleId']!))],
  ),
  GoRoute(path: Routes.summary, builder: (_, _) => const SummaryScreen()),
  GoRoute(path: Routes.installation, builder: (_, _) => const InstallationScreen()),
  GoRoute(path: Routes.alerts, builder: (_, _) => const AlertSettingsScreen()),
];

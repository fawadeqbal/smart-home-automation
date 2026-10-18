import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/realtime/live_client.dart';
import '../data/models/billing.dart';
import '../data/models/energy.dart';
import '../data/models/power.dart';
import '../data/repositories/billing_repository.dart';
import '../data/repositories/home_repository.dart';
import 'session.dart';

/// Electricity and the company's bills: the Electricity page's estimates for any stretch of days,
/// UPS mode, the plan and its invoices.

/// The estimate for the last [days] days (1 = today), as the Electricity page's period switch picks.
final energyForProvider = FutureProvider.family<Energy, int>((ref, days) async {
  if (ref.watch(currentHomeIdProvider) == null) return const Energy();
  return ref.read(homeRepositoryProvider).energy(days: days);
});

/// UPS mode (owners and admins; not loaded for anyone else). Reloads on `power.changed`.
final gridProvider = FutureProvider<GridSettings>((ref) async {
  final home = ref.watch(sessionProvider.select((s) => s.value?.home));
  if (home == null || !home.role.manages) return const GridSettings();
  final sub = ref.watch(liveClientProvider).on('power.changed').listen((_) => ref.invalidateSelf());
  ref.onDispose(sub.cancel);
  return ref.read(homeRepositoryProvider).grid();
});

/// The plan and bills (owners and admins; an empty, not-loaded one for anyone else).
final billingProvider = FutureProvider<HomeBilling>((ref) async {
  final home = ref.watch(sessionProvider.select((s) => s.value?.home));
  if (home == null || !home.role.manages) return const HomeBilling();
  return ref.read(billingRepositoryProvider).billing();
});

/// The same, but never failing: for the Home screen's notice and the Me row.
final billingQuietProvider = FutureProvider<HomeBilling>((ref) async {
  try {
    return await ref.watch(billingProvider.future);
  } catch (_) {
    return const HomeBilling();
  }
});

final invoiceProvider = FutureProvider.family<InvoiceDetail, String>(
  (ref, id) => ref.read(billingRepositoryProvider).invoice(id),
);

/// How the home did today or this week (`day` / `week`).
final summaryForProvider = FutureProvider.family<HomeSummary, String>((ref, period) async {
  if (ref.watch(currentHomeIdProvider) == null) return const HomeSummary();
  return ref.read(homeRepositoryProvider).summary(period: period);
});

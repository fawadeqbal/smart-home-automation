import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_client.dart';
import '../models/energy.dart';
import '../models/json.dart';
import '../models/outages.dart';
import '../models/people.dart';
import '../models/power.dart';
import '../models/ticket.dart';

/// The open home as a whole: who looks after it, and asking them for help (`/home/*`).
class HomeRepository {
  const HomeRepository(this._api);
  final ApiClient _api;

  Future<HomeWelcome> welcome() async => HomeWelcome.fromJson(asJson(await _api.get<Object?>('/home/welcome')));

  /// Electricity estimates for the switches this person can see.
  Future<Energy> energy({int days = 7}) async => Energy.fromJson(asJson(await _api.get<Object?>('/energy?days=$days')));

  /// How the home did this week (or today), with text to share.
  Future<HomeSummary> summary({String period = 'week'}) async =>
      HomeSummary.fromJson(asJson(await _api.get<Object?>('/home/summary?period=$period')));

  /// Power cuts and internet outages in this home (everyone in the home may see them).
  Future<HomeOutages> outages({int days = 7}) async =>
      HomeOutages.fromJson(asJson(await _api.get<Object?>('/outages?days=$days')));

  /// On UPS or not, and the next expected load-shedding cut (everyone in the home).
  Future<PowerStatus> power() async => PowerStatus.fromJson(asJson(await _api.get<Object?>('/power')));

  Future<Shedding> shedding() async => Shedding.fromJson(asJson(await _api.get<Object?>('/power/shedding')));

  /// The area's schedule as typed from the electricity company's SMS (empty: back to the learned times).
  Future<Shedding> setShedding(List<CutWindow> windows) async =>
      Shedding.fromJson(asJson(await _api.put<Object?>('/power/shedding', {'windows': [for (final w in windows) w.toJson()]})));

  /// This billing month from the meter readings (owners and admins).
  Future<Bill> bill() async => Bill.fromJson(asJson(await _api.get<Object?>('/power/bill')));

  Future<List<MeterReading>> readings() async =>
      asJsonList(await _api.get<Object?>('/power/readings')).map(MeterReading.fromJson).toList();

  Future<Bill> addReading(double kwh, DateTime readAt, {bool newMeter = false}) async => Bill.fromJson(asJson(
      await _api.post<Object?>('/power/readings', {'kwh': kwh, 'readAt': readAt.toUtc().toIso8601String(), 'newMeter': newMeter})));

  Future<Bill> updateReading(String id, double kwh, {DateTime? readAt, bool? newMeter}) async => Bill.fromJson(asJson(await _api.patch<Object?>(
      '/power/readings/$id', {'kwh': kwh, if (readAt != null) 'readAt': readAt.toUtc().toIso8601String(), 'newMeter': ?newMeter})));

  Future<Bill> removeReading(String id) async => Bill.fromJson(asJson(await _api.delete<Object?>('/power/readings/$id')));

  Future<Bill> setBillingDay(int day) async => Bill.fromJson(asJson(await _api.put<Object?>('/power/bill', {'billingDay': day})));

  /// The billing day, the price bands from the bill (empty: one price) and the protected limit (null: off).
  Future<Bill> setBill({required int billingDay, required List<Slab> slabs, required int? protectedLimit}) async =>
      Bill.fromJson(asJson(await _api.put<Object?>('/power/bill', {
        'billingDay': billingDay,
        'slabs': [for (final s in slabs) s.toJson()],
        'protectedLimit': protectedLimit,
      })));

  /// The price of one unit (null: back to the typical rate). Owners and admins.
  Future<void> setTariff(double? tariff) => _api.put<Object?>('/home/tariff', {'tariff': tariff});

  /// UPS mode: the grid sensor and the heavy loads (owners and admins).
  Future<GridSettings> grid() async => GridSettings.fromJson(asJson(await _api.get<Object?>('/power/grid')));

  Future<GridSettings> setGrid({required List<String> loads, required bool restore}) async =>
      GridSettings.fromJson(asJson(await _api.put<Object?>('/power/grid', {'loads': loads, 'restore': restore})));

  /// The home's summary emailed to me; answers the address it went to.
  Future<String> emailSummary(String period) async => str(asJson(await _api.post<Object?>('/home/summary/email?period=$period'))['to']);

  /// A message to the installer and the company's support (owners and admins).
  /// Opens a help request (anyone in the home may); the installer's team answers in it.
  Future<Ticket> askForHelp(String message, {String? title, String? category}) async => Ticket.fromJson(asJson(await _api.post<Object?>(
      '/support/tickets', {'body': message, if (title != null && title.isNotEmpty) 'title': title, 'category': ?category})));

  Future<List<Ticket>> tickets() async => asJsonList(await _api.get<Object?>('/support/tickets')).map(Ticket.fromJson).toList();

  Future<Ticket> ticket(String id) async => Ticket.fromJson(asJson(await _api.get<Object?>('/support/tickets/$id')));

  Future<Ticket> replyToTicket(String id, String body, {bool? solved}) async =>
      Ticket.fromJson(asJson(await _api.post<Object?>('/support/tickets/$id/reply', {'body': body, 'solved': ?solved})));

  /// Rates the help on a solved request (the person who asked; can be changed for 7 days).
  Future<Ticket> rateTicket(String id, int stars, {String? comment}) async => Ticket.fromJson(asJson(
      await _api.post<Object?>('/support/tickets/$id/rating', {'stars': stars, if (comment != null && comment.trim().isNotEmpty) 'comment': comment.trim()})));
}

final homeRepositoryProvider = Provider<HomeRepository>(
  (ref) => HomeRepository(ref.watch(apiClientProvider)),
);

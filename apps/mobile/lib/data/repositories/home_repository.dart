import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_client.dart';
import '../models/energy.dart';
import '../models/json.dart';
import '../models/outages.dart';
import '../models/people.dart';
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

  /// A message to the installer and the company's support (owners and admins).
  /// Opens a help request (anyone in the home may); the installer's team answers in it.
  Future<Ticket> askForHelp(String message) async =>
      Ticket.fromJson(asJson(await _api.post<Object?>('/support/tickets', {'body': message})));

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

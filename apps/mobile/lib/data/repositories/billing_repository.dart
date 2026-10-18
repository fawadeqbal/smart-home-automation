import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_client.dart';
import '../models/billing.dart';
import '../models/json.dart';
import '../models/ticket.dart';

/// The home's maintenance plan and bills from the company (`/billing`, owners and admins).
class BillingRepository {
  const BillingRepository(this._api);
  final ApiClient _api;

  Future<HomeBilling> billing() async => HomeBilling.fromJson(asJson(await _api.get<Object?>('/billing')));

  Future<InvoiceDetail> invoice(String id) async => InvoiceDetail.fromJson(asJson(await _api.get<Object?>('/billing/invoices/$id')));

  /// "I've paid": a help request to the company's team with the reference, so they can mark it paid
  /// (the team records payments; the home can't mark a bill paid itself).
  Future<Ticket> tellPaid(InvoiceDetail detail, {required String method, required String reference, String? note}) async =>
      Ticket.fromJson(asJson(await _api.post<Object?>('/support/tickets', {
        'title': 'Paid invoice ${detail.invoice.number}',
        'body': detail.paidMessage(method: method, reference: reference, note: note),
        'category': 'billing',
      })));
}

final billingRepositoryProvider = Provider<BillingRepository>((ref) => BillingRepository(ref.watch(apiClientProvider)));

import 'package:flutter/foundation.dart';
import 'package:intl/intl.dart';

import 'energy.dart';
import 'json.dart';

/// How the company takes payments (set in the console's company settings); any of them may be missing.
@immutable
class PayDetails {
  const PayDetails({this.bank, this.jazzcash, this.easypaisa});

  factory PayDetails.fromJson(Object? v) {
    final j = asJson(v);
    return PayDetails(bank: strOrNull(j['bank']), jazzcash: strOrNull(j['jazzcash']), easypaisa: strOrNull(j['easypaisa']));
  }

  final String? bank, jazzcash, easypaisa;

  /// (label, what to copy), in the order the web lists them.
  List<(String, String)> get ways => [
        if (jazzcash != null) ('JazzCash', jazzcash!),
        if (easypaisa != null) ('Easypaisa', easypaisa!),
        if (bank != null) ('Bank', bank!),
      ];

  bool get isEmpty => ways.isEmpty;

  /// "JazzCash: 0300 1234567" lines, like the web's `payLines`.
  List<String> get lines => [for (final (l, v) in ways) '$l: $v'];
}

/// A calendar day from the API ("2026-10-20"): "20 Oct 2026".
String dayText(String iso) {
  final d = DateTime.tryParse(iso.length >= 10 ? iso.substring(0, 10) : iso);
  return d == null ? iso : DateFormat('d MMM y').format(d);
}

/// The home's maintenance plan with the company (`contract` in `/billing`).
@immutable
class Contract {
  const Contract({
    required this.id,
    required this.plan,
    this.amount = 0,
    this.period = 'MONTHLY',
    this.periodText = 'a month',
    this.visitsIncluded = 0,
    this.startsOn = '',
    this.endsOn,
    this.nextInvoiceOn = '',
    this.status = 'ACTIVE',
    this.notes = '',
  });

  factory Contract.fromJson(Json j) => Contract(
        id: str(j['id']),
        plan: str(j['plan'], 'Plan'),
        amount: integer(j['amount']),
        period: str(j['period'], 'MONTHLY'),
        periodText: str(j['periodText'], 'a month'),
        visitsIncluded: integer(j['visitsIncluded']),
        startsOn: str(j['startsOn']),
        endsOn: strOrNull(j['endsOn']),
        nextInvoiceOn: str(j['nextInvoiceOn']),
        status: str(j['status'], 'ACTIVE'),
        notes: str(j['notes']),
      );

  final String id, plan;
  final int amount;

  /// MONTHLY, QUARTERLY or YEARLY.
  final String period;
  final String periodText;
  final int visitsIncluded;
  final String startsOn;
  final String? endsOn;
  final String nextInvoiceOn;

  /// ACTIVE or PAUSED (an ended one isn't sent).
  final String status;
  final String notes;

  bool get paused => status == 'PAUSED';

  /// "Rs 2,500 a month"
  String get priceText => '${Energy.rupees(amount)} $periodText';

  /// "1 visit included each month" (null without visits).
  String? get visitsText {
    if (visitsIncluded == 0) return null;
    final each = switch (period) {
      'QUARTERLY' => 'quarter',
      'YEARLY' => 'year',
      _ => 'month',
    };
    return '$visitsIncluded visit${visitsIncluded == 1 ? '' : 's'} included each $each';
  }

  /// How many days until it ends (negative: ended), from [today].
  int? daysLeft(DateTime today) {
    final end = endsOn == null ? null : DateTime.tryParse(endsOn!);
    if (end == null) return null;
    return DateTime(end.year, end.month, end.day).difference(DateTime(today.year, today.month, today.day)).inDays;
  }
}

/// A bill from the company: for the plan's period or a one-off visit.
@immutable
class Invoice {
  const Invoice({
    required this.id,
    required this.number,
    this.description = '',
    this.amount = 0,
    this.issuedOn = '',
    this.dueOn = '',
    this.status = 'DUE',
    this.late = false,
    this.paidOn,
    this.method,
    this.reference,
  });

  factory Invoice.fromJson(Json j) => Invoice(
        id: str(j['id']),
        number: integer(j['number']),
        description: str(j['description']),
        amount: integer(j['amount']),
        issuedOn: str(j['issuedOn']),
        dueOn: str(j['dueOn']),
        status: str(j['status'], 'DUE'),
        late: boolean(j['late']),
        paidOn: strOrNull(j['paidOn']),
        method: strOrNull(j['method']),
        reference: strOrNull(j['reference']),
      );

  final String id;
  final int number;
  final String description;
  final int amount;
  final String issuedOn, dueOn;

  /// DUE, PAID or VOID.
  final String status;

  /// Due and past its due date.
  final bool late;
  final String? paidOn, method, reference;

  bool get due => status == 'DUE';
  bool get paid => status == 'PAID';

  /// "Paid", "Overdue", "Due", "Cancelled".
  String get statusText => paid
      ? 'Paid'
      : status == 'VOID'
          ? 'Cancelled'
          : late
              ? 'Overdue'
              : 'Due';

  /// "Invoice 12 · due 26 Oct 2026" / "Invoice 11 · paid 18 Sept 2026"
  String get line => 'Invoice $number · ${paid && paidOn != null ? 'paid ${dayText(paidOn!)}' : late ? 'was due ${dayText(dueOn)}' : 'due ${dayText(dueOn)}'}';

  static const methods = {
    'cash': 'Cash',
    'bank': 'Bank transfer',
    'jazzcash': 'JazzCash',
    'easypaisa': 'Easypaisa',
    'cheque': 'Cheque',
    'other': 'Other',
  };

  /// "Paid on 18 Sept 2026 by JazzCash (ref. JC-88231). Thank you!"
  String get paidText => 'Paid on ${dayText(paidOn ?? issuedOn)}'
      '${method != null ? ' by ${methods[method] ?? method}' : ''}'
      '${reference != null ? ' (ref. $reference)' : ''}. Thank you!';
}

/// The home's plan and bills (`/billing`, owners and admins).
@immutable
class HomeBilling {
  const HomeBilling({this.company = '', this.pay = const PayDetails(), this.contract, this.invoices = const [], this.due = 0, this.loaded = false});

  factory HomeBilling.fromJson(Json j) => HomeBilling(
        company: str(j['company']),
        pay: PayDetails.fromJson(j['pay']),
        contract: j['contract'] is Map ? Contract.fromJson(asJson(j['contract'])) : null,
        invoices: asJsonList(j['invoices']).map(Invoice.fromJson).toList(),
        due: integer(j['due']),
        loaded: true,
      );

  final String company;
  final PayDetails pay;
  final Contract? contract;
  final List<Invoice> invoices;

  /// Rupees still to pay.
  final int due;
  final bool loaded;

  List<Invoice> get unpaid => invoices.where((i) => i.due).toList();
  bool get anyLate => invoices.any((i) => i.late);

  /// For the Home screen: "Rs 4,300 to pay · 1 overdue" (null when nothing is due).
  String? get dueLine {
    if (due <= 0) return null;
    final late = invoices.where((i) => i.late).length;
    return '${Energy.rupees(due)} to pay${late > 0 ? ' · $late overdue' : ''}';
  }
}

/// One invoice with who it's from and how to pay it (`/billing/invoices/:id`).
@immutable
class InvoiceDetail {
  const InvoiceDetail({required this.invoice, this.company = '', this.billingEmail, this.taxId, this.pay = const PayDetails(), this.billTo = '', this.billToHome = '', this.plan});

  factory InvoiceDetail.fromJson(Json j) {
    final company = asJson(j['company']);
    final to = asJson(j['billTo']);
    final owner = asJson(to['owner']);
    final home = str(to['home']);
    final city = str(to['city']);
    return InvoiceDetail(
      invoice: Invoice.fromJson(j),
      company: str(company['name']),
      billingEmail: strOrNull(company['billingEmail']),
      taxId: strOrNull(company['taxId']),
      pay: PayDetails.fromJson(j['pay']),
      billTo: str(owner['name'], home),
      billToHome: city.isEmpty ? home : '$home, $city',
      plan: strOrNull(asJson(j['contract'])['plan']),
    );
  }

  final Invoice invoice;
  final String company;
  final String? billingEmail, taxId;
  final PayDetails pay;
  final String billTo, billToHome;
  final String? plan;

  /// The message to send on WhatsApp (to the family member who pays, or to keep): what's due and how
  /// to pay — the same words as the web's invoice reminder, from the home's side.
  String shareText() {
    final i = invoice;
    if (i.paid) return 'Invoice ${i.number} from $company (${i.description}): ${Energy.rupees(i.amount)}, paid. ${i.paidText}';
    return [
      'Invoice ${i.number} from $company: ${i.description}.',
      'Amount: *${Energy.rupees(i.amount)}*',
      '${i.late ? 'It was due on' : 'Due by'}: ${dayText(i.dueOn)}',
      if (!pay.isEmpty) '\nYou can pay by:\n${pay.lines.join('\n')}',
      '\nPlease write invoice ${i.number} as the reference.',
    ].join('\n');
  }

  /// The help request that tells the company it was paid ("Paid? Send the reference").
  String paidMessage({required String method, required String reference, String? note}) {
    final i = invoice;
    return [
      'I have paid invoice ${i.number} (${i.description}): ${Energy.rupees(i.amount)} by $method.',
      if (reference.trim().isNotEmpty) 'Reference: ${reference.trim()}',
      if (note != null && note.trim().isNotEmpty) note.trim(),
      'Please mark it as paid. Thank you!',
    ].join('\n');
  }
}

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/routing/routes.dart';
import '../../core/theme/sb_colors.dart';
import '../../core/theme/sb_icons.dart';
import '../../core/theme/sb_icons_more.dart';
import '../../data/models/billing.dart';
import '../../data/models/energy.dart';
import '../../shared/widgets/common.dart';
import '../../shared/widgets/pill.dart';
import '../../state/money.dart';
import '../health/ask_for_help.dart';

/// Plan & bills, like the web's /billing: the home's maintenance plan with the company (what it costs,
/// visits, until when), its bills (due, paid, late), and how to pay. Owners and admins.
class BillingScreen extends ConsumerWidget {
  const BillingScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.sb;
    final billing = ref.watch(billingProvider);
    final b = billing.value;
    return RefreshIndicator(
      color: c.on,
      onRefresh: () => ref.refresh(billingProvider.future),
      child: ListView(
        padding: EdgeInsets.fromLTRB(18, MediaQuery.paddingOf(context).top + 4, 18, 130),
        children: [
          BackPill(onTap: () => context.pop()),
          const SizedBox(height: 12),
          PageTitle(
            'Plan & bills',
            subtitle: b == null || b.company.isEmpty ? 'Your maintenance plan and your bills.' : 'Your maintenance plan with ${b.company}, and your bills.',
          ),
          const SizedBox(height: 18),
          if (b == null)
            billing.hasError ? ErrorView(error: billing.error!, onRetry: () => ref.invalidate(billingProvider)) : const LoadingView(label: 'Opening your bills…')
          else ...[
            if (b.due > 0) ...[_ToPay(billing: b), const SizedBox(height: 22)],
            const SectionHeader('Your plan'),
            const SizedBox(height: 10),
            _Plan(contract: b.contract),
            const SizedBox(height: 22),
            SectionHeader('Bills', subtitle: b.invoices.isEmpty ? null : 'Tap one for the details and how to pay'),
            const SizedBox(height: 10),
            if (b.invoices.isEmpty)
              const EmptyView(icon: MoreIcons.receipt, title: 'No bills yet', text: 'Bills for your plan and for visits show up here.')
            else
              GroupCard(radius: 22, children: [for (final i in b.invoices) InvoiceRow(invoice: i)]),
            if (!b.pay.isEmpty) ...[
              const SizedBox(height: 22),
              const SectionHeader('How to pay', subtitle: 'Write the invoice number as the reference'),
              const SizedBox(height: 10),
              GroupCard(radius: 22, children: [for (final (label, value) in b.pay.ways) CopyRow(label: label, value: value)]),
            ],
            const SizedBox(height: 14),
            Text(
              'Paid already? Open the bill and send us the reference — the team marks it paid. Questions about a bill? Ask in Help requests.',
              style: TextStyle(fontSize: 13, color: c.mu, height: 1.4),
            ),
          ],
        ],
      ),
    );
  }
}

/// "Rs 4,300 to pay": the total due, the oldest bill first.
class _ToPay extends StatelessWidget {
  const _ToPay({required this.billing});
  final HomeBilling billing;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final unpaid = [...billing.unpaid]..sort((a, b) => a.dueOn.compareTo(b.dueOn));
    final first = unpaid.firstOrNull;
    final late = billing.anyLate;
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(color: late ? c.badSoft : c.onSoft, borderRadius: BorderRadius.circular(24)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              SbIcon(late ? SbIcons.warning : MoreIcons.wallet, size: 18, color: late ? c.badText : c.onText),
              const SizedBox(width: 8),
              Text(late ? 'A bill is overdue' : 'To pay', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: late ? c.badText : c.onText)),
            ],
          ),
          const SizedBox(height: 6),
          Text(Energy.rupees(billing.due), style: TextStyle(fontSize: 34, fontWeight: FontWeight.w600, letterSpacing: -1.2, color: c.tx)),
          Text(
            '${unpaid.length} bill${unpaid.length == 1 ? '' : 's'}${first != null ? ' · the first ${first.late ? 'was due' : 'is due'} ${dayText(first.dueOn)}' : ''}',
            style: TextStyle(fontSize: 13.5, color: c.mu),
          ),
          if (first != null) ...[
            const SizedBox(height: 14),
            BigButton(
              label: unpaid.length == 1 ? 'See the bill and pay' : 'Pay the oldest first',
              icon: MoreIcons.wallet,
              height: 50,
              onTap: () => context.openInTab(Routes.invoiceOf(first.id)),
            ),
          ],
        ],
      ),
    );
  }
}

class _Plan extends StatelessWidget {
  const _Plan({required this.contract});
  final Contract? contract;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final k = contract;
    if (k == null) {
      return EmptyView(
        icon: MoreIcons.sealCheck,
        title: 'No maintenance plan',
        text: 'A plan covers check-up visits and help when something stops working. Ask if you’d like one.',
        action: TextButton(onPressed: () => showHelpRequests(context), child: Text('Help requests', style: TextStyle(color: c.acText, fontWeight: FontWeight.w600))),
      );
    }
    final left = k.daysLeft(DateTime.now());
    final ending = left != null && left <= 60;
    return GroupCard(
      radius: 22,
      children: [
        Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Container(
                    width: 40,
                    height: 40,
                    decoration: BoxDecoration(color: c.okSoft, borderRadius: BorderRadius.circular(12)),
                    child: Center(child: SbIcon(MoreIcons.sealCheck, size: 19, color: c.okText)),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(k.plan, style: TextStyle(fontSize: 17, fontWeight: FontWeight.w600, color: c.tx)),
                        Text(k.priceText, style: TextStyle(fontSize: 14, color: c.tx)),
                      ],
                    ),
                  ),
                  if (k.paused) const Pill('Paused', tone: PillTone.warn) else const Pill('Active', tone: PillTone.ok),
                ],
              ),
              const SizedBox(height: 14),
              _Fact(icon: SbIcons.users, text: k.visitsText ?? 'Visits as needed, charged per visit'),
              _Fact(icon: MoreIcons.calendar, text: 'Since ${dayText(k.startsOn)}${k.endsOn != null ? ' · until ${dayText(k.endsOn!)}' : ''}'),
              if (k.status == 'ACTIVE' && k.nextInvoiceOn.isNotEmpty) _Fact(icon: MoreIcons.receipt, text: 'Next bill on ${dayText(k.nextInvoiceOn)}'),
              if (k.endsOn != null)
                _Fact(
                  icon: SbIcons.clock,
                  text: left == null
                      ? 'Renewal: ${dayText(k.endsOn!)}'
                      : left < 0
                          ? 'Ended ${-left} day${left == -1 ? '' : 's'} ago — ask us to renew it'
                          : left == 0
                              ? 'Ends today — ask us to renew it'
                              : 'Renewal due ${dayText(k.endsOn!)} (in $left day${left == 1 ? '' : 's'})',
                  warn: ending,
                ),
              if (k.notes.isNotEmpty) ...[
                const SizedBox(height: 6),
                Text(k.notes, style: TextStyle(fontSize: 13.5, color: c.mu, height: 1.4)),
              ],
            ],
          ),
        ),
      ],
    );
  }
}

class _Fact extends StatelessWidget {
  const _Fact({required this.icon, required this.text, this.warn = false});
  final SbIconData icon;
  final String text;
  final bool warn;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(padding: const EdgeInsets.only(top: 1), child: SbIcon(icon, size: 16, color: warn ? c.onText : c.mu)),
          const SizedBox(width: 10),
          Expanded(child: Text(text, style: TextStyle(fontSize: 14, color: warn ? c.onText : c.tx, fontWeight: warn ? FontWeight.w500 : FontWeight.w400))),
        ],
      ),
    );
  }
}

/// One bill in a list: what it's for, its number and date, the amount and its state.
class InvoiceRow extends StatelessWidget {
  const InvoiceRow({super.key, required this.invoice});
  final Invoice invoice;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final i = invoice;
    return InkWell(
      onTap: () => context.openInTab(Routes.invoiceOf(i.id)),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 12, 12, 12),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(i.description, maxLines: 2, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: c.tx)),
                  const SizedBox(height: 2),
                  Text(i.line, style: TextStyle(fontSize: 13, color: i.late ? c.badText : c.mu)),
                ],
              ),
            ),
            const SizedBox(width: 10),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(Energy.rupees(i.amount), style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: c.tx)),
                const SizedBox(height: 4),
                InvoiceStatusPill(invoice: i),
              ],
            ),
            const SizedBox(width: 6),
            SbIcon(SbIcons.caretRight, size: 15, color: c.mu),
          ],
        ),
      ),
    );
  }
}

class InvoiceStatusPill extends StatelessWidget {
  const InvoiceStatusPill({super.key, required this.invoice});
  final Invoice invoice;

  @override
  Widget build(BuildContext context) => Pill(
        invoice.statusText,
        tone: invoice.paid
            ? PillTone.ok
            : invoice.status == 'VOID'
                ? PillTone.mute
                : invoice.late
                    ? PillTone.bad
                    : PillTone.warn,
      );
}

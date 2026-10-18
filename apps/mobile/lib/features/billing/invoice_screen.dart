import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:share_plus/share_plus.dart';

import '../../core/network/api_exception.dart';
import '../../core/theme/app_theme.dart';
import '../../core/theme/sb_colors.dart';
import '../../core/theme/sb_icons.dart';
import '../../core/theme/sb_icons_more.dart';
import '../../data/models/billing.dart';
import '../../data/models/energy.dart';
import '../../data/repositories/billing_repository.dart';
import '../../shared/widgets/common.dart';
import '../../shared/widgets/pill.dart';
import '../../shared/widgets/sb_chip.dart';
import '../../shared/widgets/sheet.dart';
import '../../state/money.dart';
import '../../state/people.dart';
import '../../state/toast.dart';
import '../auth/auth_widgets.dart';
import 'billing_screen.dart';

/// One bill, like the web's /billing/:id: who it's from, what for, the amount, and — while it's due —
/// how to pay (copy the numbers), a message to share, and "Paid? Send us the reference".
class InvoiceScreen extends ConsumerWidget {
  const InvoiceScreen({super.key, required this.invoiceId});
  final String invoiceId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.sb;
    final inv = ref.watch(invoiceProvider(invoiceId));
    final d = inv.value;
    return RefreshIndicator(
      color: c.on,
      onRefresh: () => ref.refresh(invoiceProvider(invoiceId).future),
      child: ListView(
        padding: EdgeInsets.fromLTRB(18, MediaQuery.paddingOf(context).top + 4, 18, 130),
        children: [
          BackPill(onTap: () => context.pop()),
          const SizedBox(height: 16),
          if (d == null)
            inv.hasError ? ErrorView(error: inv.error!, onRetry: () => ref.invalidate(invoiceProvider(invoiceId))) : const LoadingView(label: 'Opening the bill…')
          else ..._body(context, ref, d),
        ],
      ),
    );
  }

  List<Widget> _body(BuildContext context, WidgetRef ref, InvoiceDetail d) {
    final c = context.sb;
    final i = d.invoice;
    return [
      Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Invoice ${i.number}', style: SbText.display.copyWith(color: c.tx, fontSize: 30)),
                const SizedBox(height: 4),
                Text('From ${d.company} · issued ${dayText(i.issuedOn)}', style: TextStyle(fontSize: 14, color: c.mu)),
              ],
            ),
          ),
          Padding(padding: const EdgeInsets.only(top: 8), child: InvoiceStatusPill(invoice: i)),
        ],
      ),
      const SizedBox(height: 18),
      GroupCard(
        radius: 22,
        children: [
          Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text('BILL TO', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, letterSpacing: .3, color: c.mu)),
                const SizedBox(height: 4),
                Text(d.billTo, style: TextStyle(fontSize: 15.5, fontWeight: FontWeight.w600, color: c.tx)),
                Text(d.billToHome, style: TextStyle(fontSize: 14, color: c.mu)),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(child: Text(i.description, style: TextStyle(fontSize: 15, color: c.tx, height: 1.35))),
                const SizedBox(width: 12),
                Text(Energy.rupees(i.amount), style: TextStyle(fontSize: 15, color: c.tx)),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              children: [
                Expanded(child: Text('Total', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600, color: c.tx))),
                Text(Energy.rupees(i.amount), style: TextStyle(fontSize: 22, fontWeight: FontWeight.w600, letterSpacing: -.5, color: c.tx)),
              ],
            ),
          ),
        ],
      ),
      const SizedBox(height: 12),
      Note(
        tone: i.paid
            ? NoteTone.ok
            : i.late
                ? NoteTone.bad
                : i.status == 'VOID'
                    ? NoteTone.info
                    : NoteTone.warn,
        icon: i.paid ? SbIcons.check : i.late ? SbIcons.warning : SbIcons.clock,
        child: Text(
          i.paid
              ? i.paidText
              : i.status == 'VOID'
                  ? 'This invoice was cancelled. Nothing to pay.'
                  : i.late
                      ? 'This bill was due on ${dayText(i.dueOn)}. Please pay it soon — or, if you’ve paid, send us the reference below.'
                      : 'Please pay by ${dayText(i.dueOn)}.',
        ),
      ),
      if (i.due && !d.pay.isEmpty) ...[
        const SizedBox(height: 22),
        SectionHeader('How to pay', subtitle: 'Please write invoice ${i.number} as the reference'),
        const SizedBox(height: 10),
        GroupCard(
          radius: 22,
          children: [
            for (final (label, value) in d.pay.ways) CopyRow(label: label, value: value),
            CopyRow(label: 'Amount', value: '${i.amount}'),
            CopyRow(label: 'Reference', value: 'Invoice ${i.number}'),
          ],
        ),
      ] else if (i.due) ...[
        const SizedBox(height: 14),
        Text('Pay the way your installer told you, and write invoice ${i.number} as the reference.', style: TextStyle(fontSize: 14, color: c.mu)),
      ],
      const SizedBox(height: 18),
      if (i.status != 'VOID')
        BigButton(
          label: i.paid ? 'Share the receipt' : 'Share on WhatsApp',
          icon: SbIcons.share,
          height: 52,
          color: i.due ? c.sf2 : null,
          foreground: i.due ? c.tx : null,
          onTap: () => SharePlus.instance.share(ShareParams(text: d.shareText(), subject: 'Invoice ${i.number} from ${d.company}')),
        ),
      if (i.due) ...[
        const SizedBox(height: 10),
        BigButton(label: 'Paid? Send us the reference', icon: SbIcons.paperPlane, height: 52, onTap: () => _tellPaid(context, d)),
        const SizedBox(height: 8),
        Text(
          'It goes to the team as a help request; they check the payment and mark the bill paid. You get a notice when they do.',
          style: TextStyle(fontSize: 12.5, color: c.mu, height: 1.4),
        ),
      ],
      if (d.billingEmail != null || d.taxId != null) ...[
        const SizedBox(height: 18),
        Text(
          [if (d.billingEmail != null) 'Billing: ${d.billingEmail}', if (d.taxId != null) 'Tax ID ${d.taxId}'].join(' · '),
          style: TextStyle(fontSize: 12.5, color: c.mu),
        ),
      ],
    ];
  }

  Future<void> _tellPaid(BuildContext context, InvoiceDetail d) => showSbSheet<void>(context, builder: (_) => _TellPaid(detail: d));
}

class _TellPaid extends ConsumerStatefulWidget {
  const _TellPaid({required this.detail});
  final InvoiceDetail detail;

  @override
  ConsumerState<_TellPaid> createState() => _TellPaidState();
}

class _TellPaidState extends ConsumerState<_TellPaid> {
  final _ref = TextEditingController();
  final _note = TextEditingController();
  late String _method = widget.detail.pay.jazzcash != null
      ? 'JazzCash'
      : widget.detail.pay.easypaisa != null
          ? 'Easypaisa'
          : 'Bank transfer';
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _ref.dispose();
    _note.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    if (_method != 'Cash' && _ref.text.trim().length < 3) {
      setState(() => _error = 'Type the transaction ID or reference from your payment message.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final t = await ref.read(billingRepositoryProvider).tellPaid(widget.detail, method: _method, reference: _ref.text, note: _note.text);
      ref.invalidate(ticketsProvider);
      if (mounted) Navigator.of(context).pop();
      ref.read(toastProvider.notifier).show('Sent as request #${t.number}. We’ll mark it paid.');
    } catch (e) {
      if (mounted) {
        setState(() {
          _busy = false;
          _error = ApiException.from(e).message;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final i = widget.detail.invoice;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('Tell us you’ve paid', style: SbText.title.copyWith(color: c.tx)),
        const SizedBox(height: 4),
        Text('Invoice ${i.number}, ${Energy.rupees(i.amount)}. The team checks it and marks the bill paid.', style: TextStyle(fontSize: 14.5, color: c.mu)),
        const SizedBox(height: 16),
        Text('Paid by', style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w500, color: c.tx)),
        const SizedBox(height: 8),
        Wrap(
          spacing: 6,
          runSpacing: 6,
          children: [
            for (final m in const ['JazzCash', 'Easypaisa', 'Bank transfer', 'Cash', 'Other'])
              SbChip(label: m, selected: _method == m, onTap: () => setState(() => _method = m), height: 40),
          ],
        ),
        const SizedBox(height: 14),
        LabeledField(
          label: _method == 'Cash' ? 'Who did you give it to? (optional)' : 'Transaction ID or reference',
          controller: _ref,
          icon: MoreIcons.receipt,
          hint: _method == 'Cash' ? 'e.g. Ali, the installer' : 'e.g. 012345678901',
        ),
        const SizedBox(height: 12),
        LabeledField(label: 'Anything else? (optional)', controller: _note, icon: SbIcons.message, hint: 'e.g. Paid from my husband’s account'),
        if (_error != null) ...[
          const SizedBox(height: 12),
          Note(tone: NoteTone.bad, icon: SbIcons.warning, child: Text(_error!)),
        ],
        const SizedBox(height: 16),
        BigButton(label: 'Send', icon: SbIcons.paperPlane, busy: _busy, onTap: _send),
      ],
    );
  }
}

'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { InvoiceStatus, METHODS, day, invoiceText, rs } from '@/components/billing/parts';
import { Icon } from '@/components/Icon';
import { Loader } from '@/components/Loader';
import { useCrumbs } from '@/components/Shell';
import { WhatsAppShare } from '@/components/ui';
import { useLoad } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import type { PrintableInvoice } from '@/lib/types';

/** One bill, laid out to print or save as PDF. */
export default function InvoicePage() {
  const { id } = useParams<{ id: string }>();
  const { staffRole } = useSession();
  const inv = useLoad<PrintableInvoice>(`/billing/invoices/${id}`);
  useCrumbs([{ label: staffRole ? 'Contracts & invoices' : 'Plan & bills', href: staffRole ? '/console/billing' : '/billing' }, { label: inv.data ? `Invoice ${inv.data.number}` : 'Invoice' }]);
  if (!inv.data) return inv.error ? <div className="alert">{inv.error}</div> : <Loader />;
  const i = inv.data;
  return (
    <div className="stack" style={{ maxWidth: 760 }}>
      <div className="row no-print" style={{ gap: 8 }}>
        <Link href={staffRole ? '/console/billing' : '/billing'} className="details-link grow">← Back</Link>
        <WhatsAppShare small text={invoiceText(i, i.company.name)} />
        <button className="btn btn-sm" onClick={() => window.print()}><Icon name="download" size={14} />Print or save as PDF</button>
      </div>
      <article className="card card-pad invoice-sheet">
        <header className="spread" style={{ alignItems: 'flex-start' }}>
          <div className="row" style={{ gap: 12 }}>
            {i.company.logo && <img src={i.company.logo} alt="" width={44} height={44} style={{ borderRadius: 10 }} />}
            <div className="stack-tight">
              <b style={{ fontSize: 18 }}>{i.company.name}</b>
              {i.company.billingEmail && <span className="small muted">{i.company.billingEmail}</span>}
              {i.company.taxId && <span className="small muted">Tax ID {i.company.taxId}</span>}
            </div>
          </div>
          <div className="stack-tight" style={{ textAlign: 'right' }}>
            <b style={{ fontSize: 18 }}>Invoice {i.number}</b>
            <span className="small muted">Issued {day(i.issuedOn)}</span>
            <span><InvoiceStatus i={i} /></span>
          </div>
        </header>
        <div className="invoice-to">
          <span className="small muted">Bill to</span>
          <b>{i.billTo.owner?.name ?? i.billTo.home}</b>
          <span>{i.billTo.home}{i.billTo.city ? `, ${i.billTo.city}` : ''}</span>
        </div>
        <table className="table">
          <thead><tr><th>Description</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
          <tbody>
            <tr><td>{i.description}</td><td style={{ textAlign: 'right' }}>{rs(i.amount)}</td></tr>
            <tr><td><b>Total</b></td><td style={{ textAlign: 'right' }}><b>{rs(i.amount)}</b></td></tr>
          </tbody>
        </table>
        <p className="small" style={{ margin: 0 }}>
          {i.status === 'PAID' ? `Paid on ${day(i.paidOn!)}${i.method ? ` by ${METHODS[i.method] ?? i.method}` : ''}${i.reference ? ` (ref. ${i.reference})` : ''}. Thank you!`
            : i.status === 'VOID' ? 'This invoice was cancelled.' : `Please pay by ${day(i.dueOn)}.`}
        </p>
      </article>
    </div>
  );
}

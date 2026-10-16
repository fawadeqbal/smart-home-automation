'use client';
import Link from 'next/link';
import { InvoiceStatus, day, rs } from '@/components/billing/parts';
import { Icon } from '@/components/Icon';
import { Loader } from '@/components/Loader';
import { useCrumbs } from '@/components/Shell';
import { Empty, PageHead } from '@/components/ui';
import { useLoad } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import type { HomeBilling } from '@/lib/types';

/** The home's maintenance plan and its bills. */
export default function HomeBillingPage() {
  const { home } = useSession();
  useCrumbs([{ label: home?.name ?? 'Home', href: '/' }, { label: 'Plan & bills' }]);
  const b = useLoad<HomeBilling>('/billing');
  if (!b.data) return b.error ? <div className="alert">{b.error}</div> : <Loader />;
  const d = b.data;
  return (
    <div className="stack" style={{ maxWidth: 820 }}>
      <PageHead title="Plan & bills" sub={`Your maintenance plan with ${d.company}, and your bills. To pay, use the details your installer gave you; they record it here.`} />
      <section className="card card-pad stack">
        <h3 style={{ margin: 0 }}>Your plan</h3>
        {d.contract ? (
          <div className="stack-tight">
            <b style={{ fontSize: 17 }}>{d.contract.plan}{d.contract.status === 'PAUSED' && <span className="muted"> · paused</span>}</b>
            <span>{rs(d.contract.amount)} {d.contract.periodText}{d.contract.visitsIncluded ? ` · ${d.contract.visitsIncluded} visit${d.contract.visitsIncluded === 1 ? '' : 's'} included each ${d.contract.period === 'MONTHLY' ? 'month' : d.contract.period === 'QUARTERLY' ? 'quarter' : 'year'}` : ''}</span>
            <span className="small muted">Since {day(d.contract.startsOn)}{d.contract.endsOn ? ` until ${day(d.contract.endsOn)}` : ''}{d.contract.status === 'ACTIVE' ? ` · next bill ${day(d.contract.nextInvoiceOn)}` : ''}</span>
            {d.contract.notes && <span className="small">{d.contract.notes}</span>}
          </div>
        ) : <p className="muted" style={{ margin: 0 }}>No maintenance plan. Ask in Help requests if you'd like one.</p>}
      </section>
      <section className="card">
        <div className="card-pad spread"><h3 style={{ margin: 0 }}>Bills</h3>{d.due > 0 && <b>{rs(d.due)} to pay</b>}</div>
        {d.invoices.length === 0 ? <div className="card-pad"><Empty>No bills yet.</Empty></div> : d.invoices.map((i) => (
          <Link key={i.id} href={`/billing/${i.id}`} className="ticket-row">
            <span className="grow stack-tight" style={{ minWidth: 0 }}>
              <b className="truncate">{i.description}</b>
              <span className="small muted">Invoice {i.number} · {i.status === 'PAID' ? `paid ${day(i.paidOn!)}` : `due ${day(i.dueOn)}`}</span>
            </span>
            <b className="nowrap">{rs(i.amount)}</b>
            <InvoiceStatus i={i} />
            <Icon name="chevron-right" size={16} />
          </Link>
        ))}
      </section>
    </div>
  );
}

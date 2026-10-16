'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { InvoiceStatus, METHODS, day, invoiceText, rs } from '@/components/billing/parts';
import { Icon } from '@/components/Icon';
import { Loader } from '@/components/Loader';
import { useCrumbs } from '@/components/Shell';
import { Badge, Empty, ErrorBox, FormModal, Kpi, PageHead, Seg, WhatsAppShare } from '@/components/ui';
import { get, patch, post } from '@/lib/api';
import { useLoad } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import type { BillingOverview, BillingPeriod, Contract, Invoice } from '@/lib/types';

const PRESETS: { plan: string; amount: number; period: BillingPeriod; visits: number }[] = [
  { plan: 'Basic care', amount: 1000, period: 'MONTHLY', visits: 0 },
  { plan: 'Care plan', amount: 2500, period: 'MONTHLY', visits: 1 },
  { plan: 'Annual care', amount: 25000, period: 'YEARLY', visits: 4 },
];
const today = () => new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);

/** Maintenance contracts and invoices across the homes. */
export default function BillingPage() {
  useCrumbs([{ label: 'Platform', href: '/console' }, { label: 'Contracts & invoices' }]);
  const { me } = useSession();
  const b = useLoad<BillingOverview>('/platform/billing');
  const [tab, setTab] = useState<'due' | 'all' | 'contracts'>('due');
  const [dialog, setDialog] = useState<null | { kind: 'contract' | 'invoice'; homes: { id: string; name: string }[] } | { kind: 'paid'; inv: Invoice }>(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  const set = (x: BillingOverview) => b.setData(x);
  const act = async (fn: () => Promise<BillingOverview>) => { setError(null); try { set(await fn()); } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); } };
  const openDialog = async (kind: 'contract' | 'invoice') => setDialog({ kind, homes: await get<{ id: string; name: string }[]>('/platform/homes') });

  const invoices = useMemo(() => (b.data?.invoices ?? []).filter((i) => (tab === 'due' ? i.status === 'DUE' : true))
    .filter((i) => !q.trim() || `${i.number} ${i.home} ${i.description}`.toLowerCase().includes(q.trim().toLowerCase())), [b.data, tab, q]);
  if (!b.data) return b.error ? <ErrorBox error={b.error} /> : <Loader label="Loading billing…" />;
  const k = b.data.kpis;
  const canEdit = b.data.canEdit;
  const company = me.staff?.org.name ?? 'Switchboard';

  return (
    <div data-screen-label="Billing">
      <PageHead eyebrow="Platform" title="Contracts & invoices"
                sub="Maintenance contracts bill themselves each period; add one-off bills for visits and new work. Record payments as they come in."
                actions={canEdit && <>
                  <button className="btn" onClick={() => void openDialog('invoice')}><Icon name="plus" size={15} />One-off bill</button>
                  <button className="btn btn-primary" onClick={() => void openDialog('contract')}><Icon name="plus" size={15} />New contract</button>
                </>} />
      <div className="kpis k4 mb16">
        <Kpi label="Contracts, per month" value={rs(k.perMonth)} sub={`${k.active} active`} chip={{ icon: 'repeat', tone: 'ac' }} />
        <Kpi label="Waiting to be paid" value={rs(k.due)} sub={`${k.dueCount} bill${k.dueCount === 1 ? '' : 's'}`} chip={{ icon: 'wallet', tone: 'on' }} />
        <Kpi label="Overdue" value={rs(k.late)} sub={`${k.lateCount} bill${k.lateCount === 1 ? '' : 's'}`} chip={{ icon: 'alert-triangle', tone: k.lateCount ? 'bad' : 'mute' }} />
        <Kpi label="Received this month" value={rs(k.paidThisMonth)} chip={{ icon: 'check', tone: 'ok' }} />
      </div>
      <ErrorBox error={error} />
      <div className="spread mb16" style={{ gap: 10, flexWrap: 'wrap' }}>
        <Seg options={[{ id: 'due', label: 'To collect', n: k.dueCount }, { id: 'all', label: 'All bills' }, { id: 'contracts', label: 'Contracts', n: k.active }]} value={tab} onChange={setTab} />
        {tab !== 'contracts' && <label className="input-icon" style={{ width: 'min(300px, 100%)' }}><Icon name="search" size={15} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Number, home or description" aria-label="Filter bills" /></label>}
      </div>

      {tab === 'contracts' ? (
        b.data.contracts.length === 0 ? <Empty>No contracts yet. A contract bills a home every month, quarter or year by itself.</Empty> : (
          <div className="table-wrap">
            <table className="table" style={{ minWidth: 760 }}>
              <thead><tr>{['Home', 'Plan', 'Price', 'Visits', 'Next bill', 'Status', ''].map((c) => <th key={c}>{c}</th>)}</tr></thead>
              <tbody>
                {b.data.contracts.map((c: Contract) => (
                  <tr key={c.id}>
                    <td><Link href={`/console/homes/${c.homeId}`}><b>{c.home}</b></Link><div className="cell-sub">{c.city}</div></td>
                    <td>{c.plan}{c.notes && <div className="cell-sub truncate" style={{ maxWidth: 220 }}>{c.notes}</div>}</td>
                    <td className="nowrap">{rs(c.amount)} {c.periodText}</td>
                    <td>{c.visitsIncluded || '–'}</td>
                    <td className="nowrap">{c.status === 'ACTIVE' ? day(c.nextInvoiceOn) : '–'}</td>
                    <td><Badge tone={c.status === 'ACTIVE' ? 'ok' : c.status === 'PAUSED' ? 'warn' : 'mute'}>{c.status === 'ACTIVE' ? 'Active' : c.status === 'PAUSED' ? 'Paused' : 'Ended'}</Badge></td>
                    <td className="nowrap">
                      {canEdit && c.status !== 'ENDED' && (
                        <span className="row" style={{ gap: 6 }}>
                          <button className="btn btn-sm" onClick={() => void act(() => patch(`/platform/billing/contracts/${c.id}`, { status: c.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE' }))}>{c.status === 'ACTIVE' ? 'Pause' : 'Resume'}</button>
                          <button className="btn btn-sm" onClick={() => confirm(`End ${c.home}'s contract? No more bills will be made.`) && void act(() => patch(`/platform/billing/contracts/${c.id}`, { status: 'ENDED' }))}>End</button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : invoices.length === 0 ? <Empty>{tab === 'due' ? 'Nothing to collect.' : 'No bills yet.'}</Empty> : (
        <div className="table-wrap">
          <table className="table" style={{ minWidth: 820 }}>
            <thead><tr>{['No.', 'Home', 'For', 'Amount', 'Due', 'Status', ''].map((c) => <th key={c}>{c}</th>)}</tr></thead>
            <tbody>
              {invoices.map((i) => (
                <tr key={i.id}>
                  <td className="mono"><Link href={`/billing/${i.id}`}>{i.number}</Link></td>
                  <td><b>{i.home}</b><div className="cell-sub">{i.city}</div></td>
                  <td><span className="truncate" style={{ display: 'block', maxWidth: 260 }}>{i.description}</span></td>
                  <td className="nowrap"><b>{rs(i.amount)}</b></td>
                  <td className="nowrap">{i.status === 'PAID' ? <span className="muted">paid {day(i.paidOn!)}{i.method ? ` · ${METHODS[i.method] ?? i.method}` : ''}</span> : day(i.dueOn)}</td>
                  <td><InvoiceStatus i={i} /></td>
                  <td className="nowrap">
                    <span className="row" style={{ gap: 6 }}>
                      {canEdit && i.status === 'DUE' && <button className="btn btn-sm btn-primary" onClick={() => setDialog({ kind: 'paid', inv: i })}>Paid</button>}
                      <WhatsAppShare small label="Send" text={invoiceText(i, company)} />
                      {canEdit && i.status !== 'VOID' && (
                        <button className="icon-btn" title={i.status === 'PAID' ? 'Mark as not paid' : 'Cancel this bill'} aria-label="More"
                                onClick={() => confirm(i.status === 'PAID' ? `Mark invoice ${i.number} as not paid?` : `Cancel invoice ${i.number}?`) && void act(() => patch(`/platform/billing/invoices/${i.id}`, { status: i.status === 'PAID' ? 'DUE' : 'VOID' }))}>
                          <Icon name={i.status === 'PAID' ? 'rotate' : 'x'} size={14} />
                        </button>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dialog?.kind === 'contract' && <NewContract homes={dialog.homes} onClose={() => setDialog(null)} onSaved={set} />}
      {dialog?.kind === 'invoice' && (
        <FormModal title="One-off bill" sub="For a service visit, new work or parts. The home gets a notice." submitLabel="Make the bill" onClose={() => setDialog(null)}
                   onSubmit={async (f) => set(await post<BillingOverview>('/platform/billing/invoices', { homeId: f.get('homeId'), description: f.get('description'), amount: Number(f.get('amount')), dueInDays: Number(f.get('due')) }))}>
          <label className="field">Home<select name="homeId" required>{dialog.homes.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select></label>
          <label className="field">For<input name="description" required maxLength={200} placeholder="Service visit: replaced the kitchen relay" /></label>
          <div className="form-grid">
            <label className="field">Amount (Rs)<input name="amount" type="number" required min={1} step={1} /></label>
            <label className="field">Due in (days)<input name="due" type="number" min={0} max={90} defaultValue={10} /></label>
          </div>
        </FormModal>
      )}
      {dialog?.kind === 'paid' && (
        <FormModal title={`Invoice ${dialog.inv.number} paid`} sub={`${dialog.inv.home} · ${rs(dialog.inv.amount)}`} submitLabel="Record payment" onClose={() => setDialog(null)}
                   onSubmit={async (f) => set(await patch<BillingOverview>(`/platform/billing/invoices/${dialog.inv.id}`, { status: 'PAID', method: f.get('method'), reference: f.get('reference') || undefined, paidOn: f.get('paidOn') }))}>
          <label className="field">How<select name="method" defaultValue="cash">{Object.entries(METHODS).map(([k2, v]) => <option key={k2} value={k2}>{v}</option>)}</select></label>
          <div className="form-grid">
            <label className="field">Reference (optional)<input name="reference" maxLength={80} placeholder="Transaction ID or receipt no." /></label>
            <label className="field">On<input name="paidOn" type="date" defaultValue={today()} required /></label>
          </div>
        </FormModal>
      )}
    </div>
  );
}

function NewContract({ homes, onClose, onSaved }: { homes: { id: string; name: string }[]; onClose: () => void; onSaved: (b: BillingOverview) => void }) {
  const [p, setP] = useState(PRESETS[1]!);
  return (
    <FormModal title="New maintenance contract" sub="The first bill is made on the start date, then one every period. The home gets a notice for each." submitLabel="Start contract" onClose={onClose}
               onSubmit={async (f) => onSaved(await post<BillingOverview>('/platform/billing/contracts', {
                 homeId: f.get('homeId'), plan: f.get('plan'), amount: Number(f.get('amount')), period: f.get('period'),
                 visitsIncluded: Number(f.get('visits') || 0), startsOn: f.get('startsOn'), endsOn: f.get('endsOn') || null, notes: f.get('notes') || undefined,
               }))}>
      <label className="field">Home<select name="homeId" required>{homes.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select></label>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        {PRESETS.map((x) => <button type="button" key={x.plan} className={`btn btn-sm ${p.plan === x.plan ? 'btn-primary' : ''}`} onClick={() => setP(x)}>{x.plan}</button>)}
        <span className="small muted">Examples — change the price to yours.</span>
      </div>
      <div className="form-grid" key={p.plan}>
        <label className="field">Plan name<input name="plan" required maxLength={80} defaultValue={p.plan} /></label>
        <label className="field">Price (Rs)<input name="amount" type="number" required min={1} defaultValue={p.amount} /></label>
        <label className="field">Every<select name="period" defaultValue={p.period}><option value="MONTHLY">Month</option><option value="QUARTERLY">Quarter</option><option value="YEARLY">Year</option></select></label>
        <label className="field">Visits included per period<input name="visits" type="number" min={0} max={52} defaultValue={p.visits} /></label>
        <label className="field">Starts<input name="startsOn" type="date" required defaultValue={today()} /></label>
        <label className="field">Ends (optional)<input name="endsOn" type="date" /></label>
      </div>
      <label className="field">Notes (optional)<input name="notes" maxLength={1000} placeholder="e.g. Includes 2 hours of work per visit; parts extra" /></label>
    </FormModal>
  );
}

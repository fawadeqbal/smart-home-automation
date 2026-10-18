'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { Loader } from '@/components/Loader';
import { Badge, Empty, ErrorBox, FormModal, MessageButton } from '@/components/ui';
import { post } from '@/lib/api';
import { useLoad } from '@/lib/hooks';
import type { Renewal, RenewalList } from '@/lib/types';
import { dayText, MESSAGES, rs } from '@/lib/whatsapp';
import './service.css';

/** Console → Contracts & invoices → Renewals: contracts ending in the next 60 days, and ones that lapsed. */
export function RenewalsView({ onChanged }: { onChanged?: () => void }) {
  const r = useLoad<RenewalList>('/platform/billing/renewals');
  const [renewing, setRenewing] = useState<Renewal | null>(null);
  if (!r.data) return r.error ? <ErrorBox error={r.error} /> : <Loader label="Loading renewals…" />;
  const d = r.data;
  if (!d.contracts.length) return <Empty>No contracts end in the next {d.windowDays} days. Contracts without an end date renew by themselves.</Empty>;
  const tone = (c: Renewal) => (c.ended ? 'bad' : c.daysLeft <= 7 ? 'bad' : c.daysLeft <= 30 ? 'warn' : 'info');
  return (
    <div className="stack" style={{ gap: 10 }}>
      <p className="small muted" style={{ margin: 0 }}>Super admins get a notice 30 and 7 days before a contract ends. Send the customer a reminder, then renew it here.</p>
      <div className="table-wrap">
        <table className="table" style={{ minWidth: 760 }}>
          <thead><tr>{['Home', 'Plan', 'Price', 'Ends', 'Days left', ''].map((c) => <th key={c}>{c}</th>)}</tr></thead>
          <tbody>
            {d.contracts.map((c) => (
              <tr key={c.id}>
                <td><Link href={`/console/homes/${c.homeId}`}><b>{c.home}</b></Link><div className="cell-sub">{c.contact?.name ?? c.city}</div></td>
                <td>{c.plan}</td>
                <td className="nowrap">{rs(c.amount)} {c.periodText}</td>
                <td className="nowrap">{c.endsOn ? dayText(c.endsOn) : '–'}</td>
                <td>
                  {c.ended
                    ? <Badge tone="bad">Ended {-c.daysLeft} day{c.daysLeft === -1 ? '' : 's'} ago</Badge>
                    : <Badge tone={tone(c)}><span className="days-left">{c.daysLeft === 0 ? 'Ends today' : `${c.daysLeft} day${c.daysLeft === 1 ? '' : 's'}`}</span></Badge>}
                </td>
                <td className="nowrap">
                  <span className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                    <MessageButton small label="Remind" whatsapp={c.contact?.whatsapp}
                                   text={MESSAGES.renewalReminder({ name: c.contact?.name, plan: c.plan, endsOn: c.endsOn!, daysLeft: c.daysLeft, amount: c.amount, periodText: c.periodText, company: d.company.name })} />
                    {d.canEdit && <button className="btn btn-sm btn-primary" onClick={() => setRenewing(c)}>Renew</button>}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {renewing && <RenewDialog c={renewing} onClose={() => setRenewing(null)} onDone={(x) => { r.setData(x); onChanged?.(); }} />}
    </div>
  );
}

function RenewDialog({ c, onClose, onDone }: { c: Renewal; onClose: () => void; onDone: (r: RenewalList) => void }) {
  const [term, setTerm] = useState<'3' | '6' | '12' | 'date'>('12');
  return (
    <FormModal title={`Renew ${c.home}’s contract`} submitLabel="Renew"
               sub={c.ended ? 'It ended, so the new term starts today. Bills start again from today.' : `One more term after ${dayText(c.endsOn!)}. The customer gets their bills as before.`}
               onClose={onClose}
               onSubmit={async (f) => {
                 const amount = Number(f.get('amount'));
                 onDone(await post<RenewalList>(`/platform/billing/contracts/${c.id}/renew`, {
                   ...(term === 'date' ? { until: f.get('until') } : { months: Number(term) }),
                   ...(amount && amount !== c.amount ? { amount } : {}),
                 }));
               }}>
      <div className="stack-sm">
        <span className="small muted">For</span>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }} role="radiogroup" aria-label="Renew for">
          {(['3', '6', '12'] as const).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={term === m} className={`btn btn-sm ${term === m ? 'btn-primary' : ''}`} onClick={() => setTerm(m)}>{m} months</button>
          ))}
          <button type="button" role="radio" aria-checked={term === 'date'} className={`btn btn-sm ${term === 'date' ? 'btn-primary' : ''}`} onClick={() => setTerm('date')}><Icon name="clock" size={13} />Until a date</button>
        </div>
      </div>
      <div className="form-grid">
        {term === 'date' && <label className="field">Ends on<input name="until" type="date" required /></label>}
        <label className="field">Price (Rs) {c.periodText} <span className="hint">change it if the price is new</span><input name="amount" type="number" min={1} defaultValue={c.amount} required /></label>
      </div>
    </FormModal>
  );
}

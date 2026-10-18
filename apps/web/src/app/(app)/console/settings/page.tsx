'use client';
import { FormEvent, useState } from 'react';
import { Icon } from '@/components/Icon';
import { Loader } from '@/components/Loader';
import { useCrumbs } from '@/components/Shell';
import { Badge, Confirm, ErrorBox, PageHead, useAction } from '@/components/ui';
import { PriceList, ServiceSettings } from '@/components/service/ServiceSettings';
import { patch, post } from '@/lib/api';
import { useLoad } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import type { OrgDetails, Plan } from '@/lib/types';

const limitText = (n: number | null, what: string) => (n === null ? `Unlimited ${what}` : `${n} ${what}`);

function Usage({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const pct = limit ? Math.min(100, (used / limit) * 100) : 8;
  return (
    <div className="usage">
      <div className="spread"><span>{label}</span><span className="muted">{used}{limit !== null ? ` of ${limit}` : ' · unlimited'}</span></div>
      <div className={`progress ${pct >= 90 ? 'warn' : 'ac'}`}><i style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

/**
 * Super admin: organization details, plan, usage and the billing contact.
 * Your own company (self-hosted): just its details and what it runs; no plans or limits.
 */
export default function SettingsPage() {
  const { reload: reloadMe } = useSession();
  const { data, error, reload, setData } = useLoad<OrgDetails>('/platform/org');
  const [confirm, setConfirm] = useState<Plan | null>(null);
  const [saved, setSaved] = useState(false);
  const { busy, error: saveError, run } = useAction();
  const own = !!data?.selfHosted;
  useCrumbs([{ label: 'Platform', href: '/console' }, { label: own ? 'Company' : 'Plan & billing' }]);
  if (!data) return error ? <div className="alert">{error}</div> : <Loader label="Loading…" />;
  const plan = data.plans.find((p) => p.id === data.plan)!;
  const trialDays = data.trialEndsAt ? Math.max(0, Math.ceil((new Date(data.trialEndsAt).getTime() - Date.now()) / 86400000)) : null;

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const v = (k: string) => (String(f.get(k) ?? '').trim() || null);
    const next = await run(() => patch<OrgDetails>('/platform/org', { name: v('name') ?? data!.name, billingName: v('billingName'), billingEmail: v('billingEmail'), taxId: v('taxId'), country: v('country') }));
    if (next) { setData(next); setSaved(true); setTimeout(() => setSaved(false), 2000); void reloadMe(); }
  }

  return (
    <>
      {own
        ? <PageHead eyebrow="Platform" title="Company" sub="Your company’s details and what it looks after. No plans or limits: it’s your own server." />
        : <PageHead eyebrow="Platform" title="Plan & billing" sub="Your organization, what your plan allows, and who receives invoices." />}

      <div className="grid-2 mb20">
        {own ? (
          <section className="panel panel-pad stack">
            <div className="stack-tight"><span className="eyebrow">Looking after</span><h2 style={{ fontSize: 20 }}>{data.name}</h2></div>
            <div className="own-counts">
              <div><b>{data.usage.homes}</b><span>home{data.usage.homes === 1 ? '' : 's'}</span></div>
              <div><b>{data.usage.boards}</b><span>board{data.usage.boards === 1 ? '' : 's'}</span></div>
              <div><b>{data.usage.staff}</b><span>staff</span></div>
            </div>
            <span className="small muted">Add as many homes, boards and team members as you need.</span>
          </section>
        ) : (
        <section className="panel panel-pad stack">
          <div className="spread">
            <div className="stack-tight"><span className="eyebrow">Current plan</span><h2 style={{ fontSize: 20 }}>{plan.name}</h2></div>
            <Badge tone={data.status === 'ACTIVE' ? 'ok' : data.status === 'TRIAL' ? 'info' : 'bad'}>
              {data.status === 'TRIAL' ? `Trial · ${trialDays} day${trialDays === 1 ? '' : 's'} left` : data.status === 'ACTIVE' ? 'Active' : data.status === 'PAST_DUE' ? 'Payment due' : 'Cancelled'}
            </Badge>
          </div>
          <Usage label="Homes" used={data.usage.homes} limit={data.limits.homes} />
          <Usage label="Boards" used={data.usage.boards} limit={data.limits.boards} />
          <Usage label="Staff" used={data.usage.staff} limit={data.limits.staff} />
        </section>
        )}
        <section className="panel panel-pad">
          <form className="stack" onSubmit={save}>
            <h2>{own ? 'Company details' : 'Organization'}</h2>
            <div className="form-grid">
              <label className="field">Name<input name="name" defaultValue={data.name} required maxLength={80} /></label>
              <label className="field">Country<input name="country" defaultValue={data.country ?? ''} maxLength={60} /></label>
              <label className="field">{own ? 'Legal name' : 'Billing name'}<input name="billingName" defaultValue={data.billingName ?? ''} maxLength={120} placeholder="Company legal name" /></label>
              <label className="field">{own ? 'Contact email' : 'Invoice email'}<input name="billingEmail" type="email" defaultValue={data.billingEmail ?? ''} /></label>
              <label className="field">Tax ID <span className="hint">optional</span><input name="taxId" defaultValue={data.taxId ?? ''} maxLength={40} /></label>
            </div>
            <ErrorBox error={saveError} />
            <div className="row"><button className="btn btn-primary" disabled={busy}>{saved ? 'Saved ✓' : 'Save details'}</button></div>
          </form>
        </section>
      </div>

      <div className="grid-2 mb20">
        <ServiceSettings org={data} onSaved={setData} />
        <PriceList />
      </div>

      {!own && <>
      <div className="section-head"><h2>Plans</h2></div>
      {!data.paymentsConnected && (
        <div className="notice mb16">Online payments aren’t connected on this server yet, so changing plan takes effect straight away without a charge. Connect a payment provider before selling plans.</div>
      )}
      <div className="plans">
        {data.plans.map((p) => (
          <div key={p.id} className={`plan ${p.id === data.plan ? 'current' : ''}`}>
            <div className="spread"><b style={{ fontSize: 15 }}>{p.name}</b>{p.id === data.plan && <Badge tone="info">Current</Badge>}</div>
            <div className="price">${p.priceUsd}<span> / month</span></div>
            <span className="small muted">{p.blurb}</span>
            <ul>
              <li><Icon name="check" size={14} stroke={2.5} />{limitText(p.homes, 'homes')}</li>
              <li><Icon name="check" size={14} stroke={2.5} />{limitText(p.boards, 'boards')}</li>
              <li><Icon name="check" size={14} stroke={2.5} />{limitText(p.staff, 'staff')}</li>
              <li><Icon name="check" size={14} stroke={2.5} />Owner app, voice assistant, audit log</li>
            </ul>
            {p.id !== data.plan && <button className="btn" onClick={() => setConfirm(p.id)}>{data.plans.findIndex((x) => x.id === p.id) > data.plans.findIndex((x) => x.id === data.plan) ? 'Upgrade' : 'Switch'} to {p.name}</button>}
          </div>
        ))}
      </div>
      </>}
      {confirm && (
        <Confirm title={`Switch to ${data.plans.find((p) => p.id === confirm)!.name}?`} confirmLabel="Switch plan" danger={false}
          body={<>Limits change right away. You’re on {plan.name} today.</>}
          onConfirm={async () => { setData(await post<OrgDetails>('/platform/org/plan', { plan: confirm })); void reloadMe(); void reload(); }}
          onClose={() => setConfirm(null)} />
      )}
    </>
  );
}

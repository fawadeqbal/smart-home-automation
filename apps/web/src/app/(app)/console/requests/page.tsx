'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { NewHomeDialog } from '@/components/console/Dialogs';
import { Icon } from '@/components/Icon';
import { Loader } from '@/components/Loader';
import { useCrumbs } from '@/components/Shell';
import { Avatar, Badge, Empty, ErrorBox, PageHead, useAction } from '@/components/ui';
import { patch } from '@/lib/api';
import { timeAgo, useLoad, useNow } from '@/lib/hooks';
import { useLive } from '@/lib/live';
import { useSession } from '@/lib/session';
import type { Tone, VisitList, VisitRequest, VisitStatus } from '@/lib/types';

const STATUS: { id: VisitStatus; label: string; tone: Tone; dot: string; hint: string }[] = [
  { id: 'NEW', label: 'New', tone: 'warn', dot: 'var(--on)', hint: 'Waiting for a call' },
  { id: 'CONTACTED', label: 'Called', tone: 'info', dot: 'var(--ac)', hint: 'Spoken to, no visit yet' },
  { id: 'SCHEDULED', label: 'Visit booked', tone: 'info', dot: 'var(--ac)', hint: 'A date is set' },
  { id: 'CUSTOMER', label: 'Customer', tone: 'ok', dot: 'var(--ok)', hint: 'Their home is in the console' },
  { id: 'CLOSED', label: 'Not now', tone: 'mute', dot: 'var(--mu)', hint: 'Not interested or no answer' },
];
const statusOf = (id: VisitStatus) => STATUS.find((s) => s.id === id)!;
type Filter = VisitStatus | 'all' | 'open';

/** People who booked a free home visit on the website: call them, book the visit, make their home. */
export default function VisitRequestsPage() {
  useNow(30_000);
  useCrumbs([{ label: 'Platform', href: '/console' }, { label: 'Visit requests' }]);
  const { staffRole } = useSession();
  const canCreateHome = staffRole === 'SUPERADMIN';
  const { data, error, reload } = useLoad<VisitList>('/platform/visit-requests');
  useLive('visits.changed', () => void reload());
  const [filter, setFilter] = useState<Filter>('open');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string | null>(null);

  const rows = useMemo(() => {
    const all = data?.requests ?? [];
    const term = q.trim().toLowerCase();
    return all.filter((r) => (filter === 'all' ? true : filter === 'open' ? ['NEW', 'CONTACTED', 'SCHEDULED'].includes(r.status) : r.status === filter))
      .filter((r) => !term || `${r.name} ${r.phone} ${r.city} ${r.homeSize}`.toLowerCase().includes(term));
  }, [data, filter, q]);
  useEffect(() => {
    if (!data) return;
    if (!sel || !data.requests.some((r) => r.id === sel)) setSel(rows[0]?.id ?? null);
  }, [data, rows, sel]);

  if (!data) return error ? <ErrorBox error={error} /> : <Loader label="Loading requests…" />;
  const open = data.counts.NEW + data.counts.CONTACTED + data.counts.SCHEDULED;
  const chosen = data.requests.find((r) => r.id === sel) ?? null;
  const filters: [Filter, string, string, number][] = [
    ['open', 'To follow up', 'var(--on)', open],
    ...STATUS.map((s) => [s.id, s.label, s.dot, data.counts[s.id]] as [Filter, string, string, number]),
    ['all', 'All', 'var(--mu)', data.requests.length],
  ];

  return (
    <div data-screen-label="Visit requests">
      <PageHead
        eyebrow="Platform" title="Visit requests"
        sub="People who booked a free home visit on your website. Call them within a working day, book the visit, then create their home."
        actions={<a className="btn" href="/welcome" target="_blank" rel="noreferrer"><Icon name="external" size={15} />Open the website</a>}
      />
      <div className="kpis mb16" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(118px, 1fr))' }}>
        {filters.map(([k, label, dot, n]) => (
          <button key={k} className={`kpi ${filter === k ? 'active' : ''}`} onClick={() => setFilter(k)} aria-pressed={filter === k}>
            <span className="kpi-label"><span style={{ width: 7, height: 7, borderRadius: 99, background: dot }} />{label}</span>
            <span className="kpi-value" style={{ fontSize: 22 }}>{n}</span>
          </button>
        ))}
      </div>

      {data.requests.length === 0 ? (
        <Empty action={<a className="btn" href="/welcome" target="_blank" rel="noreferrer"><Icon name="external" size={15} />Open the website</a>}>
          No requests yet. They appear here — with a badge in the menu — as soon as someone books a free visit on your website.
        </Empty>
      ) : (
        <div className="grid-2-wide">
          <div className="stack" style={{ gap: 10, minWidth: 0 }}>
            <label className="input-icon" style={{ width: 'min(320px, 100%)' }}>
              <Icon name="search" size={15} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, phone or city" aria-label="Filter requests" />
            </label>
            <div className="table-wrap">
              <table className="table" style={{ minWidth: 560 }}>
                <thead><tr>{['Person', 'Home', 'Asked', 'Status'].map((c) => <th key={c}>{c}</th>)}</tr></thead>
                <tbody>
                  {rows.map((r) => {
                    const s = statusOf(r.status);
                    return (
                      <tr key={r.id} className={`click ${sel === r.id ? 'selected' : ''}`} onClick={() => setSel(r.id)}>
                        <td>
                          <div className="cell-main" style={{ gap: 10 }}>
                            <Avatar name={r.name} size="sm" />
                            <span className="stack-tight"><b>{r.name}</b><span className="cell-sub mono">{r.phone}</span></span>
                          </div>
                        </td>
                        <td><span className="stack-tight"><span>{r.city}</span><span className="cell-sub">{r.homeSize}</span></span></td>
                        <td className="nowrap muted">{timeAgo(r.createdAt)}</td>
                        <td><Badge tone={s.tone}>{s.label}</Badge></td>
                      </tr>
                    );
                  })}
                  {rows.length === 0 && <tr><td colSpan={4} className="muted" style={{ textAlign: 'center', padding: 24 }}>Nothing here.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
          {chosen && <RequestPanel key={chosen.id} r={chosen} canCreateHome={canCreateHome} onChanged={() => void reload()} />}
        </div>
      )}
    </div>
  );
}

function RequestPanel({ r, canCreateHome, onChanged }: { r: VisitRequest; canCreateHome: boolean; onChanged: () => void }) {
  const { busy, error, run } = useAction();
  const [note, setNote] = useState(r.note);
  const [saved, setSaved] = useState(false);
  const [creating, setCreating] = useState(false);
  const s = statusOf(r.status);
  const tel = r.phone.replace(/[^\d+]/g, '');
  // WhatsApp wants the international number without + (a local 03xx number is Pakistan: 92 3xx)
  const wa = tel.startsWith('+') ? tel.slice(1) : tel.startsWith('00') ? tel.slice(2) : tel.startsWith('0') ? `92${tel.slice(1)}` : tel;

  async function save(body: { status?: VisitStatus; note?: string; homeId?: string }) {
    const ok = await run(() => patch(`/platform/visit-requests/${r.id}`, body));
    if (ok !== undefined) onChanged();
    return ok !== undefined;
  }

  return (
    <aside className="side-panel">
      <div className="sp-head">
        <div className="row" style={{ gap: 10, flexWrap: 'nowrap' }}>
          <Avatar name={r.name} />
          <span className="stack-tight"><b style={{ fontSize: 15 }}>{r.name}</b><span className="cell-sub">{r.city} · {r.homeSize}</span></span>
          <span className="push"><Badge tone={s.tone}>{s.label}</Badge></span>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <a className="btn btn-primary grow" href={`tel:${tel}`}><Icon name="phone" size={14} />Call {r.phone}</a>
          <a className="btn" href={`https://wa.me/${wa}`} target="_blank" rel="noreferrer" title="Message on WhatsApp"><Icon name="message" size={14} />WhatsApp</a>
        </div>
      </div>
      <dl>
        <dt>Asked</dt><dd>{new Date(r.createdAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · {timeAgo(r.createdAt)}</dd>
        <dt>Home size</dt><dd>{r.homeSize}</dd>
        <dt>City</dt><dd>{r.city}</dd>
        {r.handledBy && <><dt>Handled by</dt><dd>{r.handledBy}</dd></>}
        {r.home && <><dt>Home</dt><dd><Link href={`/console/homes/${r.home.id}`}>{r.home.name}</Link></dd></>}
      </dl>
      <div className="sp-body">
        <ErrorBox error={error} />
        <b style={{ fontSize: 13.5 }}>Where it stands</b>
        <div className="visit-steps" role="radiogroup" aria-label="Status">
          {STATUS.map((x) => (
            <button key={x.id} role="radio" aria-checked={r.status === x.id} className={r.status === x.id ? 'on' : ''} disabled={busy}
              onClick={() => r.status !== x.id && void save({ status: x.id })} title={x.hint}>
              <span style={{ background: x.dot }} />{x.label}
            </button>
          ))}
        </div>
        <label className="field">Notes <span className="hint">only your team sees these</span>
          <textarea rows={3} value={note} maxLength={1000} placeholder="Called at 11 am · visit on Saturday at 4 pm · wants the motor on a timer"
            onChange={(e) => { setNote(e.target.value); setSaved(false); }} />
        </label>
        {note !== r.note && <button className="btn btn-sm" disabled={busy} onClick={async () => { if (await save({ note })) setSaved(true); }}>Save note</button>}
        {saved && note === r.note && <span className="small fg-ok">Saved.</span>}
        {r.home ? (
          <Link className="btn btn-block" href={`/console/homes/${r.home.id}`}><Icon name="house" size={15} />Open {r.home.name}</Link>
        ) : canCreateHome ? (
          <button className="btn btn-block" onClick={() => setCreating(true)}><Icon name="plus" size={15} />Create their home</button>
        ) : null}
        <span className="small muted" style={{ lineHeight: 1.45 }}>Creating their home marks them as a customer and links the home here.</span>
      </div>
      {creating && (
        <NewHomeDialog defaults={{ name: `${r.name.split(' ')[0]}’s home`, city: r.city === 'Somewhere else' ? '' : r.city }}
          onClose={() => setCreating(false)} onCreated={(homeId) => void save({ homeId, status: 'CUSTOMER' })} />
      )}
    </aside>
  );
}

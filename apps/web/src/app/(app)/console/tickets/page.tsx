'use client';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Icon } from '@/components/Icon';
import { Loader } from '@/components/Loader';
import { useCrumbs } from '@/components/Shell';
import { PRIORITY, StatusBadge } from '@/components/tickets/parts';
import { Badge, Empty, ErrorBox, FormModal, PageHead, Seg } from '@/components/ui';
import { get, post } from '@/lib/api';
import { timeAgo, useLoad, useNow } from '@/lib/hooks';
import { useLive } from '@/lib/live';
import type { Ticket, TicketQueue } from '@/lib/types';
import { CATEGORY } from '@/components/tickets/parts';
import { RatingsSummary } from '@/components/service/RatingsSummary';
import { starsText } from '@/components/service/Stars';

type View = 'open' | 'mine' | 'done' | 'all';
const ORDER = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 } as const;

/** The team's queue: every home's requests, most urgent and overdue first. */
export default function TicketsPage() {
  useNow(30_000);
  useCrumbs([{ label: 'Platform', href: '/console' }, { label: 'Tickets' }]);
  const router = useRouter();
  const [view, setView] = useState<View>('open');
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState<{ id: string; name: string }[] | null>(null);
  const path = view === 'mine' ? '/platform/tickets?status=open&mine=true' : view === 'all' ? '/platform/tickets' : `/platform/tickets?status=${view}`;
  const { data, error, reload } = useLoad<TicketQueue>(path);
  useLive('notification', () => void reload());

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data?.tickets ?? [])
      .filter((t) => !term || `${t.number} ${t.title} ${t.home} ${t.city}`.toLowerCase().includes(term))
      .sort((a, b) => view === 'done' || view === 'all' ? 0 : Number(b.overdue) - Number(a.overdue) || ORDER[a.priority] - ORDER[b.priority]);
  }, [data, q, view]);

  return (
    <div data-screen-label="Tickets">
      <PageHead eyebrow="Platform" title="Tickets"
                sub={data ? `${data.open} open${data.overdue ? ` · ${data.overdue} overdue` : ''}. Urgent ones should be answered within 4 hours, high within a day, normal within 3 days.` : 'Requests from homes.'}
                actions={<>
                  <Seg options={[{ id: 'open', label: 'Open' }, { id: 'mine', label: 'Mine' }, { id: 'done', label: 'Solved' }, { id: 'all', label: 'All' }]} value={view} onChange={setView} />
                  <button className="btn" onClick={() => void get<{ id: string; name: string }[]>('/platform/homes').then(setCreating)}><Icon name="plus" size={15} />New ticket</button>
                </>} />
      {creating && (
        <FormModal title="New ticket" sub="For a request that came by phone or WhatsApp, so the answer and history stay in one place." submitLabel="Open ticket" onClose={() => setCreating(null)}
                   onSubmit={async (f) => {
                     const t = await post<Ticket>('/platform/tickets', { homeId: f.get('homeId'), title: f.get('title'), body: f.get('body'), category: f.get('category') });
                     router.push(`/console/tickets/${t.id}`);
                   }}>
          <label className="field">Home<select name="homeId" required>{creating.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select></label>
          <label className="field">About<select name="category" defaultValue="fault">{Object.entries(CATEGORY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="field">Title<input name="title" required maxLength={100} placeholder="e.g. Motor doesn’t switch on from the app" /></label>
          <label className="field">What they said<textarea name="body" rows={4} required maxLength={4000} /></label>
        </FormModal>
      )}
      {!data ? (error ? <ErrorBox error={error} /> : <Loader label="Loading tickets…" />) : (
        <div className="stack" style={{ gap: 10 }}>
          <div className="spread" style={{ gap: 10, flexWrap: 'wrap' }}>
            <label className="input-icon" style={{ width: 'min(320px, 100%)' }}>
              <Icon name="search" size={15} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Number, title or home" aria-label="Filter tickets" />
            </label>
            <RatingsSummary compact />
          </div>
          {rows.length === 0 ? <Empty>{view === 'open' ? 'Nothing open. Requests from homes — and “Send to support” in Diagnostics — land here.' : 'Nothing here.'}</Empty> : (
            <div className="table-wrap">
              <table className="table" style={{ minWidth: 720 }}>
                <thead><tr>{['Ticket', 'Home', 'Priority', 'Status', 'With', 'Updated'].map((c) => <th key={c}>{c}</th>)}</tr></thead>
                <tbody>
                  {rows.map((t) => (
                    <tr key={t.id} className="click" onClick={() => router.push(`/console/tickets/${t.id}`)}>
                      <td>
                        <span className="stack-tight" style={{ maxWidth: 360 }}>
                          <b className="truncate">#{t.number} · {t.title}</b>
                          {t.last && <span className="cell-sub truncate">{t.last.internal ? '🔒 ' : ''}{t.last.by ? `${t.last.by}: ` : ''}{t.last.text}</span>}
                        </span>
                      </td>
                      <td><span className="stack-tight"><span>{t.home}</span><span className="cell-sub">{t.city}</span></span></td>
                      <td><Badge tone={PRIORITY[t.priority].tone}>{PRIORITY[t.priority].label}</Badge></td>
                      <td><StatusBadge t={t} staffView />{t.rating ? <div className="stars-text small" title={t.ratingComment ?? undefined}>{starsText(t.rating)}</div> : null}</td>
                      <td className="nowrap">{t.assignee ?? <span className="muted">Nobody</span>}</td>
                      <td className="nowrap muted">{timeAgo(t.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

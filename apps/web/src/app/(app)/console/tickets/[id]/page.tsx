'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Icon } from '@/components/Icon';
import { Loader } from '@/components/Loader';
import { useCrumbs } from '@/components/Shell';
import { CATEGORY, PRIORITY, ReplyBox, StatusBadge, Thread } from '@/components/tickets/parts';
import { ErrorBox, useAction } from '@/components/ui';
import { patch, post } from '@/lib/api';
import { timeAgo, useLoad } from '@/lib/hooks';
import { useLive } from '@/lib/live';
import { useSession } from '@/lib/session';
import type { Ticket, TicketPriority, TicketStatus } from '@/lib/types';

const STATUSES: [TicketStatus, string][] = [['OPEN', 'Open'], ['IN_PROGRESS', 'Being worked on'], ['WAITING', 'Waiting for the home'], ['RESOLVED', 'Solved'], ['CLOSED', 'Closed']];

export default function ConsoleTicketPage() {
  const { id } = useParams<{ id: string }>();
  const { me, staffRole } = useSession();
  const t = useLoad<Ticket>(`/platform/tickets/${id}`);
  useLive('notification', () => void t.reload());
  useCrumbs([{ label: 'Platform', href: '/console' }, { label: 'Tickets', href: '/console/tickets' }, { label: t.data ? `#${t.data.number}` : '…' }]);
  const { busy, error, run } = useAction();
  if (!t.data) return t.error ? <ErrorBox error={t.error} /> : <Loader />;
  const d = t.data;
  const change = (body: Record<string, unknown>) => run(async () => { await patch(`/platform/tickets/${id}`, body); await t.reload(); });
  const setStatus = (status: TicketStatus) => run(async () => { await post(`/platform/tickets/${id}/reply`, { body: '', status }); await t.reload(); });
  const due = d.dueAt ? new Date(d.dueAt) : null;

  return (
    <div className="stack">
      <Link href="/console/tickets" className="details-link">← Tickets</Link>
      <div className="spread" style={{ alignItems: 'flex-start', gap: 12 }}>
        <div className="stack-tight">
          <h1 style={{ margin: 0 }}>#{d.number} · {d.title}</h1>
          <span className="muted small">
            <Link href={`/console/homes/${d.homeId}`}>{d.home}</Link>{d.city ? `, ${d.city}` : ''} · {CATEGORY[d.category] ?? d.category} · opened by {d.openedBy ?? 'someone'} {timeAgo(d.createdAt)}
          </span>
        </div>
        <StatusBadge t={d} staffView />
      </div>
      <div className="ticket-grid">
        <div className="stack">
          <section className="card card-pad"><Thread messages={d.messages} staffView /></section>
          <ReplyBox staff placeholder={`Reply to ${d.home}…`} onSend={async (body, internal) => { await post(`/platform/tickets/${id}/reply`, { body, internal }); await t.reload(); }} />
        </div>
        <aside className="card card-pad ticket-props">
          <label className="field">Status
            <select value={d.status} disabled={busy} onChange={(e) => void setStatus(e.target.value as TicketStatus)}>
              {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className="field">Priority
            <select value={d.priority} disabled={busy} onChange={(e) => void change({ priority: e.target.value as TicketPriority })}>
              {(Object.keys(PRIORITY) as TicketPriority[]).map((p) => <option key={p} value={p}>{PRIORITY[p].label}</option>)}
            </select>
          </label>
          <label className="field">With
            {staffRole === 'INSTALLER' ? (
              <span className="row" style={{ gap: 8 }}>
                <span className="grow">{d.assignee ?? 'Nobody'}</span>
                {d.assigneeId !== me.id && <button className="btn btn-sm" disabled={busy} onClick={() => void change({ assigneeId: me.id })}>Take it</button>}
              </span>
            ) : (
              <select value={d.assigneeId ?? ''} disabled={busy} onChange={(e) => void change({ assigneeId: e.target.value || null })}>
                <option value="">Nobody</option>
                {d.staff?.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.staffRole.toLowerCase()}</option>)}
              </select>
            )}
          </label>
          <div className="stack-tight small">
            <span className="muted">Answer by</span>
            <span className={d.overdue ? 'text-bad' : ''}>{due ? due.toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '–'}{d.overdue ? ' (overdue)' : ''}</span>
          </div>
          {d.node && (
            <Link className="btn btn-sm" href={`/console/homes/${d.homeId}?tab=diagnostics&board=${d.node.id}`}>
              <Icon name="cpu" size={14} />{d.node.name} · {d.node.online ? 'online' : 'offline'}
            </Link>
          )}
          <Link className="btn btn-sm" href={`/console/homes/${d.homeId}`}><Icon name="house" size={14} />Open the home</Link>
          <ErrorBox error={error} />
        </aside>
      </div>
    </div>
  );
}

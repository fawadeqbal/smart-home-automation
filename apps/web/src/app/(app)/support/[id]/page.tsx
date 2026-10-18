'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Icon } from '@/components/Icon';
import { Loader } from '@/components/Loader';
import { useCrumbs } from '@/components/Shell';
import { RateTicket } from '@/components/service/Stars';
import { CATEGORY, ReplyBox, StatusBadge, Thread } from '@/components/tickets/parts';
import { useAction } from '@/components/ui';
import { post } from '@/lib/api';
import { useLoad } from '@/lib/hooks';
import { useLive } from '@/lib/live';
import { useSession } from '@/lib/session';
import type { Ticket } from '@/lib/types';

export default function SupportTicketPage() {
  const { id } = useParams<{ id: string }>();
  const { home } = useSession();
  const t = useLoad<Ticket>(`/support/tickets/${id}`);
  useLive('notification', () => void t.reload());
  useCrumbs([{ label: home?.name ?? 'Home', href: '/' }, { label: 'Help requests', href: '/support' }, { label: t.data ? `#${t.data.number}` : '…' }]);
  const { busy, run } = useAction();
  if (!t.data) return t.error ? <div className="alert">{t.error}</div> : <Loader />;
  const d = t.data;
  const done = d.status === 'RESOLVED' || d.status === 'CLOSED';
  const send = (body: string, solved?: boolean) => post<Ticket>(`/support/tickets/${id}/reply`, { body, ...(solved !== undefined ? { solved } : {}) }).then(() => t.reload());

  return (
    <div className="stack" style={{ maxWidth: 820 }}>
      <Link href="/support" className="details-link">← Help requests</Link>
      <div className="spread" style={{ alignItems: 'flex-start', gap: 12 }}>
        <div className="stack-tight">
          <h1 style={{ margin: 0 }}>#{d.number} · {d.title}</h1>
          <span className="muted small">{CATEGORY[d.category] ?? d.category} · asked by {d.openedBy ?? 'someone'} on {new Date(d.createdAt).toLocaleDateString([], { day: 'numeric', month: 'short' })}</span>
        </div>
        <StatusBadge t={d} />
      </div>
      {d.status === 'WAITING' && <div className="banner warn"><span className="banner-text"><b>Waiting for your answer</b><span>The team asked you something below.</span></span></div>}
      <section className="card card-pad stack"><Thread messages={d.messages} /></section>
      {done && <RateTicket key={`${d.id}:${d.rating ?? 0}:${d.ratedAt ?? ''}`} t={d} onRated={() => void t.reload()} />}
      {!home?.readOnly && (done ? (
        <div className="card card-pad row" style={{ gap: 10 }}>
          <Icon name="check" size={16} /><span className="grow">This request is {d.status === 'RESOLVED' ? 'solved' : 'closed'}. Still a problem?</span>
          <button className="btn" disabled={busy} onClick={() => void run(() => send('', false))}>Open it again</button>
        </div>
      ) : (
        <ReplyBox onSend={(body) => send(body)} placeholder="Add details or answer the team…"
                  extra={<button type="button" className="btn" disabled={busy} onClick={() => void run(() => send('', true))}><Icon name="check" size={14} />It’s solved</button>} />
      ))}
    </div>
  );
}

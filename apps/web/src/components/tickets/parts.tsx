'use client';
import { FormEvent, useState } from 'react';
import { Icon } from '@/components/Icon';
import { Badge, ErrorBox } from '@/components/ui';
import { timeAgo } from '@/lib/hooks';
import type { Ticket, TicketMessage, TicketPriority, TicketStatus, Tone } from '@/lib/types';

export const STATUS_TONE: Record<TicketStatus, Tone> = { OPEN: 'warn', IN_PROGRESS: 'info', WAITING: 'warn', RESOLVED: 'ok', CLOSED: 'mute' };
export const PRIORITY: Record<TicketPriority, { label: string; tone: Tone }> = {
  URGENT: { label: 'Urgent', tone: 'bad' }, HIGH: { label: 'High', tone: 'warn' }, NORMAL: { label: 'Normal', tone: 'mute' }, LOW: { label: 'Low', tone: 'mute' },
};
export const CATEGORY: Record<string, string> = { fault: 'Something isn’t working', installation: 'New work or a change', billing: 'Billing', question: 'A question', other: 'Something else' };

export function StatusBadge({ t, staffView = false }: { t: Pick<Ticket, 'status' | 'statusText' | 'overdue'>; staffView?: boolean }) {
  return (
    <span className="row" style={{ gap: 6 }}>
      <Badge tone={STATUS_TONE[t.status]}>{staffView && t.status === 'WAITING' ? 'Waiting for the home' : t.statusText}</Badge>
      {staffView && t.overdue && <Badge tone="bad">Overdue</Badge>}
    </span>
  );
}

const when = (iso: string) => new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/** The conversation: the home on the left, the team on the right; staff-only notes marked; status changes as small lines. */
export function Thread({ messages, staffView = false }: { messages: TicketMessage[]; staffView?: boolean }) {
  return (
    <div className="thread">
      {messages.map((m) => m.event ? (
        <div key={m.id} className="thread-event"><span>{m.body}{m.by ? ` · ${m.by}` : ''} · {timeAgo(m.at)}</span></div>
      ) : (
        <div key={m.id} className={`msg ${m.staff ? 'team' : 'home'} ${m.internal ? 'internal' : ''}`}>
          <div className="msg-head">
            <b>{m.by ?? 'Someone'}</b>
            {m.staff && !staffView && <span className="muted"> · support</span>}
            {m.internal && <span className="msg-note"><Icon name="lock" size={11} /> Team only</span>}
            <span className="muted push" title={when(m.at)}>{timeAgo(m.at)}</span>
          </div>
          <div className="msg-body">{m.body}</div>
        </div>
      ))}
    </div>
  );
}

/** Write a reply; staff can make it a team-only note. */
export function ReplyBox({ onSend, staff = false, placeholder, extra }: {
  onSend: (body: string, internal: boolean) => Promise<unknown>; staff?: boolean; placeholder?: string; extra?: React.ReactNode;
}) {
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true); setError(null);
    try { await onSend(body, internal); setBody(''); } catch (err) { setError(err instanceof Error ? err.message : 'Could not send'); } finally { setBusy(false); }
  }
  return (
    <form className={`reply-box ${internal ? 'internal' : ''}`} onSubmit={submit}>
      <textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} maxLength={4000}
                placeholder={internal ? 'A note only your team sees…' : placeholder ?? 'Write a reply…'} aria-label="Reply" />
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {staff && <label className="check small"><input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Team-only note</label>}
        <span className="push row" style={{ gap: 8 }}>
          {extra}
          <button className="btn btn-primary" disabled={busy || !body.trim()}><Icon name="send" size={14} />{internal ? 'Save note' : 'Send'}</button>
        </span>
      </div>
      <ErrorBox error={error} />
    </form>
  );
}

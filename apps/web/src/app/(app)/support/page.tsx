'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { Loader } from '@/components/Loader';
import { useCrumbs } from '@/components/Shell';
import { CATEGORY, StatusBadge } from '@/components/tickets/parts';
import { Empty, FormModal, PageHead } from '@/components/ui';
import { post } from '@/lib/api';
import { timeAgo, useLoad } from '@/lib/hooks';
import { useLive } from '@/lib/live';
import { useSession } from '@/lib/session';
import type { Ticket } from '@/lib/types';

/** The home's help requests: ask for help, see the answers. */
export default function SupportPage() {
  const router = useRouter();
  const { home, isAdmin } = useSession();
  useCrumbs([{ label: home?.name ?? 'Home', href: '/' }, { label: 'Help requests' }]);
  const list = useLoad<Ticket[]>('/support/tickets');
  useLive('notification', () => void list.reload());
  const [asking, setAsking] = useState(false);
  const canAsk = !home?.readOnly;

  return (
    <div className="stack" style={{ maxWidth: 820 }}>
      <PageHead title="Help requests" sub={isAdmin ? 'Ask your installer’s team for help, and see every request from this home.' : 'Ask for help, and see the answers to your requests.'}
                actions={<>
                  {isAdmin && <Link className="btn" href="/installation"><Icon name="file-text" size={15} />Installation report</Link>}
                  {canAsk && <button className="btn btn-primary" onClick={() => setAsking(true)}><Icon name="plus" size={15} />Ask for help</button>}
                </>} />
      {!list.data ? (list.error ? <div className="alert">{list.error}</div> : <Loader />) : list.data.length === 0 ? (
        <Empty action={canAsk ? <button className="btn btn-primary" onClick={() => setAsking(true)}>Ask for help</button> : undefined}>
          No requests yet. If something isn’t working, or you want something added or changed, ask here. Your installer’s team answers here and you get a notification.
        </Empty>
      ) : (
        <div className="card">
          {list.data.map((t) => (
            <Link key={t.id} href={`/support/${t.id}`} className="ticket-row">
              <span className="grow stack-tight" style={{ minWidth: 0 }}>
                <b className="truncate">#{t.number} · {t.title}</b>
                <span className="small muted truncate">
                  {CATEGORY[t.category] ?? t.category} · {t.openedBy ?? ''} · updated {timeAgo(t.updatedAt)}
                </span>
              </span>
              <StatusBadge t={t} />
              <Icon name="chevron-right" size={16} />
            </Link>
          ))}
        </div>
      )}
      {asking && (
        <FormModal title="Ask for help" sub="Say what’s wrong or what you need. Your installer’s team gets it right away." submitLabel="Send" onClose={() => setAsking(false)}
                   onSubmit={async (f) => {
                     const t = await post<Ticket>('/support/tickets', { title: String(f.get('title') || '') || undefined, body: String(f.get('body')), category: String(f.get('category')) });
                     router.push(`/support/${t.id}`);
                   }}>
          <label className="field">What is it about?
            <select name="category" defaultValue="fault">{Object.entries(CATEGORY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          </label>
          <label className="field">Short title (optional)<input name="title" maxLength={100} placeholder="e.g. Kitchen light doesn’t switch on" /></label>
          <label className="field">Tell us more
            <textarea name="body" rows={5} required minLength={3} maxLength={4000} placeholder="What happened, since when, which room. For sparks, smoke or water near a board, switch it off at the DB first." />
          </label>
        </FormModal>
      )}
    </div>
  );
}

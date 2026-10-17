'use client';
import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { Loader } from '@/components/Loader';
import { useCrumbs } from '@/components/Shell';
import { Badge, Empty, ErrorBox, PageHead, useAction } from '@/components/ui';
import { del, post } from '@/lib/api';
import { timeAgo, useLoad } from '@/lib/hooks';

interface Backups { backups: { name: string; size: number; createdAt: string; manual: boolean }[]; running: boolean; lastError: { at: string; message: string } | null; keepDays: number }
const size = (b: number) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/** Server backups: every night by themselves, or now; download one to keep a copy off the server. */
export default function BackupsPage() {
  useCrumbs([{ label: 'Platform', href: '/console' }, { label: 'Backups' }]);
  const b = useLoad<Backups>('/platform/backups');
  const { busy, error, run } = useAction();
  const [made, setMade] = useState<string | null>(null);
  if (!b.data) return b.error ? <ErrorBox error={b.error} /> : <Loader />;
  const d = b.data;
  const newest = d.backups[0];
  return (
    <div className="stack" style={{ maxWidth: 900 }}>
      <PageHead eyebrow="Platform" title="Backups"
                sub={`Every night at 3 am the whole database, the firmware builds and the installation photos are saved in one file on the server. Kept ${d.keepDays} days. Download one now and then and keep it somewhere else too.`}
                actions={<button className="btn btn-primary" disabled={busy || d.running} onClick={() => void run(async () => { const x = await post<Backups>('/platform/backups'); b.setData(x); setMade(x.backups[0]?.name ?? null); })}>
                  <Icon name="database" size={15} />{busy || d.running ? 'Backing up…' : 'Back up now'}
                </button>} />
      {d.lastError && <div className="alert">The last backup failed {timeAgo(d.lastError.at)}: {d.lastError.message}</div>}
      <ErrorBox error={error} />
      {newest && !d.lastError && (
        <div className={`banner ${Date.now() - new Date(newest.createdAt).getTime() > 2 * 86_400_000 ? 'warn' : 'ok'}`}>
          <span className="banner-led" />
          <div className="banner-text"><b>Last backup {Date.now() - new Date(newest.createdAt).getTime() < 60_000 ? 'just now' : timeAgo(newest.createdAt)}</b><span>{size(newest.size)}{made === newest.name ? ' · just made' : ''}</span></div>
        </div>
      )}
      {d.backups.length === 0 ? <Empty>No backups yet. The first one is made tonight at 3 am — or press <b>Back up now</b>.</Empty> : (
        <div className="card">
          {d.backups.map((x) => (
            <div key={x.name} className="ticket-row">
              <Icon name="archive" size={16} />
              <span className="grow stack-tight" style={{ minWidth: 0 }}>
                <b className="mono small truncate">{x.name}</b>
                <span className="small muted">{new Date(x.createdAt).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })} · {size(x.size)}</span>
              </span>
              {x.manual ? <Badge tone="info">Made by hand</Badge> : <Badge tone="mute">Nightly</Badge>}
              <a className="btn btn-sm" href={`/api/platform/backups/${x.name}`} download><Icon name="download" size={14} />Download</a>
              <button className="icon-btn" aria-label={`Delete ${x.name}`} onClick={() => confirm(`Delete ${x.name}?`) && void run(async () => b.setData(await del<Backups>(`/platform/backups/${x.name}`)))}><Icon name="trash" size={14} /></button>
            </div>
          ))}
        </div>
      )}
      <p className="small muted">To put a backup back, see “Backups and restoring” in the Help Center. The file holds everyone’s accounts: keep downloaded copies safe.</p>
    </div>
  );
}

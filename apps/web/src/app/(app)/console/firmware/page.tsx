'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { UploadDialog } from '@/components/FirmwarePanel';
import { Icon } from '@/components/Icon';
import { Loader } from '@/components/Loader';
import { useCrumbs } from '@/components/Shell';
import { Badge, Empty, ErrorBox, FormModal, PageHead } from '@/components/ui';
import { post } from '@/lib/api';
import { timeAgo, useLoad, useNow } from '@/lib/hooks';
import type { Rollout, RolloutList, RolloutTarget, Tone } from '@/lib/types';

const STATUS: Record<Rollout['status'], [string, Tone]> = {
  RUNNING: ['Rolling out', 'info'], PAUSED: ['Paused', 'warn'], HALTED: ['Stopped — needs a look', 'bad'], DONE: ['Finished', 'ok'], CANCELLED: ['Cancelled', 'mute'],
};
const TARGET: Record<RolloutTarget['status'], [string, Tone]> = {
  PENDING: ['Waiting', 'mute'], SENT: ['Updating…', 'info'], DONE: ['Updated', 'ok'], FAILED: ['Failed', 'bad'], SKIPPED: ['Skipped', 'warn'],
};

/** Firmware builds, and rolling one out to every board in waves. */
export default function FirmwarePage() {
  useNow(15_000);
  useCrumbs([{ label: 'Platform', href: '/console' }, { label: 'Firmware' }]);
  const list = useLoad<RolloutList>('/platform/rollouts');
  const [starting, setStarting] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = list.data?.rollouts.some((r) => r.status === 'RUNNING');
  const { reload } = list;
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => void reload(), 5000);
    return () => clearInterval(t);
  }, [live, reload]);
  if (!list.data) return list.error ? <ErrorBox error={list.error} /> : <Loader />;
  const d = list.data;
  const act = async (id: string, action: string) => {
    setError(null);
    try { list.setData(await post<RolloutList>(`/platform/rollouts/${id}/${action}`)); } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
  };

  return (
    <div data-screen-label="Firmware">
      <PageHead eyebrow="Platform" title="Firmware"
                sub="Roll a build out to every board safely: one board first, then a few at a time, watching each wave. Any failure stops it until you look."
                actions={d.canEdit && <button className="btn" onClick={() => setUploading(true)}><Icon name="plus" size={15} />Upload build</button>} />
      <ErrorBox error={error} />
      <section className="section">
        <div className="section-head"><h2>Rollouts</h2></div>
        {d.rollouts.length === 0 ? <Empty>No rollouts yet. Pick a build below and press <b>Roll out</b>.</Empty> : d.rollouts.map((r) => (
          <div key={r.id} className="card card-pad stack rollout">
            <div className="spread" style={{ gap: 10, flexWrap: 'wrap' }}>
              <div className="stack-tight">
                <b style={{ fontSize: 16 }}>{r.version}</b>
                <span className="small muted">
                  Started {timeAgo(r.createdAt)} · waves of {r.waveSize}, {r.waveGapMin} min apart{r.daytimeOnly ? ' · daytime only' : ''}{r.skipWeak ? ' · skips weak Wi‑Fi' : ''}
                </span>
              </div>
              <span className="row" style={{ gap: 6 }}>
                <Badge tone={STATUS[r.status][1]}>{STATUS[r.status][0]}</Badge>
                {d.canEdit && r.status === 'RUNNING' && <button className="btn btn-sm" onClick={() => void act(r.id, 'pause')}>Pause</button>}
                {d.canEdit && (r.status === 'PAUSED' || r.status === 'HALTED') && <button className="btn btn-sm btn-primary" onClick={() => void act(r.id, 'resume')}>Go on</button>}
                {d.canEdit && ['DONE', 'HALTED', 'CANCELLED'].includes(r.status) && (r.counts.failed + r.counts.skipped) > 0 && <button className="btn btn-sm" onClick={() => void act(r.id, 'retry')}>Retry {r.counts.failed + r.counts.skipped} skipped</button>}
                {d.canEdit && ['RUNNING', 'PAUSED', 'HALTED'].includes(r.status) && <button className="btn btn-sm" onClick={() => confirm(`Cancel the ${r.version} rollout? Boards already updated keep it.`) && void act(r.id, 'cancel')}>Cancel</button>}
              </span>
            </div>
            {r.haltReason && <div className="alert">{r.haltReason}</div>}
            <div className="rollout-bar" aria-label={`${r.counts.done} of ${r.counts.total} updated`}>
              {(['done', 'sent', 'failed', 'skipped'] as const).map((k) => r.counts[k] > 0 && <span key={k} className={`rb-${k}`} style={{ width: `${(r.counts[k] / r.counts.total) * 100}%` }} />)}
            </div>
            <span className="small">
              <b>{r.counts.done}</b> of {r.counts.total} updated{r.counts.sent ? ` · ${r.counts.sent} updating now` : ''}{r.counts.failed ? ` · ${r.counts.failed} failed` : ''}{r.counts.skipped ? ` · ${r.counts.skipped} skipped` : ''}
              {r.status === 'RUNNING' && ` · wave ${r.wave + 1} of ${r.waves}`}{r.status === 'RUNNING' && r.nextWaveAt ? ` · next wave ${timeAgo(r.nextWaveAt).replace(' ago', '') === 'just now' ? 'now' : `at ${new Date(r.nextWaveAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`}` : ''}
            </span>
            <details>
              <summary className="small">Boards ({r.counts.total})</summary>
              <div className="table-wrap" style={{ marginTop: 8 }}>
                <table className="table" style={{ minWidth: 640 }}>
                  <thead><tr>{['Wave', 'Board', 'Home', 'From', 'Status', ''].map((c) => <th key={c}>{c}</th>)}</tr></thead>
                  <tbody>
                    {r.targets.map((t) => (
                      <tr key={t.id}>
                        <td>{t.wave === 0 ? 'First' : t.wave + 1}</td>
                        <td>{t.homeId ? <Link href={`/console/homes/${t.homeId}/boards/${encodeURIComponent(t.nodeId)}?tab=firmware`}>{t.name}</Link> : t.name}<div className="cell-sub">{t.online ? `online${t.rssi !== null ? ` · ${t.rssi} dBm` : ''}` : 'offline'}</div></td>
                        <td>{t.home ?? '—'}</td>
                        <td className="mono small">{t.fromVersion ?? '?'}</td>
                        <td><Badge tone={TARGET[t.status][1]}>{TARGET[t.status][0]}</Badge></td>
                        <td className="small muted">{t.note ?? (t.doneAt ? timeAgo(t.doneAt) : t.sentAt ? `sent ${timeAgo(t.sentAt)}` : '')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </div>
        ))}
      </section>

      <section className="section">
        <div className="section-head"><h2>Builds</h2></div>
        {d.images.length === 0 ? <Empty>No builds uploaded yet.</Empty> : (
          <div className="card">
            {d.images.map((img) => (
              <div key={img.id} className="ticket-row">
                <span className="grow stack-tight" style={{ minWidth: 0 }}><b className="mono">{img.version}</b><span className="small muted truncate">{img.notes || 'No notes'} · uploaded {timeAgo(img.createdAt)}</span></span>
                {d.canEdit && <button className="btn btn-sm btn-primary" onClick={() => setStarting(img.id)}><Icon name="send" size={13} />Roll out</button>}
              </div>
            ))}
          </div>
        )}
      </section>

      {starting && (
        <FormModal title={`Roll out ${d.images.find((i) => i.id === starting)?.version}`} sub="Every board not on this version gets it: the strongest online board first, then a few boards at a time." submitLabel="Start" onClose={() => setStarting(null)}
                   onSubmit={async (f) => list.setData(await post<RolloutList>('/platform/rollouts', {
                     firmwareId: starting, waveSize: Number(f.get('waveSize')), waveGapMin: Number(f.get('gap')), maxFailures: Number(f.get('maxFailures')),
                     daytimeOnly: f.get('daytime') === 'on', skipWeak: f.get('weak') === 'on',
                   }))}>
          <div className="form-grid">
            <label className="field">Boards per wave<input name="waveSize" type="number" min={1} max={50} defaultValue={5} /></label>
            <label className="field">Watch each wave for (minutes)<input name="gap" type="number" min={0} max={1440} defaultValue={30} /></label>
            <label className="field">Stop after this many failures<input name="maxFailures" type="number" min={1} max={20} defaultValue={1} /></label>
          </div>
          <label className="check"><input type="checkbox" name="daytime" defaultChecked /> Only in the daytime (10 am – 5 pm at each home)</label>
          <label className="check"><input type="checkbox" name="weak" defaultChecked /> Skip boards with weak Wi‑Fi (they can be retried later)</label>
        </FormModal>
      )}
      {uploading && <UploadDialog onClose={() => setUploading(false)} onDone={() => { setUploading(false); void list.reload(); }} existing={d.images.map((i) => i.version)} />}
    </div>
  );
}

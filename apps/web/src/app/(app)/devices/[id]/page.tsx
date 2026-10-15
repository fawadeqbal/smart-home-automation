'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useLoad } from '@/lib/hooks';
import { useLive } from '@/lib/live';
import type { Device, HistoryEntry } from '@/lib/types';
import { Loader } from '@/components/Loader';

const SOURCE: Record<string, string> = {
  remote: 'App or voice', button: 'Wall button', boot: 'Board restarted', sensor: 'Reading', automation: 'Automation',
};

/** A small line chart of one sensor field over the loaded history (oldest left). */
function Sparkline({ entries, field, label, unit }: { entries: HistoryEntry[]; field: string; label: string; unit?: string }) {
  const points = entries
    .map((e) => ({ t: new Date(e.at).getTime(), v: e.state[field] }))
    .filter((p): p is { t: number; v: number } => typeof p.v === 'number')
    .reverse();
  if (points.length < 2) return null;
  const W = 600, H = 120, P = 8;
  const t0 = points[0].t, t1 = points.at(-1)!.t;
  const vs = points.map((p) => p.v);
  const lo = Math.min(...vs), hi = Math.max(...vs), span = hi - lo || 1;
  const x = (t: number) => P + ((t - t0) / (t1 - t0 || 1)) * (W - 2 * P);
  const y = (v: number) => H - P - ((v - lo) / span) * (H - 2 * P);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`).join('');
  return (
    <div className="stack" style={{ gap: 4 }}>
      <div className="spread small muted">
        <span>{label}</span>
        <span>low {lo.toFixed(1)}{unit} · high {hi.toFixed(1)}{unit}</span>
      </div>
      <svg className="spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${label} over time`}>
        <path d={d} fill="none" stroke="var(--ac)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

export default function DevicePage() {
  const { id } = useParams<{ id: string }>();
  const device = useLoad<Device>(`/devices/${id}`);
  const history = useLoad<HistoryEntry[]>(`/devices/${id}/history?limit=200`);
  useLive('device.state', (e: { id: string }) => {
    if (e.id === id) { void device.reload(); void history.reload(); }
  });

  if (device.error) return <div className="alert">{device.error}</div>;
  const d = device.data;
  if (!d) return <Loader label="Loading device…" />;

  return (
    <>
      <div className="page-head">
        <div>
          <Link href="/" className="details-link">← Home</Link>
          <h1 style={{ marginTop: 6 }}>{d.name}</h1>
          <p className="muted">{d.roomName ?? 'No room'} · {d.typeLabel} · {d.pinLabel} on {d.nodeName}</p>
        </div>
        <span className={`badge ${d.online ? 'ok' : 'bad'}`}>{d.online ? 'Online' : 'Offline'}</span>
      </div>

      {!d.controllable && history.data && (
        <div className="card card-pad stack">
          {d.stateFields.map((f) => <Sparkline key={f.key} entries={history.data!} field={f.key} label={f.label} unit={f.unit} />)}
        </div>
      )}

      <section className="section card card-pad">
        <h2 style={{ marginBottom: 10 }}>History</h2>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>When</th><th>State</th><th>Cause</th></tr></thead>
            <tbody>
              {history.data?.map((h, i) => (
                <tr key={i}>
                  <td className="small">{new Date(h.at).toLocaleString()}</td>
                  <td>{d.controllable ? (h.state.on ? 'On' : 'Off') : d.stateFields.map((f) => `${h.state[f.key] ?? '–'}${f.unit ?? ''}`).join(' · ')}</td>
                  <td className="small muted">{SOURCE[h.source] ?? h.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {history.data?.length === 0 && <p className="muted">Nothing recorded yet.</p>}
        </div>
      </section>
    </>
  );
}

'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { useAction } from '@/components/ui';
import { patch } from '@/lib/api';
import { useLoad } from '@/lib/hooks';
import { useSession } from '@/lib/session';
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

const AUTO_OFF = [0, 15, 30, 60, 90, 120, 180, 240];

/** Owners and admins: child lock and safety auto-off for a switch. */
function Safety({ device, onSaved }: { device: Device; onSaved: () => void }) {
  const { busy, error, run } = useAction();
  const [mins, setMins] = useState(device.autoOffMinutes ?? 0);
  const save = (body: Record<string, unknown>) => run(async () => { await patch(`/devices/${device.id}`, body); onSaved(); });
  const options = AUTO_OFF.includes(mins) ? AUTO_OFF : [...AUTO_OFF, mins].sort((a, b) => a - b);
  return (
    <section className="section card card-pad">
      <h2 style={{ marginBottom: 6 }}>Safety</h2>
      <div className="safety-row">
        <Icon name="lock" size={16} />
        <span className="grow stack-tight"><b>Child lock</b><span className="small muted">Only the owner and admins can switch it — from the app, the assistant or a rule. The wall switch still works.</span></span>
        <label className="switch-input" title="Child lock">
          <input type="checkbox" checked={!!device.childLock} disabled={busy} onChange={(e) => void save({ childLock: e.target.checked })} />
          <span />
        </label>
      </div>
      <div className="safety-row">
        <Icon name="clock" size={16} />
        <span className="grow stack-tight"><b>Switch off by itself</b><span className="small muted">For a geyser, iron or motor: it goes off this long after it was turned on, whoever turned it on.{device.autoOffAt ? ` Next: ${new Date(device.autoOffAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.` : ''}</span></span>
        <select value={mins} disabled={busy} onChange={(e) => { const m = Number(e.target.value); setMins(m); void save({ autoOffMinutes: m || null }); }} aria-label="Auto-off">
          {options.map((m) => <option key={m} value={m}>{m === 0 ? 'Never' : m < 60 ? `After ${m} min` : `After ${m / 60} h`}</option>)}
        </select>
      </div>
      <div className="safety-row">
        <Icon name="zap" size={16} />
        <span className="grow stack-tight"><b>After a power cut</b><span className="small muted">When the electricity comes back, things come back one by one. A motor, iron or geyser is safer staying off. Needs board firmware 2.6.0.</span></span>
        <select value={device.restoreOff ? 'off' : 'last'} disabled={busy} onChange={(e) => void save({ restoreOff: e.target.value === 'off' })} aria-label="After a power cut">
          <option value="last">Comes back as it was</option>
          <option value="off">Stays off</option>
        </select>
      </div>
      {error && <div className="alert">{error}</div>}
    </section>
  );
}

/** Owners and admins: when a water tank's motor starts and stops by itself. */
function TankMotor({ device, onSaved }: { device: Device; onSaved: () => void }) {
  const { busy, error, run } = useAction();
  const s = device.settings as { motorDeviceId?: string; fillBelowPct?: number; stopAtPct?: number };
  const save = (tank: Record<string, number>) => run(async () => { await patch(`/devices/${device.id}`, { tank }); onSaved(); });
  if (!s.motorDeviceId) return null;
  return (
    <section className="section card card-pad">
      <h2 style={{ marginBottom: 6 }}>Water motor</h2>
      <div className="safety-row">
        <Icon name="droplet" size={16} />
        <span className="grow stack-tight"><b>Start the motor by itself</b><span className="small muted">When the tank drops below this level. It won&apos;t start again by itself after it was stopped for running dry or too long.</span></span>
        <select value={s.fillBelowPct ?? 0} disabled={busy} onChange={(e) => void save({ fillBelowPct: Number(e.target.value) })} aria-label="Start below">
          {[0, 20, 30, 40, 50, 60].map((v) => <option key={v} value={v}>{v === 0 ? 'Never' : `Below ${v}%`}</option>)}
        </select>
      </div>
      <div className="safety-row">
        <Icon name="check" size={16} />
        <span className="grow stack-tight"><b>Stop when full</b><span className="small muted">The board stops the motor at this level, even without internet when the motor is on the same board.</span></span>
        <select value={s.stopAtPct ?? 95} disabled={busy} onChange={(e) => void save({ stopAtPct: Number(e.target.value) })} aria-label="Stop at">
          {[80, 85, 90, 95, 100].map((v) => <option key={v} value={v}>At {v}%</option>)}
        </select>
      </div>
      {error && <div className="alert">{error}</div>}
    </section>
  );
}

export default function DevicePage() {
  const { isAdmin, home } = useSession();
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
        <span className="row" style={{ gap: 6 }}>
          {d.childLock && <span className="badge"><Icon name="lock" size={12} /> Child lock</span>}
          <span className={`badge ${d.online ? 'ok' : 'bad'}`}>{d.online ? 'Online' : 'Offline'}</span>
        </span>
      </div>

      {d.controllable && isAdmin && !home?.readOnly && <Safety device={d} onSaved={() => void device.reload()} />}
      {d.type === 'tank' && isAdmin && !home?.readOnly && <TankMotor device={d} onSaved={() => void device.reload()} />}

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

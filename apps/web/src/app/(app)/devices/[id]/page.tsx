'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { useAction } from '@/components/ui';
import { errorText, patch, post } from '@/lib/api';
import { useLoad } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { useLive } from '@/lib/live';
import type { Device, HistoryEntry } from '@/lib/types';
import { Loader, Spinner } from '@/components/Loader';
import { contactText, deviceIcon } from '@/lib/format';
import { timeAgo } from '@/lib/hooks';

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

/** The one big control: a lit power button for a switch, the live reading for a sensor. */
function Hero({ device, isAdmin, onChange }: { device: Device; isAdmin: boolean; onChange: (d: Device) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const on = device.state?.on === true && device.online;
  const locked = !!device.childLock && !isAdmin;
  const canSwitch = device.controllable && device.online && device.access !== 'VIEW' && device.enabled && !locked;
  const why = !device.online ? 'Its board is offline. The wall switch still works.'
    : device.access === 'VIEW' ? 'You can see this device but not switch it.'
      : locked ? 'Child lock is on: only the owner or an admin can switch it.'
        : !device.enabled ? 'This device is turned off in its settings.' : null;

  async function toggle() {
    if (!canSwitch) return;
    setBusy(true);
    setError(null);
    try { onChange(await post<Device>(`/devices/${device.id}/commands`, { on: !(device.state?.on === true) })); }
    catch (err) { setError(errorText(err)); }
    finally { setBusy(false); }
  }

  if (!device.controllable) {
    const first = device.stateFields[0];
    const value = device.type === 'contact' ? contactText(device.settings, device.state?.active)
      : first ? `${typeof device.state?.[first.key] === 'number' ? (device.state[first.key] as number).toFixed(1).replace(/\.0$/, '') : '–'}${first.unit === '°C' ? '°' : first.unit ?? ''}` : '–';
    return (
      <div className="hero-control sensor">
        <span className="hero-reading">{device.online ? value : 'Offline'}</span>
        <span className="hero-sub">
          {device.stateFields.slice(1).map((f) => `${device.state?.[f.key] ?? '–'}${f.unit ?? ''} ${f.label.toLowerCase()}`).join(' · ')}
          {device.updatedAt ? `${device.stateFields.length > 1 ? ' · ' : ''}Updated ${timeAgo(device.updatedAt)}` : ''}
        </span>
      </div>
    );
  }
  return (
    <div className={`hero-control ${on ? 'is-on' : ''} ${!device.online ? 'is-offline' : ''}`}>
      <button className="hero-power" onClick={() => void toggle()} disabled={!canSwitch || busy} aria-pressed={on}
        aria-label={`${device.name} is ${on ? 'on' : 'off'}. ${canSwitch ? `Turn ${on ? 'off' : 'on'}` : why ?? ''}`}>
        {busy ? <Spinner size={28} /> : <Icon name={!device.online ? 'wifi-off' : deviceIcon(device.type, device.settings)} size={40} />}
      </button>
      <span className="hero-state">{!device.online ? 'Offline' : busy ? 'Switching…' : on ? 'On' : 'Off'}</span>
      <span className="hero-sub">{why ?? (canSwitch ? `Tap to turn ${on ? 'off' : 'on'}` : '')}</span>
      {error && <div className="alert">{error}</div>}
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
    <section className="section panel panel-pad">
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
    <div className="device-page">
      <Link href="/" className="back"><Icon name="chevron-left" size={16} />Home</Link>
      <header className="ph">
        <div className="ph-text">
          <h1>{d.name}</h1>
          <p>{d.roomName ?? 'No room'} · {d.typeLabel}</p>
        </div>
        <span className="row" style={{ gap: 6 }}>
          {d.childLock && <span className="badge plain"><Icon name="lock" size={12} /> Child lock</span>}
          <span className={`badge ${d.online ? 'ok' : 'bad'}`}>{d.online ? 'Online' : 'Offline'}</span>
        </span>
      </header>

      <div className="device-top">
        <Hero device={d} isAdmin={isAdmin} onChange={(n) => device.setData(n)} />
        {!d.controllable && history.data && history.data.length > 1 ? (
          <div className="panel panel-pad stack">
            {d.stateFields.map((f) => <Sparkline key={f.key} entries={history.data!} field={f.key} label={f.label} unit={f.unit} />)}
          </div>
        ) : (
          <dl className="panel panel-pad facts device-facts">
            <dt>Room</dt><dd>{d.roomName ?? 'No room'}</dd>
            <dt>Type</dt><dd>{d.typeLabel}</dd>
            <dt>Wired to</dt><dd>{d.pinLabel} on {d.nodeName}</dd>
            {d.watts ? <><dt>Power</dt><dd>{d.watts} W</dd></> : null}
            <dt>Last change</dt><dd>{d.updatedAt ? timeAgo(d.updatedAt) : '–'}{d.source ? ` · ${SOURCE[d.source] ?? d.source}` : ''}</dd>
          </dl>
        )}
      </div>

      {d.controllable && isAdmin && !home?.readOnly && <Safety device={d} onSaved={() => void device.reload()} />}

      <section className="section panel">
        <div className="panel-head"><h2>History</h2></div>
        {history.data?.length === 0 ? <p className="muted panel-pad">Nothing recorded yet.</p> : (
          <div className="table-wrap flush">
            <table className="table">
              <thead><tr><th>When</th><th>State</th><th>Cause</th></tr></thead>
              <tbody>
                {history.data?.map((h, i) => (
                  <tr key={i}>
                    <td className="small">{new Date(h.at).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</td>
                    <td>{d.controllable ? (h.state.on ? 'On' : 'Off') : d.stateFields.map((f) => `${h.state[f.key] ?? '–'}${f.unit ?? ''}`).join(' · ')}</td>
                    <td className="small muted">{SOURCE[h.source] ?? h.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

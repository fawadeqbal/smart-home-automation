'use client';
import { useEffect, useState } from 'react';
import { get } from '@/lib/api';
import { useLive } from '@/lib/live';

interface Point { at: string; rssi: number | null; vcc: number | null; heap: number | null }

/** A small line chart with a shaded "good" band, min/max labels and a hover read-out. */
function Line({ title, unit, points, good, fmt }: {
  title: string; unit: string; points: { t: number; v: number }[]; good: [number, number]; fmt: (v: number) => string;
}) {
  const [hover, setHover] = useState<{ t: number; v: number } | null>(null);
  const W = 300, H = 90;
  if (points.length < 2) {
    return <div className="hchart"><div className="spread"><span className="stat-label">{title}</span></div><p className="muted small">Not enough data yet — a point is stored every minute.</p></div>;
  }
  const vs = points.map((p) => p.v);
  const lo = Math.min(...vs, good[0]), hi = Math.max(...vs, good[1]);
  const pad = (hi - lo) * 0.1 || 1;
  const y0 = lo - pad, y1 = hi + pad;
  const t0 = points[0]!.t, t1 = points[points.length - 1]!.t;
  const x = (t: number) => ((t - t0) / (t1 - t0 || 1)) * W;
  const y = (v: number) => H - ((v - y0) / (y1 - y0)) * H;
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const last = points[points.length - 1]!;
  const shown = hover ?? last;
  const bad = shown.v < good[0] || shown.v > good[1];
  return (
    <div className="hchart">
      <div className="spread">
        <span className="stat-label">{title}</span>
        <span className={`hchart-now ${bad ? 'text-bad' : ''}`}>{fmt(shown.v)}{unit}{hover && <span className="muted small"> · {new Date(hover.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="hchart-svg" role="img" aria-label={`${title} over time`}
           onMouseMove={(e) => {
             const r = e.currentTarget.getBoundingClientRect();
             const t = t0 + ((e.clientX - r.left) / r.width) * (t1 - t0);
             setHover(points.reduce((a, b) => (Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a)));
           }}
           onMouseLeave={() => setHover(null)}>
        <rect x="0" width={W} y={y(good[1])} height={Math.max(0, y(good[0]) - y(good[1]))} className="hchart-band" />
        <path d={d} className="hchart-line" vectorEffect="non-scaling-stroke" />
        {hover && <circle cx={x(hover.t)} cy={y(hover.v)} r="3.5" className="hchart-dot" vectorEffect="non-scaling-stroke" />}
      </svg>
      <div className="chart-axis"><span>min {fmt(Math.min(...vs))}{unit}</span><span>max {fmt(Math.max(...vs))}{unit}</span></div>
    </div>
  );
}

const RANGES = [{ h: 6, label: '6 h' }, { h: 24, label: '24 h' }, { h: 168, label: '7 days' }];

export function HealthCharts({ nodeId }: { nodeId: string }) {
  const [hours, setHours] = useState(24);
  const [data, setData] = useState<Point[] | null>(null);
  const load = () => get<Point[]>(`/nodes/${nodeId}/health-history?hours=${hours}`).then(setData).catch(() => setData([]));
  useEffect(() => { void load(); }, [nodeId, hours]); // eslint-disable-line react-hooks/exhaustive-deps
  useLive('node.health', (e: { nodeId: string }) => { if (e.nodeId === nodeId) void load(); });

  const series = (k: 'rssi' | 'vcc' | 'heap', scale = 1) =>
    (data ?? []).filter((p) => p[k] !== null).map((p) => ({ t: new Date(p.at).getTime(), v: (p[k] as number) / scale }));

  return (
    <div className="stack">
      <div className="spread">
        <h3 className="sub-head" style={{ margin: 0 }}>History</h3>
        <div className="seg" role="group" aria-label="Time range">
          {RANGES.map((r) => <button key={r.h} type="button" className={hours === r.h ? 'on' : ''} onClick={() => setHours(r.h)}>{r.label}</button>)}
        </div>
      </div>
      {!data ? <p className="muted small">Loading…</p> : (
        <div className="hchart-grid">
          <Line title="Supply voltage" unit=" V" points={series('vcc', 1000)} good={[3.0, 3.6]} fmt={(v) => v.toFixed(2)} />
          <Line title="Wi‑Fi signal" unit=" dBm" points={series('rssi')} good={[-75, -30]} fmt={(v) => v.toFixed(0)} />
          <Line title="Free memory" unit=" KB" points={series('heap', 1024)} good={[10, 80]} fmt={(v) => v.toFixed(1)} />
        </div>
      )}
    </div>
  );
}

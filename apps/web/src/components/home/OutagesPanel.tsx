'use client';
import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { Loader } from '@/components/Loader';
import { ErrorBox, Kpi, Seg } from '@/components/ui';
import { useLoad } from '@/lib/hooks';
import { clock, dayLabel, dur, mergeOutages, OUTAGE_LOOK } from '@/lib/outages';
import type { HomeOutages } from '@/lib/types';

/**
 * Power cuts and Wi-Fi / internet outages in this home, worked out from what the boards report when
 * they come back: a board that restarted with "Power On" lost power; one that stayed on lost the internet.
 */
export function OutagesPanel() {
  const [days, setDays] = useState<'7' | '30' | '90'>('30');
  const { data, error } = useLoad<HomeOutages>(`/outages?days=${days}`);
  if (!data) return error ? <ErrorBox error={error} /> : <Loader label="Loading power cuts…" />;
  const tz = data.timezone || 'Asia/Karachi';
  const items = mergeOutages(data.outages);
  const s = data.summary;
  const byDay: [string, typeof items][] = [];
  for (const it of items) {
    const d = dayLabel(it.startedAt, tz);
    const g = byDay.find(([k]) => k === d);
    if (g) g[1].push(it); else byDay.push([d, [it]]);
  }
  return (
    <section className="stack" id="outages" style={{ gap: 12 }}>
      <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
        <div className="grow stack-tight">
          <b style={{ fontSize: 16 }}>Power cuts and internet</b>
          <span className="small muted">From the grid sensor if the home has one (to the minute), otherwise from what the boards report when they come back: a restart with “Power On” means the power was off.</span>
        </div>
        <Seg options={[{ id: '7', label: '7 days' }, { id: '30', label: '30 days' }, { id: '90', label: '90 days' }]} value={days} onChange={setDays} />
      </div>
      <div className="kpis k4">
        <Kpi label="Power cuts" value={s.powerCuts} chip={{ icon: 'zap', tone: s.powerCuts ? 'bad' : 'ok' }} small />
        <Kpi label="Without power" value={s.powerSeconds ? dur(s.powerSeconds) : '–'} chip={{ icon: 'clock', tone: 'mute' }} small />
        <Kpi label="Internet down" value={s.networkOuts} sub={s.networkSeconds ? dur(s.networkSeconds) : undefined} chip={{ icon: 'wifi-off', tone: s.networkOuts ? 'on' : 'ok' }} small />
        <Kpi label="Board restarts" value={s.restarts + s.crashes} sub={s.crashes ? `${s.crashes} after a fault` : undefined} chip={{ icon: 'rotate', tone: s.crashes ? 'on' : 'mute' }} small />
      </div>
      {items.length === 0 ? (
        <div className="card card-pad muted">No power cuts or internet outages in the last {days} days.</div>
      ) : (
        <div className="card outage-list">
          {byDay.map(([day, list]) => (
            <div key={day}>
              <div className="outage-day">{day}</div>
              {list.map((o) => {
                const look = OUTAGE_LOOK[o.kind];
                return (
                  <div key={o.startedAt + o.kind} className="outage-row">
                    <span className={`outage-ic t-${look.tone}`}><Icon name={look.icon} size={15} /></span>
                    <span className="grow stack-tight" style={{ minWidth: 0 }}>
                      <b>{look.short}</b>
                      <span className="small muted truncate">{o.boards.join(', ')}{o.kind === 'CRASH' && o.reset ? ` · “${o.reset}”` : ''}</span>
                    </span>
                    <span className="stack-tight" style={{ textAlign: 'right' }}>
                      <span className="nowrap">{clock(o.startedAt, tz)} – {clock(o.endedAt, tz)}</span>
                      <span className="small muted">{dur(o.seconds)}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** On the home page: the last power cut this week, for everyone in the home. */
export function PowerCard({ link }: { link: boolean }) {
  const { data } = useLoad<HomeOutages>('/outages?days=7');
  const last = data?.summary.lastPower;
  if (!data || !last) return null;
  const tz = data.timezone || 'Asia/Karachi';
  const body = (
    <>
      <span className="outage-ic t-bad"><Icon name="zap" size={15} /></span>
      <span className="grow stack-tight" style={{ minWidth: 0 }}>
        <b>Last power cut: {dayLabel(last.startedAt, tz).toLowerCase()} {clock(last.startedAt, tz)} – {clock(last.endedAt, tz)}</b>
        <span className="small muted">{dur(last.seconds)} · this week {data.summary.powerCuts} cut{data.summary.powerCuts === 1 ? '' : 's'}, {dur(data.summary.powerSeconds)} without power</span>
      </span>
      {link && <Icon name="chevron-right" size={16} />}
    </>
  );
  return link ? <a className="power-card card" href="/diagnostics#outages">{body}</a> : <div className="power-card card">{body}</div>;
}

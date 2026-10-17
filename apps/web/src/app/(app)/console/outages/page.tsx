'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { Loader } from '@/components/Loader';
import { useCrumbs } from '@/components/Shell';
import { Empty, ErrorBox, Kpi, PageHead, Seg } from '@/components/ui';
import { timeAgo, useLoad } from '@/lib/hooks';
import { clock, dayLabel, dur, mergeOutages, OUTAGE_LOOK } from '@/lib/outages';
import type { StaffOutages } from '@/lib/types';

const TZ = 'Asia/Karachi';

/** Power cuts and outages across the homes this person looks after: boards down now, area cuts, per home. */
export default function OutagesPage() {
  useCrumbs([{ label: 'Platform', href: '/console' }, { label: 'Power & outages' }]);
  const [days, setDays] = useState<'1' | '7' | '30'>('7');
  const { data, error } = useLoad<StaffOutages>(`/platform/outages?days=${days}`);
  if (!data) return error ? <ErrorBox error={error} /> : <Loader label="Loading outages…" />;
  const power = data.homes.reduce((s, h) => s + h.power, 0);
  // one entry per cut per home, however many of its boards saw it
  const homesOf = [...new Set(data.outages.map((o) => o.homeId))];
  const latest = homesOf.flatMap((id) => {
    const list = data.outages.filter((o) => o.homeId === id);
    return mergeOutages(list).map((m) => ({ ...m, home: list[0]!.home, homeId: id }));
  }).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const long = data.down.filter((d) => d.since && Date.now() - new Date(d.since).getTime() > 3_600_000);
  return (
    <div data-screen-label="Outages" className="stack" style={{ gap: 18 }}>
      <PageHead title="Power & outages"
        sub="Worked out from what boards report when they come back: a restart with “Power On” is a power cut; a board that stayed on lost its Wi‑Fi or internet."
        actions={<Seg options={[{ id: '1', label: 'Today' }, { id: '7', label: '7 days' }, { id: '30', label: '30 days' }]} value={days} onChange={setDays} />} />

      <div className="kpis k4" style={{ marginBottom: 0 }}>
        <Kpi label="Boards offline now" value={data.down.length} sub={long.length ? `${long.length} for over an hour` : undefined} chip={{ icon: 'wifi-off', tone: data.down.length ? 'bad' : 'ok' }} small />
        <Kpi label="Power cuts" value={power} sub={`${data.homes.filter((h) => h.power).length} homes`} chip={{ icon: 'zap', tone: power ? 'on' : 'ok' }} small />
        <Kpi label="Area cuts" value={data.areas.length} sub="2+ homes, one place" chip={{ icon: 'map-pin', tone: data.areas.length ? 'on' : 'ok' }} small />
        <Kpi label="Board faults" value={data.homes.reduce((s, h) => s + h.crashes, 0)} chip={{ icon: 'alert-triangle', tone: data.homes.some((h) => h.crashes) ? 'bad' : 'ok' }} small />
      </div>

      <section className="stack" style={{ gap: 8 }}>
        <b>Offline now</b>
        {data.down.length === 0 ? <div className="card card-pad muted">Every board is online.</div> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Home</th><th>Board</th><th>Place</th><th>Offline since</th></tr></thead>
              <tbody>
                {data.down.map((d) => {
                  const hours = d.since ? (Date.now() - new Date(d.since).getTime()) / 3_600_000 : 0;
                  return (
                    <tr key={d.boardId}>
                      <td><Link href={`/console/homes/${d.homeId}`}><b>{d.home}</b></Link></td>
                      <td>{d.board}</td>
                      <td className="muted">{d.place?.split(',')[0] ?? '—'}</td>
                      <td className={hours >= 1 ? 'fg-bad' : ''}>{d.since ? `${timeAgo(d.since)}` : 'unknown'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {data.areas.length > 0 && (
        <section className="stack" style={{ gap: 8 }}>
          <b>Area power cuts <span className="small muted" style={{ fontWeight: 400 }}>· two or more homes in one place at the same time: probably load-shedding</span></b>
          <div className="card outage-list">
            {data.areas.map((a) => (
              <div key={a.place + a.startedAt} className="outage-row">
                <span className="outage-ic t-bad"><Icon name="map-pin" size={15} /></span>
                <span className="grow stack-tight" style={{ minWidth: 0 }}>
                  <b>{a.place.split(',')[0]}</b>
                  <span className="small muted truncate">{a.homes.join(', ')}</span>
                </span>
                <span className="stack-tight" style={{ textAlign: 'right' }}>
                  <span className="nowrap">{dayLabel(a.startedAt, TZ)} {clock(a.startedAt, TZ)} – {clock(a.endedAt, TZ)}</span>
                  <span className="small muted">{dur(a.seconds)}</span>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="stack" style={{ gap: 8 }}>
        <b>By home</b>
        {data.homes.length === 0 ? <Empty>No outages in this time.</Empty> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Home</th><th>Power cuts</th><th>Without power</th><th>Internet down</th><th>Faults</th></tr></thead>
              <tbody>
                {data.homes.map((h) => (
                  <tr key={h.homeId}>
                    <td><Link href={`/console/homes/${h.homeId}`}><b>{h.home}</b></Link></td>
                    <td>{h.power || '–'}</td>
                    <td>{h.powerSeconds ? dur(h.powerSeconds) : '–'}</td>
                    <td>{h.network ? `${h.network} · ${dur(h.networkSeconds)}` : '–'}</td>
                    <td className={h.crashes ? 'fg-bad' : ''}>{h.crashes || '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {latest.length > 0 && (
        <section className="stack" style={{ gap: 8 }}>
          <b>Latest</b>
          <div className="card outage-list">
            {latest.slice(0, 40).map((o) => {
              const look = OUTAGE_LOOK[o.kind];
              return (
                <div key={o.homeId + o.startedAt + o.kind} className="outage-row">
                  <span className={`outage-ic t-${look.tone}`}><Icon name={look.icon} size={15} /></span>
                  <span className="grow stack-tight" style={{ minWidth: 0 }}>
                    <b>{look.short}</b>
                    <span className="small muted truncate">{o.home} · {o.boards.join(', ')}{o.reset && o.kind === 'CRASH' ? ` · “${o.reset}”` : ''}</span>
                  </span>
                  <span className="stack-tight" style={{ textAlign: 'right' }}>
                    <span className="nowrap">{dayLabel(o.startedAt, TZ)} {clock(o.startedAt, TZ)}</span>
                    <span className="small muted">{dur(o.seconds)}</span>
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

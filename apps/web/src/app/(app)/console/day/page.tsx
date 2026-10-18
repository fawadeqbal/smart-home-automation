'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Icon } from '@/components/Icon';
import { Loader } from '@/components/Loader';
import { useCrumbs } from '@/components/Shell';
import { Badge, Empty, ErrorBox, MessageButton, PageHead } from '@/components/ui';
import { useLoad } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import type { DayJob, InstallerDay } from '@/lib/types';
import { MESSAGES } from '@/lib/whatsapp';
import '@/components/service/service.css';

const JOB: Record<DayJob['type'], { icon: string; tone: 'info' | 'warn' | 'ok' }> = {
  visit: { icon: 'phone', tone: 'info' }, install: { icon: 'wrench', tone: 'ok' }, ticket: { icon: 'message', tone: 'warn' },
};
const todayPk = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi' }).format(new Date());
const shift = (day: string, by: number) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + by); return d.toISOString().slice(0, 10); };
const longDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

/** An installer's day: booked visits, homes being installed and their open tickets, in a driving order. */
export default function MyDayPage() {
  const { staffRole } = useSession();
  const router = useRouter();
  const params = useSearchParams();
  const date = params.get('date') || todayPk();
  const who = params.get('installer') ?? '';
  const d = useLoad<InstallerDay>(`/platform/day?date=${date}${who ? `&installerId=${who}` : ''}`);
  useCrumbs([{ label: 'Platform', href: staffRole === 'INSTALLER' ? '/console/homes' : '/console' }, { label: 'My day' }]);
  const go = (next: { date?: string; installer?: string }) => {
    const q = new URLSearchParams({ date: next.date ?? date, ...(next.installer ?? who ? { installer: next.installer ?? who } : {}) });
    router.replace(`/console/day?${q.toString()}`, { scroll: false });
  };
  const isToday = date === todayPk();
  const mine = staffRole === 'INSTALLER';

  return (
    <div data-screen-label="My day">
      <PageHead eyebrow="Field" title={mine ? 'My day' : `${d.data?.installer?.name ?? 'Installer'}’s day`}
                sub={`${longDay(date)}. Visits booked for this day, homes being installed and open tickets, nearest first.`} />
      <div className="day-head mb16">
        <button className="btn btn-sm" onClick={() => go({ date: shift(date, -1) })} aria-label="Day before"><Icon name="chevron-left" size={15} /></button>
        <input type="date" className="day-date" value={date} onChange={(e) => e.target.value && go({ date: e.target.value })} aria-label="Day" />
        <button className="btn btn-sm" onClick={() => go({ date: shift(date, 1) })} aria-label="Day after"><Icon name="chevron-right" size={15} /></button>
        {!isToday && <button className="btn btn-sm btn-ghost" onClick={() => go({ date: todayPk() })}>Today</button>}
        {!mine && d.data && d.data.installers.length > 0 && (
          <select value={d.data.installer?.id ?? ''} onChange={(e) => go({ installer: e.target.value })} aria-label="Installer">
            {d.data.installers.map((i) => <option key={i.id} value={i.id}>{i.name}{i.staffRole === 'SUPERADMIN' ? ' (super admin)' : ''}</option>)}
          </select>
        )}
        <span className="grow hide-sm" />
        {d.data?.mapsUrl && (
          <a className="btn btn-primary" href={d.data.mapsUrl} target="_blank" rel="noreferrer"><Icon name="map-pin" size={15} />Open route in Google Maps</a>
        )}
      </div>

      {!d.data ? (d.error ? <ErrorBox error={d.error} /> : <Loader label="Planning the day…" />) : (
        <>
          {!d.data.baseSet && (
            <div className="notice mb16">
              The route starts from the first stop because your base isn’t set.{staffRole === 'SUPERADMIN' ? <> Add it in <Link href="/console/settings">Company settings</Link>.</> : ' A super admin can add it in Company settings.'}
            </div>
          )}
          {d.data.stops.length === 0 ? (
            <Empty>Nothing for {isToday ? 'today' : 'this day'}. Visits booked for {mine ? 'you' : 'them'}, homes {mine ? 'you are' : 'they are'} installing and open tickets {mine ? 'you hold' : 'they hold'} show here.</Empty>
          ) : (
            <div className="day-stops">
              <span className="small muted">
                {d.data.stops.length} stop{d.data.stops.length === 1 ? '' : 's'}{d.data.totalKm ? ` · about ${d.data.totalKm} km in a straight line (roads are longer)` : ''}
                {d.data.stops.some((s) => !s.located) ? ' · stops without a location are last, by city' : ''}
              </span>
              {d.data.stops.map((s) => (
                <div key={s.key} style={{ display: 'contents' }}>
                  {s.legKm !== null && <div className="day-leg">{s.n === 1 && d.data!.baseSet ? 'From the base' : 'Then'} · {s.legKm} km</div>}
                  <section className={`day-stop ${s.located ? '' : 'no-pin'}`}>
                    <span className="day-n" aria-label={`Stop ${s.n}`}>{s.n}</span>
                    <div style={{ minWidth: 0 }}>
                      <div className="spread" style={{ gap: 8, flexWrap: 'wrap' }}>
                        <span className="stack-tight">
                          {s.homeId ? <Link href={`/console/homes/${s.homeId}`}><b>{s.name}</b></Link> : <b>{s.name}</b>}
                          <span className="small muted">{s.city || 'No city'}{s.located ? '' : ' · no location set'}</span>
                        </span>
                        {s.kind === 'visit' && <Badge tone="info">New customer</Badge>}
                      </div>
                      <ul className="day-jobs">
                        {s.jobs.map((j, i) => (
                          <li key={i}>
                            <Badge tone={JOB[j.type].tone} plain><Icon name={JOB[j.type].icon} size={12} /></Badge>
                            <Link href={j.link} className="stack-tight"><b>{j.title}</b><span className="small muted">{j.detail}</span></Link>
                          </li>
                        ))}
                      </ul>
                      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                        {s.directions && <a className="btn btn-sm" href={s.directions} target="_blank" rel="noreferrer"><Icon name="map-pin" size={14} />Directions</a>}
                        {s.phone && <a className="btn btn-sm" href={`tel:${s.phone.replace(/[^\d+]/g, '')}`}><Icon name="phone" size={14} />Call</a>}
                        {s.whatsapp && <MessageButton small label="On my way" whatsapp={s.whatsapp} text={MESSAGES.onMyWay(d.data!.installer?.name)} />}
                        {s.homeId && s.jobs.some((j) => j.type === 'install') && <Link className="btn btn-sm btn-primary" href={`/console/homes/${s.homeId}?tab=installation`}><Icon name="check" size={14} />Checklist</Link>}
                      </div>
                    </div>
                  </section>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

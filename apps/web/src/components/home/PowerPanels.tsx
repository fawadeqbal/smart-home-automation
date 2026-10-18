'use client';
import { FormEvent, useState } from 'react';
import { Icon } from '@/components/Icon';
import { Loader } from '@/components/Loader';
import { ErrorBox, FormModal, Kpi, Modal, useAction } from '@/components/ui';
import { del, patch, post, put } from '@/lib/api';
import { useLoad } from '@/lib/hooks';
import { useLive } from '@/lib/live';
import type { Bill, CutWindow, GridSettings, MeterReading, PowerStatus, Shedding, Slab } from '@/lib/types';

const rs = (n: number) => `Rs ${Math.round(n).toLocaleString('en-PK')}`;
const units = (n: number) => (n < 10 ? n.toFixed(1) : Math.round(n).toLocaleString('en-PK'));
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** "14:00" as "2:00 pm" */
const ampm = (t: string) => { const [h, m] = t.split(':').map(Number); return `${h! % 12 || 12}:${String(m).padStart(2, '0')} ${h! < 12 ? 'am' : 'pm'}`; };
const dayDate = (iso: string, tz: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: tz });

/** On the home page (everyone): "On UPS since 2:03 pm" while the grid is off, and the next expected cut. */
export function PowerStatusCard() {
  const p = useLoad<PowerStatus>('/power');
  useLive('power.changed', () => void p.reload());
  const s = p.data;
  if (!s || (!s.grid.off && !s.next)) return null;
  if (s.grid.off) {
    return (
      <a className="power-card card ups-card" href="/energy#power">
        <span className="outage-ic t-warn"><Icon name="battery" size={15} /></span>
        <span className="grow stack-tight" style={{ minWidth: 0 }}>
          <b>On UPS/solar since {s.grid.sinceText}</b>
          <span className="small muted">The grid power is off.{s.grid.switchedOff.length ? ` Switched off to save the battery: ${s.grid.switchedOff.join(', ')}.` : ' Go easy on the AC, iron and geyser.'}</span>
        </span>
        <Icon name="chevron-right" size={16} />
      </a>
    );
  }
  return (
    <a className="power-card card" href="/energy#power">
      <span className="outage-ic t-info"><Icon name="clock" size={15} /></span>
      <span className="grow stack-tight" style={{ minWidth: 0 }}>
        <b>{s.next!.now ? `Load-shedding time: ${s.next!.text}` : `Next expected cut: ${s.next!.text}`}</b>
        <span className="small muted">{s.source === 'typed' ? 'From your area’s schedule' : 'From the power cuts of the last two weeks — usually, not always'}</span>
      </span>
      <Icon name="chevron-right" size={16} />
    </a>
  );
}

/** The day as 48 half hours: darker where the power went on more of the last 14 days; the windows marked. */
export function DayStrip({ slots, windows }: { slots: number[]; windows: CutWindow[] }) {
  const max = Math.max(1, ...slots);
  const inWindow = (i: number) => windows.some((w) => {
    const [fh, fm] = w.from.split(':').map(Number); const [th, tm] = w.to.split(':').map(Number);
    const a = fh! * 60 + fm!; let b = th! * 60 + tm!; if (b <= a) b += 1440;
    const m = i * 30; return (m >= a && m < b) || (m + 1440 >= a && m + 1440 < b);
  });
  return (
    <div className="day-strip" role="img" aria-label={windows.length ? `Cuts usually at ${windows.map((w) => `${w.from} to ${w.to}`).join(', ')}` : 'No regular cut times'}>
      <div className="ds-bar">
        {slots.map((n, i) => (
          <span key={i} className={`ds-slot ${inWindow(i) ? 'win' : ''}`} style={{ opacity: n ? 0.25 + 0.75 * (n / max) : 1 }}
                title={`${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'} — a cut on ${n} of 14 days`} data-n={n} />
        ))}
      </div>
      <div className="ds-labels"><span>12 am</span><span>6 am</span><span>12 pm</span><span>6 pm</span><span>12 am</span></div>
    </div>
  );
}

/** Load-shedding: the next cut, the pattern as a day strip, and the area's schedule typed by the owner. */
export function SheddingPanel({ canEdit }: { canEdit: boolean }) {
  const shed = useLoad<Shedding>('/power/shedding');
  const [editing, setEditing] = useState(false);
  useLive('power.changed', () => void shed.reload());
  const s = shed.data;
  if (!s) return shed.error ? <ErrorBox error={shed.error} /> : <Loader label="Looking at the power cuts…" />;
  const learned = s.learned;
  const shown = s.source === 'typed' ? s.typed : learned.windows;
  return (
    <section className="section card card-pad stack" id="power">
      <div className="spread">
        <h2>Load-shedding times</h2>
        {canEdit && <button className="btn btn-sm" onClick={() => setEditing(true)}><Icon name="pencil" size={14} />{s.typed.length ? 'Change our schedule' : 'Type our schedule'}</button>}
      </div>
      <p className="muted" style={{ margin: 0 }}>
        {s.next ? <><b className="text-ink">{s.next.now ? `Load-shedding time now, until about ${new Date(s.next.until).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: s.timezone })}` : `Next expected cut: ${s.next.text}`}</b>. </> : 'No regular cut time yet. '}
        {s.source === 'typed' ? 'From the schedule you typed in (it’s used instead of the learned one).'
          : s.source === 'area' ? `Learned from other homes in ${learned.place ?? 'your area'}: this home has too few days of its own yet.`
            : s.source === 'learned' ? `Learned from the power cuts of the last ${learned.observedDays} days: a time counts when the power went then on at least ${learned.needed} of them.`
              : `A time shows up here once the power goes at about the same time on ${learned.needed} or more of the last ${learned.observedDays} days.`}
      </p>
      <DayStrip slots={learned.slots} windows={shown} />
      {shown.length > 0 && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {shown.map((w, i) => (
            <span key={i} className="badge info">{ampm(w.from)} – {ampm(w.to)}{w.days?.length ? ` · ${w.days.map((d) => DAYS[d]).join(', ')}` : ''}{w.seen !== undefined ? ` · ${w.seen} of ${w.of} days` : ''}</span>
          ))}
        </div>
      )}
      <p className="small muted" style={{ margin: 0 }}>Want a heads-up 15 minutes before? Turn on “Load-shedding is due” in <a href="/notifications">notification settings</a>.</p>
      {editing && <ScheduleEditor current={s.typed.length ? s.typed : learned.windows} typed={s.typed.length > 0} onClose={() => setEditing(false)} onSaved={(n) => shed.setData(n)} />}
    </section>
  );
}

function ScheduleEditor({ current, typed, onClose, onSaved }: { current: CutWindow[]; typed: boolean; onClose: () => void; onSaved: (s: Shedding) => void }) {
  const [rows, setRows] = useState<CutWindow[]>(current.length ? current.map((w) => ({ from: w.from, to: w.to, days: w.days ?? [] })) : [{ from: '14:00', to: '15:00', days: [] }]);
  const { busy, error, run } = useAction();
  const set = (i: number, w: Partial<CutWindow>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...w } : x)));
  const save = (windows: CutWindow[]) => run(async () => { onSaved(await put<Shedding>('/power/shedding', { windows })); onClose(); });
  return (
    <Modal title="Your area’s load-shedding schedule" sub="Type the times from your electricity company’s SMS. Leave the days empty for every day." onClose={onClose}
           footer={<>
             {typed && <button className="btn" disabled={busy} onClick={() => void save([])}>Use the learned times</button>}
             <button className="btn" onClick={onClose}>Cancel</button>
             <button className="btn btn-primary" disabled={busy} onClick={() => void save(rows.map((r) => ({ from: r.from, to: r.to, ...(r.days?.length ? { days: r.days } : {}) })))}>Save</button>
           </>}>
      <div className="dialog-body stack">
        {rows.map((r, i) => (
          <div key={i} className="subtle-box stack-tight">
            <div className="row" style={{ gap: 8 }}>
              <input type="time" value={r.from} onChange={(e) => set(i, { from: e.target.value })} aria-label="From" required />
              <span className="muted">to</span>
              <input type="time" value={r.to} onChange={(e) => set(i, { to: e.target.value })} aria-label="To" required />
              <span className="grow" />
              <button type="button" className="icon-btn" aria-label="Remove" onClick={() => setRows((x) => x.filter((_, j) => j !== i))}><Icon name="trash" size={14} /></button>
            </div>
            <div className="light-chips">
              {DAYS.map((d, n) => (
                <button key={d} type="button" className={r.days?.includes(n) ? 'on' : ''}
                        onClick={() => set(i, { days: r.days?.includes(n) ? r.days.filter((x) => x !== n) : [...(r.days ?? []), n] })}>{d}</button>
              ))}
            </div>
          </div>
        ))}
        {rows.length < 8 && <button type="button" className="btn btn-sm" onClick={() => setRows((r) => [...r, { from: '20:00', to: '21:00', days: [] }])}><Icon name="plus" size={14} />Add a time</button>}
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}

/** UPS mode: the grid sensor, which heavy loads go off when the grid goes, and whether they come back on. */
export function UpsPanel({ canEdit }: { canEdit: boolean }) {
  const g = useLoad<GridSettings>('/power/grid');
  const [picking, setPicking] = useState(false);
  useLive('power.changed', () => void g.reload());
  const d = g.data;
  if (!d) return g.error ? <ErrorBox error={g.error} /> : null;
  const names = new Map(d.switches.map((s) => [s.id, s.name]));
  const loads = d.loads.map((id) => names.get(id)).filter(Boolean);
  return (
    <section className="section card card-pad stack">
      <div className="spread">
        <h2>UPS mode</h2>
        {d.sensor && canEdit && <button className="btn btn-sm" onClick={() => setPicking(true)}>Heavy loads</button>}
      </div>
      {!d.sensor ? (
        <p className="muted" style={{ margin: 0 }}>Ask your installer for a grid sensor: then the app knows when you’re on UPS or solar, switches heavy things off to save the battery, and records each cut to the minute.</p>
      ) : (
        <>
          <p style={{ margin: 0 }}>
            {d.off ? <b>On UPS or solar since {new Date(d.since!).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true })}.</b> : <b>The grid power is on.</b>}{' '}
            <span className="muted">From {d.sensor.name}.</span>
          </p>
          <p className="small muted" style={{ margin: 0 }}>
            {loads.length ? `When the grid goes: ${loads.join(', ')} switch off. When it comes back: ${d.restore ? 'they go back on' : 'they stay off'}. While on UPS, switching them on asks first.`
              : 'Pick heavy loads (AC, iron, geyser, motor, kettle) to switch off by themselves when the grid goes.'}
          </p>
        </>
      )}
      {picking && <LoadPicker grid={d} onClose={() => setPicking(false)} onSaved={(n) => g.setData(n)} />}
    </section>
  );
}

function LoadPicker({ grid, onClose, onSaved }: { grid: GridSettings; onClose: () => void; onSaved: (g: GridSettings) => void }) {
  const [picked, setPicked] = useState<string[]>(grid.loads.length ? grid.loads : grid.switches.filter((s) => s.heavy).map((s) => s.id));
  const [restore, setRestore] = useState(grid.restore);
  const { busy, error, run } = useAction();
  const save = () => run(async () => { onSaved(await put<GridSettings>('/power/grid', { loads: picked, restore })); onClose(); });
  const sorted = [...grid.switches].sort((a, b) => Number(b.heavy) - Number(a.heavy));
  return (
    <Modal title="When the grid goes" sub="Switch off these heavy loads, so the UPS battery lasts. Suggested from their names and power." onClose={onClose}
           footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={() => void save()}>Save</button></>}>
      <div className="dialog-body stack">
        <div className="light-chips">
          {sorted.map((s) => (
            <button key={s.id} type="button" className={picked.includes(s.id) ? 'on' : ''}
                    onClick={() => setPicked((v) => (v.includes(s.id) ? v.filter((x) => x !== s.id) : [...v, s.id]))}>
              {s.name}{s.room ? <span className="muted"> · {s.room}</span> : null}{s.heavy ? <span className="muted"> · heavy</span> : null}
            </button>
          ))}
        </div>
        <label className="field">When the grid comes back
          <select value={restore ? 'on' : ''} onChange={(e) => setRestore(e.target.value === 'on')}>
            <option value="">Leave them off</option>
            <option value="on">Switch them back on (only the ones that were on)</option>
          </select>
        </label>
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}

/** The bill this month from the meter readings: units, where it's heading, the cost, the protected limit, readings. */
export function BillPanel({ canEdit }: { canEdit: boolean }) {
  const bill = useLoad<Bill>('/power/bill');
  const readings = useLoad<MeterReading[]>('/power/readings');
  const [dialog, setDialog] = useState<'reading' | 'settings' | MeterReading | null>(null);
  const [showAll, setShowAll] = useState(false);
  const reload = () => { void bill.reload(); void readings.reload(); };
  useLive('power.changed', reload);
  const b = bill.data;
  if (!b) return bill.error ? <ErrorBox error={bill.error} /> : <Loader label="Adding up the bill…" />;
  const tz = b.timezone;
  const limit = b.protectedLimit;
  const pct = limit ? Math.min(100, (b.units / limit) * 100) : 0;
  const pctEnd = limit && b.projected ? Math.min(100, (b.projected / limit) * 100) : 0;
  const list = readings.data ?? [];
  return (
    <section className="section card card-pad stack" id="bill">
      <div className="spread">
        <h2>Bill this month</h2>
        {canEdit && (
          <div className="row" style={{ gap: 6 }}>
            <button className="btn btn-sm btn-primary" onClick={() => setDialog('reading')}><Icon name="plus" size={14} />Add a reading</button>
            <button className="btn btn-sm" onClick={() => setDialog('settings')}>Billing day & rates</button>
          </div>
        )}
      </div>
      <p className="muted" style={{ margin: 0 }}>From {dayDate(b.cycle.start, tz)} (billing day: the {b.billingDayText}) to {dayDate(b.cycle.end, tz)} · {b.cycle.daysLeft} days to go.</p>
      <div className={`bill-msg ${b.over || b.heading ? 'warn' : ''}`}>{b.message}</div>
      <div className="kpis k3" style={{ marginBottom: 0 }}>
        <Kpi label="Units so far" value={units(b.units)} unit="kWh" chip={{ icon: 'zap', tone: 'on' }}
             sub={b.source === 'readings' ? `meter: ${b.latest ? `${units(b.latest.kwh)} on ${dayDate(b.latest.readAt, tz)}` : ''}` : b.source === 'readings+estimate' ? `${units(b.estimated)} of them estimated` : b.source === 'estimate' ? 'estimate — add a reading' : 'no reading yet'} />
        <Kpi label="By the billing day" value={b.projected !== null ? `~${Math.round(b.projected)}` : '–'} unit="units" chip={{ icon: 'activity', tone: b.heading ? 'bad' : 'ok' }} sub="at this pace" />
        <Kpi label="Bill" value={rs(b.cost.projected ?? b.cost.soFar)} chip={{ icon: 'wallet', tone: 'ac' }} sub={b.cost.projected !== null ? `so far ${rs(b.cost.soFar)}` : 'so far'} />
      </div>
      {limit && (
        <div className="stack-tight">
          <div className="limit-bar" role="img" aria-label={`${Math.round(b.units)} of ${limit} units`}>
            <span className="lb-end" style={{ width: `${pctEnd}%` }} /><span className={`lb-now ${b.over ? 'over' : ''}`} style={{ width: `${pct}%` }} />
          </div>
          <span className="small muted">Protected limit: {limit} units. Staying at or below it keeps the cheaper protected rate.</span>
        </div>
      )}
      {b.topDevices.length > 0 && <p className="small muted" style={{ margin: 0 }}>Most used this month (estimates): {b.topDevices.slice(0, 4).map((d) => `${d.name} ~${units(d.kwh)} units`).join(' · ')}</p>}
      {b.lastMonth !== null && <p className="small muted" style={{ margin: 0 }}>Last month: {units(b.lastMonth)} units.</p>}

      <div className="stack-tight">
        <b>Meter readings</b>
        {list.length === 0 && <span className="small muted">None yet. Type the kWh number on your meter, and again whenever you like — the meter reader’s day is the most useful.</span>}
        {(showAll ? list : list.slice(0, 5)).map((r) => (
          <div key={r.id} className="row reading-row">
            <span className="grow"><b>{units(r.kwh)}</b> kWh{r.newMeter && <span className="badge info" style={{ marginLeft: 8 }}>new meter</span>}</span>
            <span className="small muted">{new Date(r.readAt).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz })}{r.by ? ` · ${r.by}` : ''}</span>
            {canEdit && <button className="icon-btn" aria-label="Edit" onClick={() => setDialog(r)}><Icon name="pencil" size={14} /></button>}
            {canEdit && <button className="icon-btn" aria-label="Delete" onClick={() => confirm(`Delete the reading ${units(r.kwh)} kWh?`) && void del(`/power/readings/${r.id}`).then(reload)}><Icon name="trash" size={14} /></button>}
          </div>
        ))}
        {list.length > 5 && <button className="link-btn" onClick={() => setShowAll(!showAll)}>{showAll ? 'Show fewer' : `All ${list.length} readings`}</button>}
      </div>
      {(dialog === 'reading' || (dialog && typeof dialog === 'object')) && (
        <ReadingDialog reading={typeof dialog === 'object' ? dialog : null} tz={tz} onClose={() => setDialog(null)} onSaved={(n) => { bill.setData(n); void readings.reload(); }} />
      )}
      {dialog === 'settings' && <BillSettings bill={b} onClose={() => setDialog(null)} onSaved={(n) => bill.setData(n)} />}
    </section>
  );
}

function ReadingDialog({ reading, tz, onClose, onSaved }: { reading: MeterReading | null; tz: string; onClose: () => void; onSaved: (b: Bill) => void }) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: tz });
  const day = reading ? new Date(reading.readAt).toLocaleDateString('en-CA', { timeZone: tz }) : today;
  return (
    <FormModal title={reading ? 'Change the reading' : 'Add a meter reading'} sub="The kWh number on your electricity meter (the number the meter reader writes down)." submitLabel="Save" onClose={onClose}
               onSubmit={async (f) => {
                 const date = String(f.get('date'));
                 // the date at noon in the home: the meter reader comes in the day; today: right now
                 const readAt = date === today && !reading ? new Date().toISOString() : new Date(`${date}T12:00:00+05:00`).toISOString();
                 const body = { kwh: Number(f.get('kwh')), readAt: date === day && reading ? reading.readAt : readAt, newMeter: f.get('newMeter') === 'on' };
                 onSaved(reading ? await patch<Bill>(`/power/readings/${reading.id}`, body) : await post<Bill>('/power/readings', body));
               }}>
      <label className="field">Meter reading (kWh)<input name="kwh" type="number" step="0.1" min={0} required defaultValue={reading?.kwh} placeholder="e.g. 12345" autoFocus /></label>
      <label className="field">Read on<input name="date" type="date" max={today} defaultValue={day} required /></label>
      <label className="check"><input type="checkbox" name="newMeter" defaultChecked={reading?.newMeter} /> The meter was replaced (a new meter starts from its own number)</label>
    </FormModal>
  );
}

function BillSettings({ bill, onClose, onSaved }: { bill: Bill; onClose: () => void; onSaved: (b: Bill) => void }) {
  const [slabs, setSlabs] = useState<Slab[]>(bill.slabs);
  const [useLimit, setUseLimit] = useState(bill.protectedLimit !== null);
  const { busy, error, run } = useAction();
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await run(async () => {
      onSaved(await put<Bill>('/power/bill', {
        billingDay: Number(f.get('billingDay')), slabs: slabs.filter((s) => s.rate > 0),
        protectedLimit: useLimit ? Number(f.get('limit')) || 200 : null,
      }));
      onClose();
    });
  }
  const setSlab = (i: number, s: Partial<Slab>) => setSlabs((x) => x.map((y, j) => (j === i ? { ...y, ...s } : y)));
  return (
    <Modal title="Billing day and rates" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="dialog-body stack">
          <label className="field">Billing day (the day the meter reader comes)
            <input name="billingDay" type="number" min={1} max={31} defaultValue={bill.billingDay} required />
          </label>
          <div className="stack-tight">
            <b>Rates</b>
            {slabs.length === 0 ? (
              <span className="small muted">One price for every unit: {rs(bill.tariff)} (change it under Cost above). Or add slabs, as on your bill.</span>
            ) : slabs.map((s, i) => (
              <div key={i} className="row" style={{ gap: 6 }}>
                <span className="small muted nowrap">{i === slabs.length - 1 ? 'Above that' : 'Up to'}</span>
                {i < slabs.length - 1 && <input type="number" min={1} value={s.upTo ?? ''} onChange={(e) => setSlab(i, { upTo: Number(e.target.value) || null })} style={{ width: 90 }} aria-label="Up to units" />}
                <span className="small muted nowrap">units at Rs</span>
                <input type="number" step="0.01" min={0.01} value={s.rate || ''} onChange={(e) => setSlab(i, { rate: Number(e.target.value) })} style={{ width: 90 }} aria-label="Rate" required />
                <button type="button" className="icon-btn" aria-label="Remove slab" onClick={() => setSlabs((x) => x.filter((_, j) => j !== i))}><Icon name="trash" size={14} /></button>
              </div>
            ))}
            <div className="row" style={{ gap: 6 }}>
              <button type="button" className="btn btn-sm" onClick={() => setSlabs((x) => {
                const prev = x.filter((s) => s.upTo !== null);
                const last = prev[prev.length - 1]?.upTo ?? 0;
                const open = x.find((s) => s.upTo === null);
                return [...prev, { upTo: last + 100, rate: open?.rate ?? bill.tariff }, { upTo: null, rate: open?.rate ?? bill.tariff }];
              })}><Icon name="plus" size={14} />Add a slab</button>
              {slabs.length > 0 && <button type="button" className="btn btn-sm" onClick={() => setSlabs([])}>One price for all</button>}
            </div>
          </div>
          <label className="check"><input type="checkbox" checked={useLimit} onChange={(e) => setUseLimit(e.target.checked)} /> Warn me before we pass the protected limit</label>
          {useLimit && <label className="field">Protected limit (units a month)<input name="limit" type="number" min={10} max={2000} defaultValue={bill.protectedLimit ?? 200} /></label>}
          <ErrorBox error={error} />
        </div>
        <div className="dialog-foot">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Please wait…' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  );
}

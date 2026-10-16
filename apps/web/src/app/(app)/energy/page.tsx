'use client';
import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { Loader } from '@/components/Loader';
import { useCrumbs } from '@/components/Shell';
import { FormModal, Kpi, PageHead, Seg } from '@/components/ui';
import { patch, put } from '@/lib/api';
import { useLoad } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import type { Energy, EnergyDevice } from '@/lib/types';

const rs = (n: number) => `Rs ${n.toLocaleString('en-PK')}`;
const units = (n: number) => (n < 10 ? n.toFixed(1) : Math.round(n).toLocaleString('en-PK'));
const hours = (h: number) => (h < 1 ? `${Math.round(h * 60)} min` : `${h.toFixed(h < 10 ? 1 : 0)} h`);

function dayLabel(day: string, days: number) {
  const d = new Date(`${day}T12:00:00`);
  return days <= 7 ? d.toLocaleDateString([], { weekday: 'short' }) : String(d.getDate());
}

/** Units per day as bars; today is the last one. */
function DayBars({ data }: { data: Energy }) {
  const max = Math.max(...data.perDay.map((d) => d.kwh), 0.01);
  return (
    <div className="energy-bars" role="img" aria-label="Units per day">
      {data.perDay.map((d, i) => (
        <div key={d.day} className={`eb ${i === data.perDay.length - 1 ? 'today' : ''}`} title={`${d.day}: ${units(d.kwh)} units, ${rs(d.cost)}`}>
          <span className="eb-bar" style={{ height: `${Math.max(2, (d.kwh / max) * 100)}%` }} />
          {(data.days <= 7 || i % 5 === 0 || i === data.perDay.length - 1) && <span className="eb-lbl">{dayLabel(d.day, data.days)}</span>}
        </div>
      ))}
    </div>
  );
}

export default function EnergyPage() {
  const { isAdmin, home } = useSession();
  useCrumbs([{ label: home?.name ?? 'Home', href: '/' }, { label: 'Electricity' }]);
  const [days, setDays] = useState<'1' | '7' | '30'>('7');
  const energy = useLoad<Energy>(`/energy?days=${days}`);
  const [editing, setEditing] = useState<EnergyDevice | 'tariff' | null>(null);
  const canEdit = isAdmin && !home?.readOnly;
  const e = energy.data;
  const top = e ? Math.max(...e.devices.map((d) => d.kwh), 0.01) : 1;

  return (
    <>
      <PageHead title="Electricity" sub="An estimate from how long each switch was on and how much power it draws — your meter is the real number."
                actions={<Seg options={[{ id: '1', label: 'Today' }, { id: '7', label: '7 days' }, { id: '30', label: '30 days' }]} value={days} onChange={setDays} />} />
      {!e ? (energy.error ? <div className="alert">{energy.error}</div> : <Loader label="Adding it up…" />) : (
        <>
          <div className="kpis k3">
            <Kpi label="Units used" value={units(e.total.kwh)} unit="kWh" chip={{ icon: 'zap', tone: 'on' }} sub={`${hours(e.total.hours)} of switches on`} />
            <Kpi label="Cost" value={rs(e.total.cost)} chip={{ icon: 'wallet', tone: 'ac' }}
                 sub={<>at {rs(e.tariff)} a unit{canEdit && <> · <button className="link-btn" onClick={() => setEditing('tariff')}>{e.tariffSet ? 'Change' : 'Set your rate'}</button></>}</>} />
            <Kpi label="A month at this pace" value={`~${e.month.kwh}`} unit="units" chip={{ icon: 'activity', tone: 'ok' }} sub={`about ${rs(e.month.cost)}`} />
          </div>

          {days !== '1' && (
            <section className="section card card-pad">
              <h2 style={{ marginBottom: 10 }}>Units per day</h2>
              <DayBars data={e} />
              {e.powerCuts > 0 && <p className="small muted" style={{ marginTop: 8 }}>{e.powerCuts} power cut{e.powerCuts === 1 ? '' : 's'} in this time are left out: nothing runs without power.</p>}
            </section>
          )}

          <section className="section card card-pad">
            <div className="spread" style={{ marginBottom: 6 }}>
              <h2>By device</h2>
              {e.unknown > 0 && <span className="small muted">{e.unknown} without a power rating count as 0{canEdit ? ' — set them below' : ''}</span>}
            </div>
            {e.devices.length === 0 && <p className="muted">No switches to count yet.</p>}
            <div className="energy-list">
              {e.devices.map((d) => (
                <div key={d.id} className="energy-row">
                  <span className="grow stack-tight" style={{ minWidth: 0 }}>
                    <span className="spread">
                      <b className="truncate">{d.name}{d.onNow && <span className="badge ok" style={{ marginLeft: 8 }}>On</span>}</b>
                      <b>{rs(d.cost)}</b>
                    </span>
                    <span className="energy-meter"><span style={{ width: `${(d.kwh / top) * 100}%` }} /></span>
                    <span className="small muted">
                      {d.room ? `${d.room} · ` : ''}{hours(d.hours)} on · {units(d.kwh)} units ·{' '}
                      {d.wattsSource === 'unknown' ? 'power not set' : `${d.watts} W${d.wattsSource === 'guessed' ? ' (guessed)' : ''}`}
                      {canEdit && <> · <button className="link-btn" onClick={() => setEditing(d)}>{d.wattsSource === 'set' ? 'Change' : 'Set power'}</button></>}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </section>
        </>
      )}

      {editing === 'tariff' && e && (
        <FormModal title="Price of one unit" sub="Look at your electricity bill: the total divided by the units used gives your rate, taxes included."
                   submitLabel="Save" onClose={() => setEditing(null)}
                   onSubmit={async (f) => { const v = Number(f.get('tariff')); await put('/home/tariff', { tariff: v > 0 ? v : null }); await energy.reload(); }}>
          <label className="field">Rupees per unit (kWh)<input name="tariff" type="number" step="0.1" min={0} max={999} defaultValue={e.tariffSet ? e.tariff : ''} placeholder={String(e.tariff)} autoFocus /></label>
          <p className="small muted">Leave it empty to use the typical rate (Rs {e.tariff}).</p>
        </FormModal>
      )}
      {editing && editing !== 'tariff' && (
        <FormModal title={`Power of ${editing.name}`} sub="Its rating in watts, on its label or box. A ceiling fan is about 75 W, an LED bulb 10–15 W, a 1-ton AC about 1200 W, a geyser 2000 W."
                   submitLabel="Save" onClose={() => setEditing(null)}
                   onSubmit={async (f) => { const v = Number(f.get('watts')); await patch(`/devices/${editing.id}`, { watts: v > 0 ? Math.round(v) : null }); await energy.reload(); }}>
          <label className="field">Watts<input name="watts" type="number" min={0} max={10000} defaultValue={editing.wattsSource === 'set' ? editing.watts : ''} placeholder={editing.watts ? String(editing.watts) : 'e.g. 75'} autoFocus /></label>
          <p className="small muted"><Icon name="help" size={12} /> Empty: guessed from its name.</p>
        </FormModal>
      )}
    </>
  );
}

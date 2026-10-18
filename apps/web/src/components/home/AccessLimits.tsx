'use client';
import { useState } from 'react';
import { FormModal } from '@/components/ui';
import { patch } from '@/lib/api';
import type { AccessLimitsInput, FamilyMember } from '@/lib/types';

/** Monday first, as people here say the week. */
const WEEK: [number, string][] = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun']];

export interface LimitsState {
  /** "2026-10-20T17:00" in the home's time zone ('' = no end) */
  until: string;
  hours: boolean;
  from: string;
  to: string;
  /** empty = every day */
  days: number[];
}

export const NO_LIMITS: LimitsState = { until: '', hours: false, from: '09:00', to: '17:00', days: [] };

/** An ISO time as "YYYY-MM-DDTHH:MM" on the home's clock (for a datetime-local field). */
export function toHomeInput(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

export function limitsFrom(m: FamilyMember['access'], timeZone: string): LimitsState {
  if (!m) return NO_LIMITS;
  return {
    until: toHomeInput(m.accessUntil, timeZone),
    hours: !!(m.accessFrom && m.accessTo),
    from: m.accessFrom ?? '09:00', to: m.accessTo ?? '17:00', days: m.accessDays ?? [],
  };
}

/** What the API takes ("a time without a zone" = the home's time, so it means the same wherever you are). */
export function limitsBody(s: LimitsState): AccessLimitsInput {
  return {
    accessUntil: s.until || null,
    accessFrom: s.hours ? s.from : null,
    accessTo: s.hours ? s.to : null,
    accessDays: s.days,
  };
}

/** Quick picks for the end: tonight, the weekend, a week. */
function presets(timeZone: string): [string, string][] {
  const now = new Date();
  const home = (d: Date, h: number) => `${toHomeInput(d.toISOString(), timeZone).slice(0, 10)}T${String(h).padStart(2, '0')}:00`;
  const inDays = (n: number) => new Date(now.getTime() + n * 86400000);
  const day = new Date(toHomeInput(now.toISOString(), timeZone) + ':00Z').getUTCDay();
  const toSunday = (7 - day) % 7 || 7;
  return [['Tonight', home(now, 23)], ['Tomorrow', home(inDays(1), 20)], ['The weekend', home(inDays(toSunday), 20)], ['A week', home(inDays(7), 20)]];
}

/** "Until" and "only these hours" for a member or guest: the maid 9:00–17:00 Mon–Sat, a guest for the weekend. */
export function AccessLimitsFields({ value, onChange, timeZone }: { value: LimitsState; onChange: (v: LimitsState) => void; timeZone: string }) {
  const set = (p: Partial<LimitsState>) => onChange({ ...value, ...p });
  const toggleDay = (d: number) => set({ days: value.days.includes(d) ? value.days.filter((x) => x !== d) : [...value.days, d] });
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="form-grid">
        <label className="field">Access until <span className="hint">optional, your home’s time</span>
          <input type="datetime-local" value={value.until} onChange={(e) => set({ until: e.target.value })} />
        </label>
      </div>
      <div className="light-chips" role="group" aria-label="Quick end times">
        {presets(timeZone).map(([label, at]) => (
          <button key={label} type="button" className={value.until === at ? 'on' : ''} onClick={() => set({ until: at })}>{label}</button>
        ))}
        {value.until && <button type="button" onClick={() => set({ until: '' })}>No end</button>}
      </div>
      <label className="check"><input type="checkbox" checked={value.hours} onChange={(e) => set({ hours: e.target.checked })} /> Only at certain hours</label>
      {value.hours && (
        <div className="form-grid">
          <label className="field">From<input type="time" value={value.from} onChange={(e) => set({ from: e.target.value })} required /></label>
          <label className="field">To <span className="hint">22:00 to 06:00 goes past midnight</span><input type="time" value={value.to} onChange={(e) => set({ to: e.target.value })} required /></label>
        </div>
      )}
      <div className="stack-tight">
        <span className="small muted">Days {value.days.length ? '' : '(every day)'}</span>
        <div className="light-chips" role="group" aria-label="Days">
          {WEEK.map(([d, label]) => (
            <button key={d} type="button" className={value.days.includes(d) ? 'on' : ''} aria-pressed={value.days.includes(d)} onClick={() => toggleDay(d)}>{label}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** The people page's "Access hours" dialog: change, extend or lift someone's limits. */
export function EditAccessDialog({ person, timeZone, onClose, onSaved }: { person: FamilyMember; timeZone: string; onClose: () => void; onSaved: () => void }) {
  const [value, setValue] = useState<LimitsState>(() => limitsFrom(person.access, timeZone));
  const expired = person.access?.status === 'expired';
  return (
    <FormModal title={`${expired ? 'Extend' : 'Access for'} ${person.name}`} wide
      sub={expired ? 'Their access has ended. Pick a new end (or none) to let them in again.' : 'Outside these hours they can open the app but can’t see or switch anything.'}
      submitLabel="Save" onClose={onClose}
      onSubmit={async () => { await patch(`/users/${person.id}`, limitsBody(value)); onSaved(); }}>
      <AccessLimitsFields value={value} onChange={setValue} timeZone={timeZone} />
    </FormModal>
  );
}

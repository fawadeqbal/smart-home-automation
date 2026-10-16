'use client';
import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { Modal, useAction } from '@/components/ui';
import { put } from '@/lib/api';
import { useLoad } from '@/lib/hooks';
import { useLive } from '@/lib/live';
import type { AwayState } from '@/lib/types';

const clock = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '');
/** "23:30" as the person's clock shows it ("11:30 PM"). */
const hhmm = (t: string) => { const [h, m] = t.split(':').map(Number); const d = new Date(); d.setHours(h!, m!, 0, 0); return clock(d.toISOString()); };

/** On the home page: away mode on or off, and (for owners and admins) which lights make the home look lived-in. */
export function AwayCard({ isAdmin, readOnly }: { isAdmin: boolean; readOnly: boolean }) {
  const away = useLoad<AwayState>('/home/away');
  const { busy, error, run } = useAction();
  const [picking, setPicking] = useState(false);
  useLive('devices.changed', () => void away.reload());
  const a = away.data;
  if (!a) return null;

  const names = new Map(a.switches.map((s) => [s.id, s.name]));
  const lights = a.lights.map((id) => names.get(id)).filter(Boolean);
  const toggle = () => run(async () => { await put('/home/away', { on: !a.on }); await away.reload(); });

  return (
    <>
      <div className={`away-card card ${a.on ? 'on' : ''}`}>
        <span className="away-ic"><Icon name="shield" size={17} /></span>
        <span className="grow stack-tight" style={{ minWidth: 0 }}>
          <b>{a.on ? 'Away mode is on' : 'Away mode'}</b>
          <span className="small muted">
            {a.on
              ? `Since ${new Date(a.since!).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}${a.by ? ` by ${a.by}` : ''}. Doors and motion alert everyone at any hour${lights.length ? `; ${lights.join(', ')} go on and off from ${clock(a.eveningFrom)} to ${hhmm(a.eveningTo)}` : ''}.`
              : 'Going out of town? Doors and motion alert you at any hour, and lights can go on and off in the evening.'}
          </span>
          {error && <span className="small text-bad">{error}</span>}
        </span>
        {isAdmin && !readOnly && <button className="link-btn" onClick={() => setPicking(true)}>Lights</button>}
        {!readOnly && (
          <button className={`btn btn-small ${a.on ? '' : 'btn-primary'}`} disabled={busy} onClick={() => void toggle()}>{a.on ? 'I’m home' : 'Turn on'}</button>
        )}
      </div>
      {picking && <LightPicker away={a} onClose={() => setPicking(false)} onSaved={() => void away.reload()} />}
    </>
  );
}

function LightPicker({ away, onClose, onSaved }: { away: AwayState; onClose: () => void; onSaved: () => void }) {
  const [picked, setPicked] = useState<string[]>(away.lights);
  const { busy, error, run } = useAction();
  const save = () => run(async () => { await put('/home/away', { lights: picked }); onSaved(); onClose(); });
  return (
    <Modal title="Lights for away mode" sub={`While away, these go on and off at random from ${clock(away.eveningFrom) || 'sunset'} to ${hhmm(away.eveningTo)}, so the home looks lived-in.`} onClose={onClose}
           footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={() => void save()}>Save</button></>}>
      <div className="dialog-body stack">
        <div className="light-chips">
          {away.switches.map((s) => (
            <button key={s.id} type="button" className={picked.includes(s.id) ? 'on' : ''}
                    onClick={() => setPicked((v) => (v.includes(s.id) ? v.filter((x) => x !== s.id) : [...v, s.id]))}>
              {s.name}{s.room ? <span className="muted"> · {s.room}</span> : null}
            </button>
          ))}
        </div>
        <p className="small muted">Pick lights only — not a geyser, motor or anything that shouldn’t run alone.</p>
        {error && <div className="alert">{error}</div>}
      </div>
    </Modal>
  );
}

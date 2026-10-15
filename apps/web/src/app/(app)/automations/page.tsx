'use client';
import { FormEvent, useMemo, useState } from 'react';
import { PageHelp, Tip } from '@/components/Help';
import { Icon } from '@/components/Icon';
import { Loader } from '@/components/Loader';
import { del, errorText, patch, post } from '@/lib/api';
import { useDevices, useLoad, useNow } from '@/lib/hooks';
import { useLive } from '@/lib/live';
import type { Device, Scene, Schedule } from '@/lib/types';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function until(iso: string | null) {
  if (!iso) return '';
  const sec = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  if (sec <= 0) return 'now';
  if (sec < 3600) return `in ${Math.max(1, Math.round(sec / 60))} min`;
  if (sec < 86400) return `in ${Math.floor(sec / 3600)} h ${Math.round((sec % 3600) / 60)} min`;
  return `in ${Math.round(sec / 86400)} days`;
}

function whenText(s: Schedule) {
  if (s.kind === 'DAILY') {
    const days = s.days.length === 0 || s.days.length === 7 ? 'Every day' : s.days.map((d) => DAYS[d]).join(', ');
    return `${days} at ${s.time}`;
  }
  const at = s.runAt ? new Date(s.runAt) : null;
  return at ? `Once, ${at.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}` : 'Once';
}

/** Device picker: each device can be set to On / Off / (not included). */
function ActionPicker({ devices, value, onChange }: { devices: Device[]; value: Record<string, boolean>; onChange: (v: Record<string, boolean>) => void }) {
  return (
    <div className="action-grid">
      {devices.map((d) => {
        const v = value[d.id];
        const set = (next: boolean | undefined) => {
          const copy = { ...value };
          if (next === undefined) delete copy[d.id]; else copy[d.id] = next;
          onChange(copy);
        };
        return (
          <div key={d.id} className={`action-row ${v === undefined ? '' : 'picked'}`}>
            <span className="truncate"><b>{d.name}</b> <span className="muted small">{d.roomName ?? ''}</span></span>
            <div className="seg" role="group" aria-label={d.name}>
              <button type="button" className={v === true ? 'on' : ''} onClick={() => set(v === true ? undefined : true)}>On</button>
              <button type="button" className={v === false ? 'on' : ''} onClick={() => set(v === false ? undefined : false)}>Off</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function NewSchedule({ devices, scenes, onDone }: { devices: Device[]; scenes: Scene[]; onDone: () => void }) {
  const [what, setWhat] = useState<'devices' | 'scene'>('devices');
  const [actions, setActions] = useState<Record<string, boolean>>({});
  const [kind, setKind] = useState<'timer' | 'at' | 'daily'>('timer');
  const [days, setDays] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body: Record<string, unknown> = { name: String(f.get('name') ?? '').trim() || undefined };
    if (what === 'scene') body.sceneId = f.get('sceneId');
    else body.actions = Object.entries(actions).map(([deviceId, on]) => ({ deviceId, on }));
    if (kind === 'timer') Object.assign(body, { kind: 'ONCE', inMinutes: Number(f.get('minutes')) });
    if (kind === 'at') {
      const [h, m] = String(f.get('at')).split(':').map(Number);
      const when = new Date();
      when.setHours(h!, m!, 0, 0);
      if (when.getTime() <= Date.now()) when.setDate(when.getDate() + 1);
      Object.assign(body, { kind: 'ONCE', runAt: when.toISOString() });
    }
    if (kind === 'daily') Object.assign(body, { kind: 'DAILY', time: f.get('time'), days });
    setError(null);
    try {
      await post('/schedules', body);
      onDone();
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <form className="card card-pad stack" onSubmit={submit}>
      <div className="spread"><h3>New timer or schedule</h3><button type="button" className="icon-btn" aria-label="Close" onClick={onDone}>×</button></div>

      <div className="stack-tight">
        <span className="form-step">1 · What should happen?</span>
        {scenes.some((s) => s.canRun) && (
          <div className="seg seg-wide" role="group">
            <button type="button" className={what === 'devices' ? 'on' : ''} onClick={() => setWhat('devices')}>Switch devices</button>
            <button type="button" className={what === 'scene' ? 'on' : ''} onClick={() => setWhat('scene')}>Run a scene</button>
          </div>
        )}
      </div>
      {what === 'devices' ? (
        devices.length ? <ActionPicker devices={devices} value={actions} onChange={setActions} />
          : <p className="muted small">You have no devices you can control.</p>
      ) : (
        <label className="field">Scene
          <select name="sceneId">{scenes.filter((s) => s.canRun).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        </label>
      )}

      <div className="stack-tight">
        <span className="form-step">2 · When?</span>
        <div className="seg seg-wide" role="group">
          <button type="button" className={kind === 'timer' ? 'on' : ''} onClick={() => setKind('timer')}>After a while</button>
          <button type="button" className={kind === 'at' ? 'on' : ''} onClick={() => setKind('at')}>At a time</button>
          <button type="button" className={kind === 'daily' ? 'on' : ''} onClick={() => setKind('daily')}>Every day</button>
        </div>
      </div>
      <div className="form-grid">
        {kind === 'timer' && (
          <label className="field">In how many minutes?
            <input name="minutes" type="number" min={1} max={1440} defaultValue={30} required />
          </label>
        )}
        {kind === 'at' && <label className="field">At (today, or tomorrow if passed)<input name="at" type="time" required defaultValue="23:00" /></label>}
        {kind === 'daily' && (
          <>
            <label className="field">At<input name="time" type="time" required defaultValue="19:00" /></label>
            <div className="field">
              <span>On these days <Tip>None selected = every day.</Tip></span>
              <div className="day-chips">
                {DAYS.map((d, i) => (
                  <button type="button" key={d} className={days.includes(i) ? 'on' : ''}
                          onClick={() => setDays((v) => (v.includes(i) ? v.filter((x) => x !== i) : [...v, i].sort()))}>{d}</button>
                ))}
              </div>
            </div>
          </>
        )}
        <label className="field">Name (optional)<input name="name" maxLength={80} placeholder="e.g. Porch light at night" /></label>
      </div>
      {error && <div className="alert">{error}</div>}
      <div className="row">
        <button className="btn btn-primary" disabled={what === 'devices' && Object.keys(actions).length === 0}>Save</button>
        <button type="button" className="btn" onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}

function NewScene({ devices, onDone }: { devices: Device[]; onDone: () => void }) {
  const [actions, setActions] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  return (
    <form className="card card-pad stack" onSubmit={async (e) => {
      e.preventDefault();
      const name = String(new FormData(e.currentTarget).get('name')).trim();
      try {
        await post('/scenes', { name, actions: Object.entries(actions).map(([deviceId, on]) => ({ deviceId, on })) });
        onDone();
      } catch (err) { setError(errorText(err)); }
    }}>
      <div className="spread"><h3>New scene</h3><button type="button" className="icon-btn" aria-label="Close" onClick={onDone}>×</button></div>
      <label className="field">Name<input name="name" required maxLength={60} placeholder="Good night, Movie time, Leaving home…" /></label>
      <span className="form-step">Set each device you want in the scene</span>
      <ActionPicker devices={devices} value={actions} onChange={setActions} />
      {error && <div className="alert">{error}</div>}
      <div className="row">
        <button className="btn btn-primary" disabled={Object.keys(actions).length === 0}>Save scene</button>
        <button type="button" className="btn" onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}

export default function AutomationsPage() {
  const schedules = useLoad<Schedule[]>('/schedules');
  const scenes = useLoad<Scene[]>('/scenes');
  const { devices } = useDevices();
  const [form, setForm] = useState<'none' | 'schedule' | 'scene'>('none');
  const [running, setRunning] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useNow(30_000);
  useLive('schedules.changed', () => { void schedules.reload(); void scenes.reload(); });

  const controllable = useMemo(
    () => (devices ?? []).filter((d) => d.controllable && (d.access === 'CONTROL' || d.access === 'MANAGE')),
    [devices],
  );
  const active = (schedules.data ?? []).filter((s) => s.enabled);
  const past = (schedules.data ?? []).filter((s) => !s.enabled);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try { await fn(); await schedules.reload(); } catch (err) { setError(errorText(err)); }
  };

  async function runScene(s: Scene) {
    setRunning(s.id);
    setNotice(null);
    try {
      const r = await post<{ ok: boolean; summary: string }>(`/scenes/${s.id}/run`);
      setNotice({ ok: r.ok, text: `${s.name}: ${r.summary}` });
    } catch (err) {
      setNotice({ ok: false, text: errorText(err) });
    } finally {
      setRunning(null);
    }
  }

  if (!schedules.data || !scenes.data) {
    const e = schedules.error ?? scenes.error;
    return e ? <div className="alert">{e}</div> : <Loader label="Loading automations…" />;
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Automations</h1>
          <p className="muted">Timers, daily schedules and one-tap scenes. They run on the home server, even when the app is closed.</p>
        </div>
        <PageHelp id="automations" title="Making your home do things by itself">
          <ul>
            <li><b>Scenes</b> switch several devices with one tap — e.g. “Good night” turns every light off.</li>
            <li><b>Timers</b> run once: “turn the fan off in 30 minutes”, “turn the porch light on at 11 pm”.</li>
            <li><b>Schedules</b> repeat: “every day at 7 pm turn the porch light on”, only on weekdays if you like.</li>
            <li>You can also just ask the assistant: “turn off the bulb in half an hour”, “what timers are set?”, “cancel the bulb timer”.</li>
            <li>They act with <b>your</b> rights: if your access to a room is removed, your schedules there stop working.</li>
          </ul>
        </PageHelp>
      </div>

      {notice && <div className={`board-status ${notice.ok ? 'ok' : 'bad'} section`}><span className={`live-dot ${notice.ok ? '' : 'off'}`} />{notice.text}</div>}
      {error && <div className="alert section">{error}</div>}

      <section className="section">
        <div className="section-head spread">
          <h2>Scenes</h2>
          {form !== 'scene' && controllable.length > 0 && <button className="btn btn-small" onClick={() => setForm('scene')}><Icon name="plus" size={14} />New scene</button>}
        </div>
        {form === 'scene' && <NewScene devices={controllable} onDone={() => { setForm('none'); void scenes.reload(); }} />}
        <div className="scene-grid">
          {scenes.data.map((s) => (
            <div key={s.id} className="scene-card">
              <div className="spread">
                <span className="scene-icon"><Icon name={s.icon === 'moon' ? 'moon' : 'sparkles'} size={18} /></span>
                <button className="icon-btn" aria-label={`Delete ${s.name}`} title="Delete"
                        onClick={() => confirm(`Delete scene ${s.name}?`) && void run(() => del(`/scenes/${s.id}`)).then(() => scenes.reload())}>
                  <Icon name="trash" size={14} />
                </button>
              </div>
              <b>{s.name}</b>
              <span className="muted small">{s.actions.map((a) => `${a.deviceName} ${a.on ? 'on' : 'off'}`).join(' · ')}</span>
              <button className="btn btn-small btn-primary scene-run" disabled={!s.canRun || running === s.id} onClick={() => runScene(s)}
                      title={s.canRun ? undefined : 'You may not control every device in this scene'}>
                <Icon name="play" size={12} />{running === s.id ? 'Running…' : 'Run'}
              </button>
            </div>
          ))}
          {scenes.data.length === 0 && form !== 'scene' && (
            <p className="muted small">No scenes yet. A scene switches several devices at once — try “Good night”.</p>
          )}
        </div>
      </section>

      <section className="section">
        <div className="section-head spread">
          <h2>Timers & schedules</h2>
          {form !== 'schedule' && <button className="btn btn-small btn-primary" onClick={() => setForm('schedule')}><Icon name="plus" size={14} />New</button>}
        </div>
        {form === 'schedule' && (
          <NewSchedule devices={controllable} scenes={scenes.data} onDone={() => { setForm('none'); void schedules.reload(); }} />
        )}
        <div className="sched-list">
          {active.map((s) => (
            <div key={s.id} className="sched-item">
              <span className={`sched-icon ${s.kind === 'DAILY' ? 'daily' : ''}`}><Icon name={s.kind === 'DAILY' ? 'repeat' : 'clock'} size={18} /></span>
              <div className="sched-main">
                <b className="truncate">{s.name}</b>
                <span className="muted small">{whenText(s)}{s.nextRunAt ? ` · next ${until(s.nextRunAt)}` : ''} · by {s.createdBy}</span>
                {s.lastResult && <span className="small muted">Last run: {s.lastResult}</span>}
              </div>
              <label className="switch-input" title={s.enabled ? 'Pause' : 'Resume'}>
                <input type="checkbox" checked={s.enabled} onChange={(e) => void run(() => patch(`/schedules/${s.id}`, { enabled: e.target.checked }))} />
                <span />
              </label>
              <button className="icon-btn" aria-label={`Delete ${s.name}`} onClick={() => void run(() => del(`/schedules/${s.id}`))}><Icon name="trash" size={15} /></button>
            </div>
          ))}
          {active.length === 0 && form !== 'schedule' && (
            <div className="empty">No timers or schedules. Press <b>New</b>, or tell the assistant “turn off the bulb in 30 minutes”.</div>
          )}
        </div>
        {past.length > 0 && (
          <details className="past">
            <summary>Finished and paused ({past.length})</summary>
            <div className="sched-list">
              {past.map((s) => (
                <div key={s.id} className="sched-item done">
                  <span className="sched-icon"><Icon name={s.kind === 'DAILY' ? 'repeat' : 'clock'} size={18} /></span>
                  <div className="sched-main">
                    <b className="truncate">{s.name}</b>
                    <span className="muted small">{whenText(s)}{s.lastRunAt ? ` · ran ${new Date(s.lastRunAt).toLocaleString([], { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}` : ' · paused'}</span>
                    {s.lastResult && <span className="small muted">{s.lastResult}</span>}
                  </div>
                  {s.kind === 'DAILY' && (
                    <button className="btn btn-small" onClick={() => void run(() => patch(`/schedules/${s.id}`, { enabled: true }))}>Resume</button>
                  )}
                  <button className="icon-btn" aria-label={`Delete ${s.name}`} onClick={() => void run(() => del(`/schedules/${s.id}`))}><Icon name="trash" size={15} /></button>
                </div>
              ))}
            </div>
          </details>
        )}
      </section>
    </>
  );
}

'use client';
import { FormEvent, useMemo, useState } from 'react';
import { PageHelp, Tip } from '@/components/Help';
import { Icon } from '@/components/Icon';
import { Loader } from '@/components/Loader';
import { del, errorText, patch, post, put } from '@/lib/api';
import { useDevices, useLoad, useNow } from '@/lib/hooks';
import { useLive } from '@/lib/live';
import { useSession } from '@/lib/session';
import type { Device, HomeLocation, Rule, RuleAction, RuleEvent, Scene, Schedule } from '@/lib/types';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function until(iso: string | null) {
  if (!iso) return '';
  const sec = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  if (sec <= 0) return 'now';
  if (sec < 3600) return `in ${Math.max(1, Math.round(sec / 60))} min`;
  if (sec < 86400) return `in ${Math.floor(sec / 3600)} h ${Math.round((sec % 3600) / 60)} min`;
  return `in ${Math.round(sec / 86400)} days`;
}

const clockAt = (iso: string | null, tz?: string) => (iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone: tz }) : '–');

function whenText(s: Schedule) {
  if (s.kind === 'SUN') {
    const days = s.days.length === 0 || s.days.length === 7 ? 'Every day' : s.days.map((d) => DAYS[d]).join(', ');
    const ev = s.sunEvent === 'SUNRISE' ? 'sunrise' : 'sunset';
    const off = s.offsetMin ?? 0;
    return `${days} ${off ? `${Math.abs(off)} min ${off < 0 ? 'before' : 'after'} ${ev}` : `at ${ev}`}`;
  }
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

function NewSchedule({ devices, scenes, place, onDone }: { devices: Device[]; scenes: Scene[]; place: HomeLocation | null; onDone: () => void }) {
  const [what, setWhat] = useState<'devices' | 'scene'>('devices');
  const [actions, setActions] = useState<Record<string, boolean>>({});
  const [kind, setKind] = useState<'timer' | 'at' | 'daily' | 'sun'>('timer');
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
    if (kind === 'sun') {
      const mins = Number(f.get('offset') || 0) * (f.get('dir') === 'before' ? -1 : 1);
      Object.assign(body, { kind: 'SUN', sunEvent: f.get('sunEvent'), offsetMin: mins, days });
    }
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
      <div className="spread"><h3>New timer or schedule</h3><button type="button" className="icon-btn" aria-label="Close" onClick={onDone}><Icon name="x" size={16} /></button></div>

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
          <button type="button" className={kind === 'sun' ? 'on' : ''} onClick={() => setKind('sun')}>Sunrise / sunset</button>
        </div>
      </div>
      <div className="form-grid">
        {kind === 'timer' && (
          <label className="field">In how many minutes?
            <input name="minutes" type="number" min={1} max={1440} defaultValue={30} required />
          </label>
        )}
        {kind === 'at' && <label className="field">At (today, or tomorrow if passed)<input name="at" type="time" required defaultValue="23:00" /></label>}
        {kind === 'sun' && (
          <>
            <label className="field">At
              <select name="sunEvent" defaultValue="SUNSET"><option value="SUNSET">Sunset (Maghrib)</option><option value="SUNRISE">Sunrise</option></select>
            </label>
            <div className="field"><span>Earlier or later</span>
              <div className="row" style={{ gap: 6 }}>
                <input name="offset" type="number" min={0} max={180} defaultValue={0} style={{ width: 80 }} />
                <select name="dir" defaultValue="after"><option value="after">min after</option><option value="before">min before</option></select>
              </div>
            </div>
            {place && <p className="small muted" style={{ gridColumn: '1 / -1' }}>Today in {place.label}: sunrise {clockAt(place.sunrise, place.timezone)}, sunset {clockAt(place.sunset, place.timezone)}. The time moves with the seasons by itself.</p>}
          </>
        )}
        {(kind === 'daily' || kind === 'sun') && (
          <>
            {kind === 'daily' && <label className="field">At<input name="time" type="time" required defaultValue="19:00" /></label>}
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
      <div className="spread"><h3>New scene</h3><button type="button" className="icon-btn" aria-label="Close" onClick={onDone}><Icon name="x" size={16} /></button></div>
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

/** What a device can start a rule with, in words that fit it. */
function eventsOf(d: Device | undefined): { value: RuleEvent; label: string }[] {
  if (!d) return [];
  const kind = (d.settings as { kind?: string })?.kind;
  if (d.type === 'switch') return [{ value: 'on', label: 'Turns on' }, { value: 'off', label: 'Turns off' }];
  if (d.type === 'contact') {
    if (kind === 'motion') return [{ value: 'opens', label: 'Sees movement' }, { value: 'closes', label: 'Movement stops' }];
    if (kind === 'leak') return [{ value: 'opens', label: 'Finds water' }, { value: 'closes', label: 'Is dry again' }];
    return [{ value: 'opens', label: 'Opens' }, { value: 'closes', label: 'Closes' }];
  }
  if (d.type === 'dht' || d.type === 'analog') return [{ value: 'above', label: 'Goes above' }, { value: 'below', label: 'Goes below' }];
  return [];
}

function NewRule({ all, controllable, scenes, isAdmin, onDone }: { all: Device[]; controllable: Device[]; scenes: Scene[]; isAdmin: boolean; onDone: () => void }) {
  const triggers = all.filter((d) => eventsOf(d).length > 0);
  const [deviceId, setDeviceId] = useState(triggers.find((d) => d.type === 'contact')?.id ?? triggers[0]?.id ?? '');
  const dev = all.find((d) => d.id === deviceId);
  const events = eventsOf(dev);
  const [event, setEvent] = useState<RuleEvent>(events[0]?.value ?? 'on');
  const [field, setField] = useState<'temperature' | 'humidity'>('temperature');
  const [value, setValue] = useState(30);
  const [windowOn, setWindowOn] = useState(false);
  const [awayOnly, setAwayOnly] = useState(false);
  const [actions, setActions] = useState<Record<string, boolean>>({});
  const [forMinutes, setForMinutes] = useState('');
  const [sceneId, setSceneId] = useState('');
  const [tell, setTell] = useState<'' | 'me' | 'admins' | 'everyone'>('me');
  const [error, setError] = useState<string | null>(null);
  const reading = event === 'above' || event === 'below';
  const unit = dev?.type === 'analog' || field === 'humidity' ? '%' : '°C';

  function pick(id: string) {
    setDeviceId(id);
    setEvent(eventsOf(all.find((d) => d.id === id))[0]?.value ?? 'on');
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const list: RuleAction[] = Object.entries(actions).map(([id, on]) => ({ type: 'device', deviceId: id, on, ...(on && Number(forMinutes) > 0 ? { forMinutes: Number(forMinutes) } : {}) }));
    if (sceneId) list.push({ type: 'scene', sceneId });
    if (tell) list.push({ type: 'notify', to: tell, ...(String(f.get('message') ?? '').trim() ? { message: String(f.get('message')).trim() } : {}) });
    const body = {
      name: String(f.get('name') ?? '').trim() || undefined,
      trigger: { deviceId, event, ...(reading ? { value, field: dev?.type === 'dht' ? field : undefined } : {}) },
      conditions: { ...(windowOn ? { from: String(f.get('from')), to: String(f.get('to')) } : {}), ...(awayOnly ? { away: true } : {}) },
      actions: list,
    };
    setError(null);
    try { await post('/rules', body); onDone(); } catch (err) { setError(errorText(err)); }
  }

  if (!triggers.length) return <div className="card card-pad"><p className="muted">You can’t see any device that could start a rule yet.</p></div>;
  const nothing = Object.keys(actions).length === 0 && !sceneId && !tell;
  return (
    <form className="card card-pad stack" onSubmit={submit}>
      <div className="spread"><h3>New rule</h3><button type="button" className="icon-btn" aria-label="Close" onClick={onDone}><Icon name="x" size={16} /></button></div>
      <span className="form-step">1 · When…</span>
      <div className="form-grid">
        <label className="field">This device
          <select value={deviceId} onChange={(e) => pick(e.target.value)}>
            {triggers.map((d) => <option key={d.id} value={d.id}>{d.name}{d.roomName ? ` · ${d.roomName}` : ''}</option>)}
          </select>
        </label>
        <label className="field">Does this
          <select value={event} onChange={(e) => setEvent(e.target.value as RuleEvent)}>
            {events.map((ev) => <option key={ev.value} value={ev.value}>{ev.label}</option>)}
          </select>
        </label>
        {reading && (
          <div className="field"><span>Value</span>
            <div className="row" style={{ gap: 6 }}>
              {dev?.type === 'dht' && (
                <select value={field} onChange={(e) => setField(e.target.value as 'temperature' | 'humidity')}><option value="temperature">Temperature</option><option value="humidity">Humidity</option></select>
              )}
              <input type="number" step="0.5" value={value} onChange={(e) => setValue(Number(e.target.value))} style={{ width: 90 }} /> <span className="muted">{unit}</span>
            </div>
          </div>
        )}
      </div>
      <span className="form-step">2 · Only… <span className="muted small">(optional)</span></span>
      <div className="stack-tight">
        <label className="check"><input type="checkbox" checked={windowOn} onChange={(e) => setWindowOn(e.target.checked)} /> Between certain times</label>
        {windowOn && (
          <div className="row" style={{ gap: 8 }}>
            <input name="from" type="time" defaultValue="22:00" required /> <span className="muted">to</span> <input name="to" type="time" defaultValue="06:00" required />
          </div>
        )}
        <label className="check"><input type="checkbox" checked={awayOnly} onChange={(e) => setAwayOnly(e.target.checked)} /> Only while the home is in away mode</label>
      </div>
      <span className="form-step">3 · Then…</span>
      {controllable.length > 0 && <ActionPicker devices={controllable} value={actions} onChange={setActions} />}
      <div className="form-grid">
        {Object.values(actions).some(Boolean) && (
          <label className="field">Switch back off after (minutes, optional)
            <input type="number" min={1} max={1440} value={forMinutes} onChange={(e) => setForMinutes(e.target.value)} placeholder="e.g. 5" />
          </label>
        )}
        {scenes.some((x) => x.canRun) && (
          <label className="field">Run a scene
            <select value={sceneId} onChange={(e) => setSceneId(e.target.value)}>
              <option value="">No scene</option>
              {scenes.filter((x) => x.canRun).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </label>
        )}
        <label className="field">Send a notice
          <select value={tell} onChange={(e) => setTell(e.target.value as typeof tell)}>
            <option value="">No notice</option>
            <option value="me">To me</option>
            {isAdmin && <option value="admins">To owners and admins</option>}
            {isAdmin && <option value="everyone">To everyone in the home</option>}
          </select>
        </label>
        {tell && <label className="field">Notice text (optional)<input name="message" maxLength={200} placeholder="e.g. Someone is at the gate" /></label>}
        <label className="field">Name (optional)<input name="name" maxLength={120} placeholder="Made from your choices if empty" /></label>
      </div>
      {error && <div className="alert">{error}</div>}
      <div className="row">
        <button className="btn btn-primary" disabled={nothing}>Save rule</button>
        <button type="button" className="btn" onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}

function ago(iso: string) {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  if (min < 1440) return `${Math.round(min / 60)} h ago`;
  return new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short' });
}

/** Where the home is (for sunrise and sunset); owners and admins can change it. */
function PlaceLine({ place, isAdmin, onChange }: { place: HomeLocation; isAdmin: boolean; onChange: () => void }) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const from = { set: 'set by you', city: 'from the home’s city', board: 'from where the board connects', default: 'not set yet' }[place.source];
  async function save(body: Record<string, unknown>) {
    setError(null);
    try { await put('/home/location', body); setEditing(false); onChange(); } catch (err) { setError(errorText(err)); }
  }
  return (
    <div className="place-line small">
      <Icon name="sun" size={14} />
      <span>Sunrise {clockAt(place.sunrise, place.timezone)} · sunset {clockAt(place.sunset, place.timezone)} in <b>{place.label}</b> <span className="muted">({from})</span></span>
      {isAdmin && !editing && <button className="link-btn" onClick={() => setEditing(true)}>Change</button>}
      {editing && (
        <span className="row" style={{ gap: 6 }}>
          <select defaultValue="" onChange={(e) => e.target.value && void save({ city: e.target.value })} aria-label="City">
            <option value="">Pick your city…</option>
            {place.cities.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          {place.source === 'set' && <button className="link-btn" onClick={() => void save({ auto: true })}>Automatic</button>}
          <button className="link-btn" onClick={() => setEditing(false)}>Cancel</button>
        </span>
      )}
      {error && <span className="text-bad">{error}</span>}
    </div>
  );
}

export default function AutomationsPage() {
  const schedules = useLoad<Schedule[]>('/schedules');
  const scenes = useLoad<Scene[]>('/scenes');
  const rules = useLoad<Rule[]>('/rules');
  const place = useLoad<HomeLocation>('/home/location');
  const { devices } = useDevices();
  const { isAdmin } = useSession();
  const [form, setForm] = useState<'none' | 'schedule' | 'scene' | 'rule'>('none');
  const [running, setRunning] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useNow(30_000);
  useLive('schedules.changed', () => { void schedules.reload(); void scenes.reload(); void rules.reload(); });

  const controllable = useMemo(
    () => (devices ?? []).filter((d) => d.controllable && (d.access === 'CONTROL' || d.access === 'MANAGE')),
    [devices],
  );
  const active = (schedules.data ?? []).filter((s) => s.enabled);
  const past = (schedules.data ?? []).filter((s) => !s.enabled);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try { await fn(); await schedules.reload(); await rules.reload(); } catch (err) { setError(errorText(err)); }
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
          <p className="muted">Scenes, timers, sunset schedules and rules. They run on the home server, even when the app is closed.</p>
        </div>
        <PageHelp id="automations" title="Making your home do things by itself">
          <ul>
            <li><b>Scenes</b> switch several devices with one tap — e.g. “Good night” turns every light off.</li>
            <li><b>Timers</b> run once: “turn the fan off in 30 minutes”, “turn the porch light on at 11 pm”.</li>
            <li><b>Schedules</b> repeat: “every day at 7 pm turn the porch light on”, only on weekdays if you like — or at <b>sunset</b>, which moves with the seasons.</li>
            <li><b>Rules</b> react: “when the gate opens after 10 pm, turn the porch light on for 5 minutes and tell me”.</li>
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
        {place.data && <PlaceLine place={place.data} isAdmin={isAdmin} onChange={() => void place.reload()} />}
        {form === 'schedule' && (
          <NewSchedule devices={controllable} scenes={scenes.data} place={place.data ?? null} onDone={() => { setForm('none'); void schedules.reload(); }} />
        )}
        <div className="sched-list">
          {active.map((s) => (
            <div key={s.id} className="sched-item">
              <span className={`sched-icon ${s.kind !== 'ONCE' ? 'daily' : ''}`}><Icon name={s.kind === 'SUN' ? (s.sunEvent === 'SUNRISE' ? 'sun' : 'moon') : s.kind === 'DAILY' ? 'repeat' : 'clock'} size={18} /></span>
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
                  {s.kind !== 'ONCE' && (
                    <button className="btn btn-small" onClick={() => void run(() => patch(`/schedules/${s.id}`, { enabled: true }))}>Resume</button>
                  )}
                  <button className="icon-btn" aria-label={`Delete ${s.name}`} onClick={() => void run(() => del(`/schedules/${s.id}`))}><Icon name="trash" size={15} /></button>
                </div>
              ))}
            </div>
          </details>
        )}
      </section>
      <section className="section">
        <div className="section-head spread">
          <h2>Rules <span className="muted small">when this happens, do that</span></h2>
          {form !== 'rule' && (devices ?? []).length > 0 && <button className="btn btn-small" onClick={() => setForm('rule')}><Icon name="plus" size={14} />New rule</button>}
        </div>
        {form === 'rule' && (
          <NewRule all={devices ?? []} controllable={controllable} scenes={scenes.data} isAdmin={isAdmin}
                   onDone={() => { setForm('none'); void rules.reload(); }} />
        )}
        <div className="sched-list">
          {(rules.data ?? []).map((r) => (
            <div key={r.id} className={`sched-item ${r.enabled ? '' : 'done'}`}>
              <span className="sched-icon rule"><Icon name="zap" size={18} /></span>
              <div className="sched-main">
                <b className="wrap">{r.name}</b>
                {r.name !== r.summary && <span className="muted small">{r.summary}</span>}
                <span className="small muted">{r.lastFiredAt ? `Last ran ${ago(r.lastFiredAt)}: ${r.lastResult ?? ''}` : 'Hasn’t run yet'} · by {r.createdBy}</span>
              </div>
              <label className="switch-input" title={r.enabled ? 'Pause' : 'Resume'}>
                <input type="checkbox" checked={r.enabled} onChange={(e) => void run(() => patch(`/rules/${r.id}`, { enabled: e.target.checked }))} />
                <span />
              </label>
              <button className="icon-btn" aria-label={`Delete ${r.name}`}
                      onClick={() => confirm(`Delete the rule “${r.name}”?`) && void run(() => del(`/rules/${r.id}`))}><Icon name="trash" size={15} /></button>
            </div>
          ))}
          {(rules.data ?? []).length === 0 && form !== 'rule' && (
            <div className="empty">No rules yet. Try: when the gate opens at night, turn the porch light on for 5 minutes. Or ask the assistant.</div>
          )}
        </div>
      </section>
    </>
  );
}

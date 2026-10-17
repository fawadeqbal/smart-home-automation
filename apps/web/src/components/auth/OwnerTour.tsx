'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { enablePush } from '@/components/AppInstall';
import { Icon } from '@/components/Icon';
import { Loader } from '@/components/Loader';
import { errorText, get, post, put } from '@/lib/api';
import { useLive } from '@/lib/live';
import { ROOM_ICON } from '@/lib/roles';
import { useSession } from '@/lib/session';
import { AuthRoot, firstName, initials, Spinner, ThemeButton, useCopy } from './parts';

interface Welcome {
  home: { name: string; city: string };
  org: { name: string; logo: string | null };
  installer: string | null;
  rooms: { id: string; name: string; devices: number }[];
  devices: number;
  tryDevice: { id: string; name: string; room: string | null; online: boolean; on: boolean } | null;
}
interface Pref { key: string; label: string; enabled: boolean }
type Person = { name: string; email: string; role: 'MEMBER' | 'GUEST'; rooms: 'all' | string[] };
type Sent = { name: string; email: string; path?: string; error?: string };
type StepId = 'welcome' | 'try' | 'people' | 'alerts' | 'done';

/** Alerts, in the owner's words. Each switch turns a few of the real notification settings on or off. */
const ALERTS = [
  { id: 'trouble', icon: 'alert-triangle', t: 'Something stops working', d: 'A board goes offline or its Wi‑Fi gets weak, or a timer doesn’t run.', keys: ['boardOffline', 'boardHealth', 'scheduleFailed'] },
  { id: 'safety', icon: 'droplet', t: 'Water, doors and heat', d: 'A leak, a door opened at night, a very hot or cold room — if you have those sensors.', keys: ['leak', 'doorAtNight', 'temperature'] },
  { id: 'motion', icon: 'moon', t: 'Movement at night', d: 'Someone moving between 10 pm and 6 am. Off unless you want it.', keys: ['motionAtNight'] },
];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const blank = (): Person => ({ name: '', email: '', role: 'MEMBER', rooms: 'all' });

interface InstallEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }

export function OwnerTour() {
  const router = useRouter();
  const { me, home } = useSession();
  const [welcome, setWelcome] = useState<Welcome | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [finishing, setFinishing] = useState(false);

  // try a light
  const [lightOn, setLightOn] = useState(false);
  const [tried, setTried] = useState(false);
  const [trying, setTrying] = useState(false);
  const [tryError, setTryError] = useState<string | null>(null);
  // people
  const [people, setPeople] = useState<Person[]>([blank()]);
  const [sent, setSent] = useState<Sent[]>([]);
  const [sending, setSending] = useState(false);
  // alerts
  const [prefs, setPrefs] = useState<Pref[] | null>(null);
  const [install, setInstall] = useState<InstallEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [installHelp, setInstallHelp] = useState(false);
  const [push, setPush] = useState<{ on: boolean; busy: boolean; error: string | null }>({ on: false, busy: false, error: null });

  const canInvite = home?.role === 'OWNER' || home?.role === 'ADMIN';

  useEffect(() => {
    if (!home || home.viaStaff) { router.replace('/'); return; }
    get<Welcome>('/home/welcome').then((w) => { setWelcome(w); setLightOn(!!w.tryDevice?.on); }).catch((e) => setLoadError(errorText(e)));
    get<Pref[]>('/notifications/prefs').then(setPrefs).catch(() => setPrefs([]));
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') setPush((p) => ({ ...p, on: true }));
    setInstalled(window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true);
    const onPrompt = (e: Event) => { e.preventDefault(); setInstall(e as InstallEvent); };
    const onInstalled = () => setInstalled(true);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => { window.removeEventListener('beforeinstallprompt', onPrompt); window.removeEventListener('appinstalled', onInstalled); };
  }, [home, router]);

  // the wall switch moves the tile too
  useLive('device.state', (e: { id: string; state: { on?: boolean } }) => {
    if (e.id === welcome?.tryDevice?.id && typeof e.state?.on === 'boolean') setLightOn(e.state.on);
  });

  const steps = useMemo<StepId[]>(() => {
    const s: StepId[] = ['welcome'];
    if (welcome?.tryDevice) s.push('try');
    if (canInvite) s.push('people');
    s.push('alerts', 'done');
    return s;
  }, [welcome, canInvite]);

  if (loadError) return <Loader full label={loadError} />;
  if (!welcome || !home) return <Loader full label="Opening your home…" />;

  const id = steps[Math.min(step, steps.length - 1)]!;
  const last = step >= steps.length - 1;
  const installer = welcome.installer;
  const ready = people.filter((p) => EMAIL.test(p.email.trim()));
  const invited = sent.filter((s) => s.path).length;
  const alertsOn = ALERTS.filter((a) => groupOn(a.keys) === true).length;
  const light = welcome.tryDevice;

  function groupOn(keys: string[]): boolean | null {
    const mine = (prefs ?? []).filter((p) => keys.includes(p.key));
    return mine.length ? mine.some((p) => p.enabled) : null;
  }
  async function toggleGroup(keys: string[]) {
    const now = groupOn(keys);
    if (now === null || !prefs) return;
    const mine = prefs.filter((p) => keys.includes(p.key));
    setPrefs(prefs.map((p) => (keys.includes(p.key) ? { ...p, enabled: !now } : p)));
    try { setPrefs(await put<Pref[]>('/notifications/prefs', Object.fromEntries(mine.map((p) => [p.key, !now])))); } catch { setPrefs(prefs); }
  }

  async function tryLight() {
    if (!light || trying) return;
    setTrying(true); setTryError(null);
    const next = !lightOn;
    try {
      const r = await post<{ state?: { on?: boolean } }>(`/devices/${light.id}/commands`, { on: next });
      setLightOn(typeof r?.state?.on === 'boolean' ? r.state.on : next);
      setTried(true);
    } catch (e) {
      setTryError(errorText(e));
      setTried(true); // don't hold them up: they can try it later
    } finally {
      setTrying(false);
    }
  }

  async function sendInvites() {
    setSending(true);
    const results: Sent[] = [];
    for (const p of ready) {
      const rooms = p.rooms === 'all' ? welcome!.rooms.map((r) => r.id) : p.rooms;
      try {
        const r = await post<{ path: string }>('/invites', {
          email: p.email.trim(), name: p.name.trim() || undefined, role: p.role,
          rooms: rooms.map((roomId) => ({ roomId, access: 'CONTROL' })),
        });
        results.push({ name: p.name.trim() || p.email.trim(), email: p.email.trim(), path: r.path });
      } catch (e) {
        results.push({ name: p.name.trim() || p.email.trim(), email: p.email.trim(), error: errorText(e) });
      }
    }
    setSent((s) => [...s, ...results]);
    // keep the ones that failed so they can be fixed; clear the rest
    const failed = new Set(results.filter((r) => r.error).map((r) => r.email));
    const left = people.filter((p) => failed.has(p.email.trim()) || (!EMAIL.test(p.email.trim()) && (p.name.trim() || p.email.trim())));
    setPeople(left.length ? left : []);
    setSending(false);
  }

  async function finish() {
    setFinishing(true);
    await post('/home/onboarded').catch(() => undefined);
    router.replace('/');
  }

  async function next() {
    if (id === 'people' && ready.length > 0) { await sendInvites(); return; }
    if (last) { await finish(); return; }
    setStep(step + 1);
    window.scrollTo(0, 0);
  }

  const nextLabel = id === 'welcome' ? 'Show me how it works'
    : id === 'try' ? (tried ? 'Next' : `Tap the ${light?.name.toLowerCase() ?? 'light'} first`)
    : id === 'people' ? (ready.length ? `Send ${ready.length} invite${ready.length > 1 ? 's' : ''}` : 'Continue')
    : id === 'alerts' ? 'Finish' : 'Open my home';
  const nextDisabled = (id === 'try' && !tried && !!light?.online) || sending || finishing || trying;

  return (
    <AuthRoot label="Owner onboarding">
      <div className={`au-tour ${id === 'try' && lightOn ? 'lit' : ''}`}>
        <header className="au-tour-head">
          <button className="au-round" onClick={() => setStep(Math.max(0, step - 1))} aria-label="Back" title="Back"
            style={{ opacity: step === 0 || last ? 0 : 1, pointerEvents: step === 0 || last ? 'none' : undefined }}>
            <Icon name="arrow-left" size={16} />
          </button>
          <div className="au-bar" style={{ gridTemplateColumns: `repeat(${steps.length}, 1fr)` }} aria-hidden>
            {steps.map((s, i) => <span key={s}><i style={{ width: i <= step ? '100%' : '0%' }} /></span>)}
          </div>
          <span className="au-count mono" aria-label={`Step ${step + 1} of ${steps.length}`}>{step + 1} / {steps.length}</span>
          <ThemeButton />
        </header>

        <div className="au-tour-body">
          {id === 'welcome' && (
            <div className="au-step" key="welcome">
              <div className="au-step-head">
                <span className="au-eyebrow mono">Welcome to {welcome.home.name}</span>
                {welcome.devices > 0 ? (
                  <>
                    <h1 className="au-big">Everything is <span className="serif">already set up.</span></h1>
                    <p className="au-lead">
                      {installer ? `${firstName(installer)} named every light, fan and appliance and put each one in the right room.` : 'Every light, fan and appliance is named and in the right room.'} Here’s your home.
                    </p>
                  </>
                ) : (
                  <>
                    <h1 className="au-big">Your home is <span className="serif">on its way.</span></h1>
                    <p className="au-lead">{installer ? `${firstName(installer)} is` : 'Your installer is'} still connecting the switchboards. Rooms and switches show up here as they’re added — you don’t need to do anything.</p>
                  </>
                )}
              </div>
              {welcome.rooms.length > 0 && (
                <div className="au-rooms">
                  {welcome.rooms.map((r, i) => (
                    <div className="au-room" key={r.id} style={{ animationDelay: `${i * 60}ms` }}>
                      <span className="ri"><Icon name={ROOM_ICON(r.name)} size={20} /></span>
                      <span><b>{r.name}</b><small>{r.devices === 0 ? 'Nothing yet' : `${r.devices} ${r.devices === 1 ? 'thing' : 'things'}`}</small></span>
                    </div>
                  ))}
                </div>
              )}
              {installer && (
                <div className="au-card">
                  <span className="av">{initials(installer)}</span>
                  <span className="tx"><b>{firstName(installer)} is your home expert</b><span>If anything looks wrong, use “Ask for help” in the app — {welcome.org.name} gets your message.</span></span>
                </div>
              )}
            </div>
          )}

          {id === 'try' && light && (
            <div className="au-step center" key="try" style={{ gap: 32 }}>
              <div className="au-step-head">
                <h1 className="au-big">Give it <span className="serif">a try.</span></h1>
                <p className="au-lead" style={{ maxWidth: 460 }}>
                  {light.online ? <>Tap the {light.name.toLowerCase()}{light.room ? ` in the ${light.room.toLowerCase()}` : ''}. It’s the real one — look up.</>
                    : <>This is your {light.name.toLowerCase()}. Its board isn’t connected right now, so try it once it’s back.</>}
                </p>
              </div>
              <button className={`au-try ${lightOn ? 'on' : ''} ${trying ? 'busy' : ''}`} onClick={tryLight} disabled={!light.online}
                aria-pressed={lightOn} aria-label={`${light.name}: ${lightOn ? 'on' : 'off'}. Tap to switch ${lightOn ? 'off' : 'on'}.`}>
                <span className="r">
                  <span className="bulb"><Icon name="lightbulb" size={30} /></span>
                  <span className={`au-sw ${lightOn ? 'on' : ''}`}><i /></span>
                </span>
                <span className="nm"><b>{light.name}</b><span>{light.room ?? welcome.home.name} · {trying ? 'Switching…' : !light.online ? 'Offline' : lightOn ? 'On' : 'Off'}</span></span>
              </button>
              <div style={{ minHeight: 56, display: 'flex', alignItems: 'center', justifyContent: 'center' }} aria-live="polite">
                {tryError ? <div className="au-toast warn"><Icon name="alert-triangle" size={17} />{tryError} You can carry on and try it later.</div>
                  : tried ? <div className="au-toast"><Icon name="check" size={17} stroke={2.5} />That’s it. The wall switch still works too.</div> : null}
              </div>
            </div>
          )}

          {id === 'people' && (
            <PeopleStep rooms={welcome.rooms} people={people} setPeople={setPeople} sent={sent} homeName={welcome.home.name} />
          )}

          {id === 'alerts' && (
            <div className="au-step" key="alerts" style={{ gap: 28 }}>
              <div className="au-step-head">
                <h1 className="au-big">We’ll tell you <span className="serif">when it matters.</span></h1>
                <p className="au-lead">Only the things worth a notification. Change them anytime under Notifications.</p>
              </div>
              <div className="au-list">
                {ALERTS.map((a) => {
                  const on = groupOn(a.keys);
                  if (on === null) return null;
                  return (
                    <button key={a.id} onClick={() => void toggleGroup(a.keys)} role="switch" aria-checked={on}>
                      <span className={`lic ${on ? 'on' : ''}`}><Icon name={a.icon} size={20} /></span>
                      <span className="tx"><b>{a.t}</b><span>{a.d}</span></span>
                      <span className={`au-sw sm ${on ? 'on' : ''}`}><i /></span>
                    </button>
                  );
                })}
                <div>
                  <span className={`lic ${push.on ? 'blue' : ''}`}><Icon name="bell" size={20} /></span>
                  <span className="tx"><b>On this phone</b><span>{push.error ?? (push.on ? 'Notifications come to this device.' : 'Get them as notifications, not only in the app.')}</span></span>
                  <button className="au-btn sm" disabled={push.on || push.busy} style={{ width: 'auto' }}
                    onClick={async () => {
                      setPush({ on: false, busy: true, error: null });
                      try { await enablePush(); setPush({ on: true, busy: false, error: null }); } catch (e) { setPush({ on: false, busy: false, error: errorText(e) }); }
                    }}>{push.on ? 'On ✓' : push.busy ? 'Asking…' : 'Turn on'}</button>
                </div>
              </div>
              <div className="au-inkcard">
                <span className="ii"><Icon name="smartphone" size={22} /></span>
                <span className="tx"><b>Put Switchboard on your home screen</b><span>Opens like an app. Nothing to download from a store.</span></span>
                <button className={installed ? 'done' : ''} disabled={installed}
                  onClick={async () => {
                    if (install) { await install.prompt(); const c = await install.userChoice; if (c.outcome === 'accepted') setInstalled(true); setInstall(null); }
                    else setInstallHelp(!installHelp);
                  }}>{installed ? 'Added ✓' : install ? 'Add to home screen' : 'Show me how'}</button>
                {installHelp && !installed && (
                  <span className="err" style={{ color: 'var(--inkmu)' }}>
                    {/iphone|ipad|ipod/i.test(navigator.userAgent)
                      ? 'In Safari, tap the Share button, then “Add to Home Screen”.'
                      : 'Open your browser’s menu (⋮) and choose “Install app” or “Add to Home screen”.'}
                  </span>
                )}
              </div>
            </div>
          )}

          {id === 'done' && (
            <div className="au-step fill" key="done">
              <span className="au-bigtick"><Icon name="check" size={44} stroke={2.5} /></span>
              <h1 className="au-big" style={{ marginTop: 16, fontSize: 'clamp(40px, 5.6vw, 68px)' }}>
                You’re all set{firstName(me.name) ? ', ' : ''}<span className="serif">{firstName(me.name) ? `${firstName(me.name)}.` : '.'}</span>
              </h1>
              <div className="au-sum">
                <span><Icon name="house" size={15} />{welcome.rooms.length} {welcome.rooms.length === 1 ? 'room' : 'rooms'} ready</span>
                {canInvite && <span><Icon name="users" size={15} />{invited ? `${invited} invite${invited > 1 ? 's' : ''} ready to share` : 'No invites yet'}</span>}
                <span><Icon name="bell" size={15} />{alertsOn} alert{alertsOn === 1 ? '' : 's'} on</span>
              </div>
              <p style={{ fontSize: 16, color: 'var(--mu)', maxWidth: 440 }}>Tip: tap the mic and just say it — “Bedroom ka pankha band karo” works too.</p>
            </div>
          )}

          <div className="au-tour-foot">
            <button className="au-skip" onClick={() => { setStep(step + 1); window.scrollTo(0, 0); }}
              style={{ visibility: step > 0 && !last ? 'visible' : 'hidden' }}>{id === 'people' ? 'Skip for now' : 'Skip'}</button>
            <button className="au-next" onClick={() => void next()} disabled={nextDisabled}>
              {sending ? <>Sending…<Spinner /></> : finishing ? <>Opening…<Spinner /></> : <>{nextLabel}<Icon name="arrow-right" size={17} /></>}
            </button>
          </div>
        </div>
      </div>
    </AuthRoot>
  );
}

/* ---------------------------------------------------------------- who else lives here */
function PeopleStep({ rooms, people, setPeople, sent, homeName }: {
  rooms: Welcome['rooms']; people: Person[]; setPeople: (fn: (p: Person[]) => Person[]) => void; sent: Sent[]; homeName: string;
}) {
  const { copied, copy } = useCopy();
  const upd = (i: number, patch: Partial<Person>) => setPeople((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const link = (path: string) => `${window.location.origin}${path}`;

  return (
    <div className="au-step" key="people" style={{ gap: 28 }}>
      <div className="au-step-head">
        <h1 className="au-big">Who else <span className="serif">lives here?</span></h1>
        <p className="au-lead">Make them an invite link to send on WhatsApp or email. You choose which rooms each person can use — change it anytime.</p>
      </div>
      {sent.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} aria-live="polite">
          {sent.map((s) => (
            <div key={s.email + (s.path ?? '')} className={`au-sent ${s.error ? 'bad' : ''}`}>
              <Icon name={s.error ? 'alert-triangle' : 'check'} size={17} stroke={2.5} />
              <span className="who"><b>{s.name}</b><span>{s.error ?? `Invite ready · ${s.email}`}</span></span>
              {s.path && (
                <>
                  <button className="au-btn sm" onClick={() => void copy(link(s.path!))}><Icon name="copy" size={14} />{copied === link(s.path) ? 'Copied' : 'Copy link'}</button>
                  <a className="au-btn sm" target="_blank" rel="noreferrer"
                    href={`https://wa.me/?text=${encodeURIComponent(`You’re invited to ${homeName} on Switchboard: ${link(s.path)}`)}`}><Icon name="message" size={14} />WhatsApp</a>
                </>
              )}
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {people.map((p, i) => (
          <div className="au-person" key={i}>
            <div className="r1">
              <span className="ini" aria-hidden>{(p.name.trim()[0] ?? '?').toUpperCase()}</span>
              <input className="au-in n" value={p.name} onChange={(e) => upd(i, { name: e.target.value })} placeholder="Name" aria-label="Name" maxLength={80} />
              <input className="au-in e" type="email" value={p.email} onChange={(e) => upd(i, { email: e.target.value })} placeholder="Email" aria-label="Email" />
              <span className="au-seg" role="radiogroup" aria-label="Role">
                {(['MEMBER', 'GUEST'] as const).map((r) => (
                  <button key={r} role="radio" aria-checked={p.role === r} className={p.role === r ? 'on' : ''} onClick={() => upd(i, { role: r })}>{r === 'MEMBER' ? 'Member' : 'Guest'}</button>
                ))}
              </span>
              <button className="au-x" onClick={() => setPeople((ps) => ps.filter((_, j) => j !== i))} aria-label="Remove" title="Remove"><Icon name="x" size={16} /></button>
            </div>
            {rooms.length > 0 && (
              <div className="au-roomchips">
                <span>Can use</span>
                <button className={`au-chip ${p.rooms === 'all' ? 'on' : ''}`} aria-pressed={p.rooms === 'all'} onClick={() => upd(i, { rooms: p.rooms === 'all' ? [] : 'all' })}>All rooms</button>
                {rooms.map((r) => {
                  const on = p.rooms !== 'all' && p.rooms.includes(r.id);
                  return (
                    <button key={r.id} className={`au-chip ${on ? 'on' : ''}`} aria-pressed={on}
                      onClick={() => upd(i, { rooms: p.rooms === 'all' ? [r.id] : on ? p.rooms.filter((x) => x !== r.id) : [...p.rooms, r.id] })}>{r.name}</button>
                  );
                })}
              </div>
            )}
            {p.role === 'GUEST' && <span className="au-small"><Icon name="clock" size={14} />Guests can switch things in the rooms you pick — remove them anytime from People.</span>}
            {p.email.trim() && !EMAIL.test(p.email.trim()) && <span className="au-small" style={{ color: 'var(--badt)' }}>Enter a full email address, like name@gmail.com.</span>}
          </div>
        ))}
        <button className="au-add" onClick={() => setPeople((ps) => [...ps, blank()])}><Icon name="user-plus" size={18} />Add someone</button>
      </div>
    </div>
  );
}

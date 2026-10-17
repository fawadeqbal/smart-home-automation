'use client';
/**
 * The public landing page (design: "Switchboard Landing v2"). Shown at / to anyone who isn't signed in
 * (see src/middleware.ts) and always at /welcome. The booking form creates a visit request that staff
 * see in the console (Visit requests).
 */
import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Icon, toggleTheme } from '@/components/Icon';
import './landing.css';

/* ================================================================== content */

const DUR = 4600;
type DeviceId = 'light' | 'fan' | 'ac' | 'geyser' | 'motor' | 'gate';
const HERO: [DeviceId, string, string, string][] = [
  ['light', 'Lights', 'lightbulb', 'On'], ['fan', 'Fan', 'fan', 'Spinning'], ['ac', 'AC', 'snowflake', '24°'],
  ['geyser', 'Geyser', 'droplet', 'Heating'], ['motor', 'Water motor', 'zap', 'Filling'], ['gate', 'Gate light', 'lightbulb', 'On'],
];
interface Moment { t: string; label: string; greet: string; title: string; cap: string; icon: string; on: Partial<Record<DeviceId, boolean>>; voice: string; tint: string }
const DAY: Moment[] = [
  { t: '06:45', label: 'Morning', greet: 'Good morning, Ayesha', title: 'Geyser warmed up', cap: 'Before anyone woke up', icon: 'sun', on: { light: true, geyser: true, motor: true }, voice: 'Good morning', tint: 'linear-gradient(180deg,rgba(255,176,90,.34),rgba(255,176,90,0) 62%)' },
  { t: '09:10', label: 'Away', greet: 'Everyone’s out', title: 'AC turned off from the office', cap: 'It was left on by mistake', icon: 'smartphone', on: {}, voice: 'Sab kuch band kar do', tint: 'linear-gradient(180deg,rgba(255,255,255,.16),rgba(255,255,255,0) 60%)' },
  { t: '18:30', label: 'Sunset', greet: 'Welcome home', title: 'Lights on by themselves', cap: 'Every day at sunset', icon: 'clock', on: { light: true, fan: true, gate: true }, voice: 'Turn on the lights', tint: 'linear-gradient(180deg,rgba(236,104,72,.4),rgba(236,104,72,0) 64%)' },
  { t: '21:00', label: 'Family time', greet: 'Good evening', title: '“AC chala do, 24 degree”', cap: 'Zara asked — no phone needed', icon: 'mic', on: { light: true, ac: true, gate: true }, voice: 'AC chala do, 24 degree', tint: 'linear-gradient(180deg,rgba(40,44,110,.48),rgba(40,44,110,.08) 70%)' },
  { t: '23:15', label: 'Night', greet: 'Good night', title: 'Everything off', cap: 'Only the fan keeps going', icon: 'moon', on: { fan: true }, voice: 'Good night', tint: 'linear-gradient(180deg,rgba(8,10,30,.66),rgba(8,10,30,.22) 75%)' },
];
const MARQUEE: [string, string][] = [
  ['lightbulb', 'Lights'], ['fan', 'Ceiling fans'], ['snowflake', 'Air conditioners'], ['droplet', 'Geyser'], ['zap', 'Water motor'],
  ['lightbulb', 'Gate & porch lights'], ['toggle-right', 'Sockets'], ['clock', 'Schedules'], ['mic', 'Urdu voice'],
  ['users', 'Family access'], ['shield', 'Looked after 24/7'], ['sun', 'Morning & night scenes'],
];
const PAINS = [
  { icon: 'snowflake', q: 'Left the AC running and only remembered at the office?', a: 'Turn it off from your phone, wherever you are.', chip: 'AC · off from office' },
  { icon: 'droplet', q: 'Water tank overflowing because the motor was left on — again?', a: 'The motor switches itself off after 20 minutes.', chip: 'Motor · auto‑off' },
  { icon: 'moon', q: 'Going downstairs at night just to switch off the gate light?', a: 'Say “good night” and everything goes off.', chip: 'Good night · 7 off' },
  { icon: 'zap', q: 'Power came back after load-shedding and everything turned on at 3 am?', a: 'Your home remembers what was off.', chip: 'Power back · kept off' },
];
type Tab = 'control' | 'voice' | 'family' | 'help';
const TABS: { id: Tab; short: string; icon: string; title: string; d: string }[] = [
  { id: 'control', short: 'Home', icon: 'house', title: 'One tap for everything', d: 'Every light, fan and appliance — sorted by room, with big clear buttons.' },
  { id: 'voice', short: 'Ask', icon: 'mic', title: 'Just say it', d: 'In Urdu or English. “Pankha tez karo” works as well as “fan on”.' },
  { id: 'family', short: 'Family', icon: 'users', title: 'Everyone gets their own', d: 'Kids get their room, guests get the living room — only until they leave.' },
  { id: 'help', short: 'Health', icon: 'shield', title: 'We tell you, in plain words', d: 'If something stops working, you’ll know what to try — and our expert already knows.' },
];
const APP_DEVICES: [string, string, string, string][] = [
  ['ceil', 'Ceiling light', 'lightbulb', 'On'], ['lamp', 'Lamp', 'lightbulb', 'On'], ['fan', 'Ceiling fan', 'fan', 'Speed 3'],
  ['ac', 'AC', 'snowflake', '24° · Cool'], ['tv', 'TV', 'toggle-right', 'On'], ['ups', 'UPS charging', 'zap', 'On'],
];
const CHAT: ['me' | 'bot', string][] = [['me', 'Bedroom ka pankha band karo'], ['bot', 'Done — the bedroom fan is off.'], ['me', 'AC 24 pe kar do'], ['bot', 'Living room AC set to 24°.']];
const FAMILY: [string, string, string[], boolean][] = [
  ['Ayesha', 'Owner', ['All rooms'], true], ['Zara, 14', 'Member', ['Her bedroom', 'Living room'], false],
  ['Dadi', 'Member', ['Her room', 'Lounge'], false], ['Bilal', 'Guest · until Sunday', ['Guest room'], false],
];
const LOCAL = [
  { icon: 'zap', t: 'Ready for load-shedding', d: 'Works with your UPS and solar. When power returns, everything stays the way you left it.' },
  { icon: 'message', t: 'Speaks Urdu', d: 'Ask in Urdu, English or both mixed together — the way you actually talk.' },
  { icon: 'toggle-right', t: 'Wall switches still work', d: 'Even with no internet. Nobody at home has to change a habit.' },
  { icon: 'map-pin', t: 'Experts in your city', d: 'A real person in Lahore, Karachi and Islamabad — not a call centre abroad.' },
];
const STEPS = [
  { n: '1', src: 'https://images.unsplash.com/photo-1623707430101-9e74cefe05e2?fm=jpg&q=70&w=1400&auto=format&fit=crop', credit: 'Jaye Haych', href: 'https://unsplash.com/@jaye_haych', alt: 'Our expert visiting a home', t: 'Book a free visit', d: 'Our expert walks through your home with you and gives you a clear price.', time: '30 minutes' },
  { n: '2', src: 'https://images.unsplash.com/photo-1687819280272-95f9d2a3cdab?fm=jpg&q=70&w=1400&auto=format&fit=crop', credit: 'Michael Kahn', href: 'https://unsplash.com/@mklibrary', alt: 'Expert setting up at home', t: 'We set everything up', d: 'Every light, fan and appliance gets a name and a room. We invite your family too.', time: 'Usually one day' },
  { n: '3', src: 'https://images.unsplash.com/photo-1769938018324-886021458e2b?fm=jpg&q=70&w=1400&auto=format&fit=crop', credit: 'Maximilian Bungart', href: 'https://unsplash.com/@hypernature', alt: 'Family relaxing at home', t: 'You just enjoy it', d: 'Open the app and it’s all there. We keep an eye on your home from then on.', time: 'From day one' },
];
const FAQS: [string, string][] = [
  ['Will anything at home look different?', 'No. Everything stays where it is and works the way it always has. You simply get a smarter way to control it.'],
  ['What happens during load-shedding?', 'If your home has a UPS or solar, Switchboard keeps working. When power returns, things stay the way you left them — nothing turns on by surprise.'],
  ['Will it work in my home?', 'It works in most flats, houses and villas. The free visit tells you exactly what we can do in yours.'],
  ['Who helps if something stops working?', 'We do. We keep an eye on your home and usually fix things before you notice. You can always see what’s happening in the app.'],
  ['Is my data private?', 'Yes. Your home’s data is never sold or shared. You can see every change ever made in your home’s activity.'],
];
const CITIES = ['Lahore', 'Karachi', 'Islamabad', 'Somewhere else'];
const SIZES = ['Apartment', '5 Marla', '10 Marla', '1 Kanal+'];
const rupees = (n: number) => 'Rs ' + Math.round(n).toLocaleString('en-PK');

/* ================================================================== pieces */

function Tile({ name, icon, on, state, onClick }: { name: string; icon: string; on: boolean; state: string; onClick: () => void }) {
  return (
    <button type="button" className={`lp-tile ${on ? 'on' : ''}`} onClick={onClick} aria-pressed={on} aria-label={`${name}: ${on ? 'on' : 'off'}`}>
      <span className="lp-tile-top">
        <span className="lp-tile-icon"><span className={on && icon === 'fan' ? 'spin' : ''} style={{ display: 'inline-flex' }}><Icon name={icon} size={14} /></span></span>
        <span className="lp-sw"><i /></span>
      </span>
      <span className="lp-tile-name"><b>{name}</b><span>{on ? state : 'Off'}</span></span>
    </button>
  );
}

/** The hero: a day in a home, told in five moments, on a photo and a phone. */
function HeroStage() {
  // which moment of the day, and how far into it (ms)
  const [{ sc, el }, setT] = useState({ sc: 0, el: 0 });
  const [playing, setPlaying] = useState(true);
  const [hover, setHover] = useState(false);
  const [ovr, setOvr] = useState<Partial<Record<DeviceId, boolean>>>({});

  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setPlaying(false); setT({ sc: 0, el: DUR }); }
  }, []);
  useEffect(() => {
    if (!playing || hover) return;
    const id = setInterval(() => setT((t) => (t.el + 100 < DUR ? { sc: t.sc, el: t.el + 100 } : { sc: (t.sc + 1) % DAY.length, el: 0 })), 100);
    return () => clearInterval(id);
  }, [playing, hover]);
  useEffect(() => { setOvr({}); }, [sc]);               // a new moment shows its own devices

  const m = DAY[sc]!;
  const isOn = (id: DeviceId) => (id in ovr ? !!ovr[id] : !!m.on[id]);
  const onCount = HERO.filter(([id]) => isOn(id)).length;
  const chars = Math.max(0, Math.floor((el - 500) / 55));
  const typing = chars < m.voice.length && el > 400;
  const intro = Math.min(1, el / 350);

  return (
    <div className="lp-stage-col">
      <div className="lp-stage" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
        <div className="lp-photo">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="https://images.unsplash.com/photo-1758876023053-3aa541a0935b?fm=jpg&q=70&w=1800&auto=format&fit=crop" alt="A family relaxing at home" fetchPriority="high" />
          <div className="lp-tint" style={{ background: m.tint }} />
          <div className="lp-chip" style={{ opacity: intro, transform: `translateY(${(1 - intro) * 10}px)` }} aria-live="polite">
            <span className="lp-chip-icon"><Icon name={m.icon} size={16} /></span>
            <span className="lp-chip-text"><b>{m.title}</b><span>{m.cap}</span></span>
          </div>
          <a className="lp-credit" href="https://unsplash.com/@silverkblack" target="_blank" rel="noreferrer">Photo: Vitaly Gariev / Unsplash</a>
        </div>
        <div className="lp-phone" aria-label="The Switchboard app">
          <div className="lp-screen">
            <div className="lp-status"><span className="mono">{m.t}</span><span className="lp-notch" /><Icon name="wifi" size={13} /></div>
            <div className="lp-greet"><span>Khan residence</span><b>{m.greet}</b></div>
            <div className="lp-scene" style={{ opacity: intro }}><Icon name={m.icon} size={14} /><span>{m.label} scene · {onCount ? `${onCount} on` : 'all off'}</span></div>
            <div className="lp-tiles">
              {HERO.map(([id, name, icon, onText]) => (
                <Tile key={id} name={name} icon={icon} on={isOn(id)} state={onText}
                  onClick={() => { setOvr((o) => ({ ...o, [id]: !isOn(id) })); setPlaying(false); }} />
              ))}
            </div>
            <div className="lp-voice">
              <span>{m.voice.slice(0, chars) || ' '}<span className="lp-caret" style={{ opacity: typing ? 1 : 0 }} /></span>
              <span className={`lp-mic ${typing ? 'live' : ''}`}><Icon name="mic" size={16} /></span>
            </div>
          </div>
        </div>
      </div>
      <div className="lp-dayline">
        <button className="lp-play" onClick={() => { setPlaying((p) => !p); if (!playing) setOvr({}); }} title={playing ? 'Pause' : 'Play'} aria-label={playing ? 'Pause the story' : 'Play the story'}>
          <Icon name={playing ? 'pause' : 'play'} size={13} />
        </button>
        <div className="lp-days">
          {DAY.map((d, i) => (
            <button key={d.t} className={`lp-day ${i === sc ? 'now' : ''}`} onClick={() => { setT({ sc: i, el: 0 }); setOvr({}); setPlaying(true); }}>
              <span><i style={{ width: i < sc ? '100%' : i === sc ? `${(el / DUR) * 100}%` : '0%' }} /></span>
              <span>{d.t} · {d.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function AppPreview() {
  const [tab, setTab] = useState<Tab>('control');
  const [on, setOn] = useState<Record<string, boolean>>({ ceil: true, fan: true, ac: true });
  return (
    <section id="app" className="lp-band">
      <div className="wrap section lp-app">
        <div className="lp-app-copy">
          <div className="stack16">
            <h2 className="h2">Simple enough <span className="serif">for Ammi.</span></h2>
            <p className="lead">Big buttons, clear words, nothing to set up. Everything is already named and sorted by room when you first open it.</p>
          </div>
          <div className="lp-tabs" role="tablist" aria-label="What the app does">
            {TABS.map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} className={`lp-tab ${tab === t.id ? 'on' : ''}`} onClick={() => setTab(t.id)}>
                <span className="lp-tab-icon"><Icon name={t.icon} size={20} /></span>
                <span className="lp-tab-text"><b>{t.title}</b><span>{t.d}</span></span>
              </button>
            ))}
          </div>
        </div>
        <div className="lp-app-stage">
          <div className="lp-phone2">
            <div className="lp-screen">
              <div className="lp-status"><span>21:04</span><span className="lp-notch" /><Icon name="wifi" size={13} /></div>
              {tab === 'control' && (
                <div className="lp-pane">
                  <div className="lp-greet" style={{ padding: 0 }}><span style={{ fontSize: 12.5 }}>Khan residence</span><b style={{ fontSize: 24 }}>Living room</b></div>
                  <div className="lp-rooms">{['Living room', 'Bedroom', 'Kitchen', 'Roof'].map((r) => <span key={r}>{r}</span>)}</div>
                  <div className="lp-tiles">
                    {APP_DEVICES.map(([id, name, icon, onText]) => (
                      <Tile key={id} name={name} icon={icon} on={!!on[id]} state={onText} onClick={() => setOn((o) => ({ ...o, [id]: !o[id] }))} />
                    ))}
                  </div>
                </div>
              )}
              {tab === 'voice' && (
                <div className="lp-pane" style={{ gap: 10, padding: '12px 16px 16px' }}>
                  <b className="lp-pane-title" style={{ marginBottom: 6 }}>Ask anything</b>
                  {CHAT.map(([who, text]) => <div key={text} className="lp-bubble-row"><span className={`lp-bubble ${who}`}>{text}</span></div>)}
                  <div className="lp-listen"><span><Icon name="mic" size={26} /></span><span>Listening… Urdu or English</span></div>
                </div>
              )}
              {tab === 'family' && (
                <div className="lp-pane" style={{ gap: 12, padding: '12px 16px 16px' }}>
                  <b className="lp-pane-title" style={{ marginBottom: 4 }}>Family</b>
                  {FAMILY.map(([name, role, rooms, owner]) => (
                    <div key={name} className="lp-card">
                      <div className="lp-person"><span className={`lp-av ${owner ? 'owner' : ''}`}>{name[0]}</span><span><b>{name}</b><small>{role}</small></span></div>
                      <div className="lp-room-tags">{rooms.map((r) => <span key={r}>{r}</span>)}</div>
                    </div>
                  ))}
                </div>
              )}
              {tab === 'help' && (
                <div className="lp-pane" style={{ gap: 12, padding: '12px 16px 16px' }}>
                  <b className="lp-pane-title" style={{ marginBottom: 4 }}>Home health</b>
                  <div className="lp-alert"><i /><span><b>Kitchen is offline</b>Lights still work from the wall.</span></div>
                  <div className="lp-card">
                    <b style={{ fontSize: 13.5, fontWeight: 600 }}>What to try</b>
                    <div className="lp-try"><span>1</span>Check the kitchen’s main power is on.</div>
                    <div className="lp-try"><span>2</span>Restart your Wi‑Fi — it reconnects by itself.</div>
                  </div>
                  <div className="lp-card lp-expert"><span>UT</span><span><b>Usman, your expert</b>“Coming at 4 pm to check it.”</span></div>
                  <div className="lp-healthy"><Icon name="check" size={16} stroke={2.5} />Living room and bedrooms are healthy</div>
                </div>
              )}
              <div className="lp-tabbar">
                {TABS.map((t) => (
                  <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)} aria-label={t.title}><Icon name={t.icon} size={19} />{t.short}</button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Savings() {
  const [ac, setAc] = useState(8);
  const [lf, setLf] = useState(4);
  const [tariff, setTariff] = useState(55);
  // a rough estimate: 1.5-ton AC ≈ 1.5 units an hour (4.3 weeks a month), lights and fans ≈ 0.25 units an hour
  const units = ac * 4.3 * 1.5 + lf * 30 * 0.25;
  const month = units * tariff;
  const sliders = [
    { icon: 'snowflake', label: 'AC left on by mistake', display: `${ac} hrs a week`, min: 0, max: 30, value: ac, set: setAc },
    { icon: 'lightbulb', label: 'Lights & fans left on', display: `${lf} hrs a day`, min: 0, max: 12, value: lf, set: setLf },
    { icon: 'wallet', label: 'Your price per unit', display: `Rs ${tariff}`, min: 20, max: 90, value: tariff, set: setTariff },
  ];
  return (
    <section id="save" className="wrap section">
      <div className="lp-save">
        <div className="lp-save-inputs">
          <div className="stack16" style={{ gap: 14 }}>
            <h2 className="h2">What is left on <span className="serif">costing you?</span></h2>
            <p className="lead" style={{ fontSize: 16, maxWidth: 'none' }}>Move the sliders to match your home. Switchboard turns these off for you — by schedule, or from your phone.</p>
          </div>
          {sliders.map((s) => (
            <label key={s.label} className="lp-slider">
              <span><span><Icon name={s.icon} size={17} />{s.label}</span><b>{s.display}</b></span>
              <input type="range" min={s.min} max={s.max} step={1} value={s.value} onChange={(e) => s.set(Number(e.target.value))} aria-valuetext={s.display} />
            </label>
          ))}
        </div>
        <div className="lp-save-out" aria-live="polite">
          <div className="lp-glow" />
          <span>You could save around</span>
          <div className="lp-save-big"><b>{rupees(month)}</b><span>a month</span></div>
          <div className="lp-save-grid">
            <div><b>{rupees(month * 12)}</b><span>in a year</span></div>
            <div><b>{Math.round(units)}</b><span>units saved a month</span></div>
          </div>
          <span className="lp-fine">A rough estimate: 1.5‑ton AC ≈ 1.5 units an hour, lights and fans ≈ 0.25 units an hour. Your bill will vary.</span>
          <a href="#book" className="btn-gold">Start saving<Icon name="send" size={15} /></a>
        </div>
      </div>
    </section>
  );
}

function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section className="wrap lp-faq">
      <div className="stack16">
        <h2 className="h2">Good to know.</h2>
      </div>
      <div className="lp-faq-list">
        {FAQS.map(([q, a], i) => (
          <div key={q} className={`lp-faq-item ${open === i ? 'open' : ''}`}>
            <button onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>
              <span>{q}</span>
              <span className="lp-faq-plus"><Icon name="plus" size={15} /></span>
            </button>
            {open === i && <p>{a}</p>}
          </div>
        ))}
      </div>
    </section>
  );
}

/** "Book a free visit": saved as a visit request for the team (Console → Visit requests). */
function Book() {
  const [city, setCity] = useState('Lahore');
  const [size, setSize] = useState('10 Marla');
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setError(null);
    setState('sending');
    try {
      const res = await fetch('/api/public/visit-requests', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: f.get('name'), phone: f.get('phone'), city, homeSize: size, website: f.get('website') }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg = Array.isArray(body.message) ? body.message[0] : body.message;
        throw new Error(res.status === 429 ? 'Too many requests from here — please try again in an hour, or call us.' : msg || 'Something went wrong. Please try again.');
      }
      setState('sent');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      setState('idle');
    }
  }

  return (
    <section id="book" className="lp-book-wrap">
      <div className="lp-book">
        <div className="lp-glow" />
        <div className="lp-book-copy">
          <h2 className="h2">Let’s make <span className="serif gold">your home smarter.</span></h2>
          <p>Our expert visits, asks what you’d like to control and gives you a clear price — free, with no obligation.</p>
          <div className="lp-points">
            {['Free visit, no obligation', 'A clear price before anything starts', 'Set up in usually one day'].map((b) => (
              <span key={b}><i><Icon name="check" size={12} stroke={2.75} /></i>{b}</span>
            ))}
          </div>
        </div>
        {state === 'sent' ? (
          <div className="lp-sent" role="status">
            <span><Icon name="check" size={26} stroke={2.5} /></span>
            <b>You’re on the list.</b>
            <span>Our {city === 'Somewhere else' ? '' : `${city} `}team will call you within one working day to pick a time.</span>
            <button onClick={() => { setState('idle'); setError(null); }}>Book for another home</button>
          </div>
        ) : (
          <form className="lp-form" onSubmit={submit}>
            <div className="lp-form-row">
              <label>Name<input name="name" required maxLength={80} autoComplete="name" placeholder="Your name" /></label>
              <label>Phone<input name="phone" required type="tel" autoComplete="tel" placeholder="+92 3xx xxxxxxx" pattern="[+0-9 ()\-]{7,20}" title="A phone number, e.g. +92 300 1234567" /></label>
            </div>
            <label>City
              <select value={city} onChange={(e) => setCity(e.target.value)}>{CITIES.map((c) => <option key={c}>{c}</option>)}</select>
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 500 }} id="lp-size">Home size</span>
              <div className="lp-sizes" role="radiogroup" aria-labelledby="lp-size">
                {SIZES.map((z) => <button key={z} type="button" role="radio" aria-checked={size === z} className={size === z ? 'on' : ''} onClick={() => setSize(z)}>{z}</button>)}
              </div>
            </div>
            {/* left empty by people; bots fill it in */}
            <label className="lp-hp" aria-hidden="true">Website<input name="website" tabIndex={-1} autoComplete="off" /></label>
            {error && <div className="lp-form-error" role="alert">{error}</div>}
            <button type="submit" className="btn-gold" disabled={state === 'sending'}>{state === 'sending' ? 'Sending…' : 'Book my free visit'}</button>
            <span className="lp-form-note">We call within one working day. No spam, ever.</span>
          </form>
        )}
      </div>
    </section>
  );
}

function ThemeButton() {
  const [dark, setDark] = useState(false);
  useEffect(() => { setDark(document.documentElement.dataset.theme === 'dark'); }, []);
  return (
    <button className="lp-theme" onClick={() => setDark(toggleTheme() === 'dark')} title="Light / dark" aria-label={dark ? 'Switch to light' : 'Switch to dark'}>
      <Icon name={dark ? 'sun' : 'moon'} size={16} />
    </button>
  );
}

/* ================================================================== page */

export function Landing() {
  const [pain, setPain] = useState(0);
  const marquee = useMemo(() => [...MARQUEE, ...MARQUEE], []);

  return (
    <div className="lp" data-screen-label="Landing v2">
      <div className="lp-dark">
        <div className="lp-glow" style={{ right: '-10%', top: '-30%', width: '70%', height: '120%' }} />
        <header className="wrap lp-head">
          <a href="#top" className="lp-brand">
            <span className="lp-brand-mark"><Icon name="toggle-right" size={17} stroke={2} /></span>
            <b>Switchboard</b>
          </a>
          <nav className="lp-nav" aria-label="Sections">
            <a href="#life">Why</a><a href="#app">The app</a><a href="#save">Savings</a><a href="#how">How it works</a>
          </nav>
          <span style={{ flex: 1 }} />
          <Link href="/login" className="lp-signin">Sign in</Link>
          <a href="#book" className="lp-book-sm">Book a free visit</a>
        </header>

        <section id="top" className="wrap lp-hero">
          <div className="lp-hero-copy">
            <span className="lp-pill"><i />Now in Lahore, Karachi and Islamabad</span>
            <h1>Your home.<br /><span className="serif gold">Now it listens.</span></h1>
            <p className="lp-hero-sub">Lights, fans, AC, geyser and water motor — from your phone, by voice in Urdu or English, or on a schedule. We set it all up. Nothing at home changes.</p>
            <div className="lp-cta">
              <a href="#book" className="btn-gold">Book a free home visit<Icon name="send" size={16} /></a>
              <a href="#app" className="btn-ghost-dark"><Icon name="play" size={14} />See the app</a>
            </div>
            <div className="lp-facts">
              {[['1 day', 'to set up your home'], ['0', 'switches to replace'], ['24/7', 'we keep an eye on it']].map(([v, l]) => (
                <div key={l}><b>{v}</b><span>{l}</span></div>
              ))}
            </div>
          </div>
          <HeroStage />
        </section>

        <div className="lp-marquee" aria-hidden="true">
          <div>{marquee.map(([icon, label], i) => <span key={i}><i><Icon name={icon} size={17} /></i>{label}</span>)}</div>
        </div>
      </div>

      <section id="life" className="wrap section">
        <div className="lp-sec-head">
          <h2 className="h2">The little things <span className="serif">that happen every day.</span></h2>
        </div>
        <div className="lp-pains">
          {PAINS.map((p, i) => (
            <article key={p.q} className={`lp-pain ${pain === i ? 'on' : ''}`} onMouseEnter={() => setPain(i)}>
              <div className="lp-pain-top">
                <span className="lp-pain-icon"><Icon name={p.icon} size={24} /></span>
              </div>
              <h3>{p.q}</h3>
              <div className="lp-pain-foot">
                <span className="lp-pain-answer"><span className="lp-tick"><Icon name="check" size={13} stroke={2.75} /></span>{p.a}</span>
                <span className="lp-pain-chip"><i />{p.chip}</span>
              </div>
            </article>
          ))}
        </div>
      </section>

      <AppPreview />
      <Savings />

      <section className="lp-dark">
        <div className="wrap section" style={{ display: 'flex', flexDirection: 'column', gap: 48, paddingTop: 'clamp(72px,9vw,112px)', paddingBottom: 'clamp(72px,9vw,112px)' }}>
          <div className="lp-local-head">
            <h2 className="h2">Made for homes <span className="serif gold">in Pakistan.</span></h2>
            <p>Load-shedding, UPS, solar, water motors, Urdu — we built it for how homes here actually work.</p>
          </div>
          <div className="lp-local">
            {LOCAL.map((l) => (
              <div key={l.t}>
                <span className="lp-local-icon"><Icon name={l.icon} size={22} /></span>
                <span><b>{l.t}</b><p>{l.d}</p></span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="how" className="wrap section">
        <div className="lp-how-head">
          <div className="stack16">
            <h2 className="h2">Three steps. <span className="serif">You only do the first.</span></h2>
          </div>
          <p className="lead">Our expert handles everything else — and keeps looking after your home once it’s done.</p>
        </div>
        <div className="lp-steps">
          {STEPS.map((s) => (
            <article key={s.n} className="lp-step">
              <div className="lp-shot">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.src} alt={s.alt} loading="lazy" />
                <a className="lp-credit" href={s.href} target="_blank" rel="noreferrer">Photo: {s.credit} / Unsplash</a>
              </div>
              <div className="lp-step-body">
                <span className="lp-step-n">{s.n}</span>
                <span className="lp-step-text"><b>{s.t}</b><span>{s.d}</span><small><Icon name="clock" size={14} />{s.time}</small></span>
              </div>
            </article>
          ))}
        </div>
      </section>

      <Faq />
      <Book />

      <footer className="wrap lp-foot">
        <span className="lp-foot-brand"><span><Icon name="toggle-right" size={14} stroke={2} /></span><b style={{ fontWeight: 600 }}>Switchboard</b></span>
        <span>© {new Date().getFullYear()}</span>
        <span style={{ flex: 1 }} />
        <Link href="/signup">Become a partner</Link>
        <Link href="/login">Sign in</Link>
        <a href="#book">Contact</a>
        <ThemeButton />
      </footer>
    </div>
  );
}

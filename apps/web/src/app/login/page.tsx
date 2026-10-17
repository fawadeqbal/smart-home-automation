'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { AuthRoot, Brand, IconField, Note, PasswordField, Photo, Spinner, ThemeButton } from '@/components/auth/parts';
import { Icon } from '@/components/Icon';
import { errorText, get, post } from '@/lib/api';
import { landingFor } from '@/lib/session';
import type { Me } from '@/lib/types';

/** What a home sees during a day — the sign-in picture's moving feed (an illustration, not live data). */
const FEED = [
  { icon: 'snowflake', t: 'AC turned off', d: 'From the office', bg: '#e9eeff', fg: '#1f43d1' },
  { icon: 'droplet', t: 'Water tank full', d: 'Motor switched itself off', bg: '#e3f4ea', fg: '#116c46' },
  { icon: 'moon', t: 'Good night', d: '7 things turned off', bg: '#0f1115', fg: '#f7c46a' },
  { icon: 'sun', t: 'Geyser is ready', d: 'Warmed up at 6:30 am', bg: '#fff4dd', fg: '#985805' },
  { icon: 'lightbulb', t: 'Gate light on', d: 'It’s sunset', bg: '#fff4dd', fg: '#985805' },
];

export default function LoginPage() {
  const router = useRouter();
  const [signupOpen, setSignupOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [fresh, setFresh] = useState(true);
  const [ticket, setTicket] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState(false);

  useEffect(() => {
    get<{ setupNeeded: boolean; signupOpen: boolean }>('/auth/status')
      .then((s) => { if (s.setupNeeded) router.replace('/setup'); setSignupOpen(s.signupOpen); })
      .catch(() => undefined);
  }, [router]);

  // the feed moves on every 3.2 s: the newest card slides in at the top
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const i = setInterval(() => { setTick((n) => n + 1); setFresh(false); t = setTimeout(() => setFresh(true), 60); }, 3200);
    return () => { clearInterval(i); clearTimeout(t); };
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const r = ticket
        ? await post<Me & { recoveryLeft?: number }>('/auth/login/code', { ticket, code })
        : await post<Me | { twoFactor: true; ticket: string }>('/auth/login', { email, password });
      if ('ticket' in r && r.ticket) { setTicket(r.ticket); setBusy(false); return; }
      const me = r as Me & { recoveryLeft?: number };
      setOpening(me.staff && !me.home ? me.staff.org.name : me.home?.name ?? me.staff?.org.name ?? 'Switchboard');
      const next = new URLSearchParams(window.location.search).get('next');
      router.replace(next && next.startsWith('/') && !next.startsWith('//') ? next : landingFor(me));
    } catch (err) {
      if (ticket && /took too long|Sign in again/.test(errorText(err))) { setTicket(null); setCode(''); }
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <AuthRoot label="Sign in">
      <div className="au-split">
        <aside className="au-aside hide-sm">
          <Photo src="https://images.unsplash.com/photo-1769938018324-886021458e2b?fm=jpg&q=70&w=1600&auto=format&fit=crop"
            alt="A warm living room at night" credit="Maximilian Bungart" href="https://unsplash.com/@hypernature" />
          <div className="shade" style={{ background: 'linear-gradient(180deg,rgba(13,14,17,.75) 0%,rgba(13,14,17,.15) 38%,rgba(13,14,17,.2) 55%,rgba(13,14,17,.92) 100%)' }} />
          <Brand />
          <div className="au-feed" aria-hidden>
            {[0, 1, 2].map((k) => {
              const f = FEED[(tick + FEED.length - k) % FEED.length]!;
              const top = k === 0;
              return (
                <div key={k} style={{ opacity: top ? (fresh ? 1 : 0) : 1 - k * 0.22, transform: top && !fresh ? 'translateY(-12px) scale(.98)' : `scale(${1 - k * 0.03})` }}>
                  <span className="ic" style={{ background: f.bg, color: f.fg }}><Icon name={f.icon} size={16} /></span>
                  <span className="tx"><b>{f.t}</b><span>{f.d}</span></span>
                  <span className="when">{top ? 'Just now' : `${k * 12} min`}</span>
                </div>
              );
            })}
          </div>
          <div className="au-quote">
            <p>Your switches, your fans, your motor — on your phone.</p>
            <span>Works with the wall switches you already have.</span>
          </div>
        </aside>

        <main className="au-main">
          <div className="au-top">
            <span className="grow"><span className="only-sm"><Brand small /></span></span>
            <span className="hide-sm-inline">New to Switchboard? <Link href="/welcome#book" style={{ fontWeight: 500 }}>Book a free visit</Link></span>
            <ThemeButton />
          </div>
          <div className="au-center">
            {ticket ? (
              <form className="au-form" onSubmit={submit} style={{ gap: 18 }}>
                <div className="au-head">
                  <h1 className="au-h1 xl">One more <span className="serif">step.</span></h1>
                  <p className="au-sub">{recovery ? 'Type one of the recovery codes you saved when you turned on two-step sign-in.' : 'Open your authenticator app and type the 6-digit code for Switchboard.'}</p>
                </div>
                <IconField label={recovery ? 'Recovery code' : 'Code'} icon="key" name="code" required autoFocus autoComplete="one-time-code"
                  inputMode={recovery ? 'text' : 'numeric'} placeholder={recovery ? 'abcd-efgh' : '123 456'} maxLength={recovery ? 12 : 7}
                  value={code} onChange={(e) => { setCode(e.target.value); setError(null); }} />
                {error && <Note tone="bad" icon="alert-triangle">{error}</Note>}
                {opening && <Note tone="ok" icon="check">Signed in — opening {opening}…</Note>}
                <button type="submit" className="au-btn" disabled={busy || code.replace(/\s/g, '').length < 6}>
                  {busy ? <>Checking…<Spinner /></> : <>Sign in<Icon name="arrow-right" size={17} /></>}
                </button>
                <p className="au-foot">
                  <button type="button" className="au-link" onClick={() => { setRecovery(!recovery); setCode(''); setError(null); }}>
                    {recovery ? 'Use the app’s code instead' : 'No phone? Use a recovery code'}
                  </button>
                  {' · '}<button type="button" className="au-link" onClick={() => { setTicket(null); setCode(''); setError(null); }}>Back</button>
                </p>
                {recovery && <Note tone="dash" icon="help">Lost the phone and the codes? Your company’s super admin can turn two-step sign-in off for you.</Note>}
              </form>
            ) : (
            <form className="au-form" onSubmit={submit} style={{ gap: 18 }}>
              <div className="au-head">
                <h1 className="au-h1 xl">Welcome <span className="serif">back.</span></h1>
                <p className="au-sub">Sign in to your home — or your company’s console.</p>
              </div>
              <IconField label="Email" icon="mail" name="email" type="email" required autoComplete="email" autoFocus
                placeholder="you@example.com" value={email} onChange={(e) => { setEmail(e.target.value); setError(null); }} />
              <PasswordField value={password} onChange={(v) => { setPassword(v); setError(null); }} autoComplete="current-password" bad={!!error}
                extra={<Link className="au-link" style={{ fontSize: 13 }} href={`/forgot${email ? `?email=${encodeURIComponent(email)}` : ''}`}>Forgot it?</Link>} />
              {error && <Note tone="bad" icon="alert-triangle">{error}</Note>}
              {opening && <Note tone="ok" icon="check">Signed in — opening {opening}…</Note>}
              <button type="submit" className="au-btn" disabled={busy}>
                {busy ? <>{opening ? 'Opening…' : 'Signing in…'}<Spinner /></> : <>Sign in<Icon name="arrow-right" size={17} /></>}
              </button>
              <div className="au-or">Got an invite?</div>
              <Note tone="dash" icon="send">Open the link you got by email or WhatsApp — it signs you up in one step.</Note>
              <p className="au-foot only-sm-block">New to Switchboard? <Link href="/welcome#book" style={{ fontWeight: 600 }}>Book a free visit</Link></p>
              {signupOpen && (
                <p className="au-foot">Run an installation company? <Link href="/signup" style={{ fontWeight: 600 }}>Create an organization</Link></p>
              )}
            </form>
            )}
          </div>
        </main>
      </div>
    </AuthRoot>
  );
}

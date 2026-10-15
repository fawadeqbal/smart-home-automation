'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import { errorText, get, post } from '@/lib/api';
import { AuthRoot, Brand, Field, IconField, Note, PasswordField, Spinner, strongEnough, ThemeButton, WEAK_PASSWORD } from './parts';

/** The console preview on the left — an example of what the console shows, not real homes. */
const EXAMPLE_ROWS = [
  { home: 'Malik villa', d: 'Kitchen board offline · 2 h', a: 'Look into', dot: '#ff6369' },
  { home: 'Bahria flat 4B', d: 'Owner hasn’t joined yet', a: 'Resend', dot: '#f5a524' },
  { home: 'DHA Phase 6', d: 'Ready to hand over', a: 'Invite owner', dot: '#3ccf8e' },
];
const POINTS = [
  { icon: 'package', t: 'Boards tracked from stock to installed' },
  { icon: 'users', t: 'Installers and support, each with their own access' },
  { icon: 'activity', t: 'Know a home has a problem before they call' },
];

/**
 * "Create organization": a new installer company on a 14-day trial (mode signup), or the first run of a
 * self-hosted server (mode setup: the organization, its super admin and their own home). Both continue to
 * the company tour.
 */
export function SignupScreen({ mode }: { mode: 'signup' | 'setup' }) {
  const router = useRouter();
  const setup = mode === 'setup';
  const [status, setStatus] = useState<{ setupNeeded: boolean; signupOpen: boolean } | null>(null);
  const [org, setOrg] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    get<{ setupNeeded: boolean; signupOpen: boolean }>('/auth/status').then((s) => {
      // the first account on a fresh server goes through setup; after that, setup is closed
      if (setup && !s.setupNeeded) router.replace('/login');
      else if (!setup && s.setupNeeded) router.replace('/setup');
      setStatus(s);
    }).catch(() => setStatus({ setupNeeded: false, signupOpen: true }));
  }, [router, setup]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!strongEnough(password)) { setError(WEAK_PASSWORD); return; }
    setBusy(true); setError(null);
    try {
      if (setup) await post('/auth/setup', { homeName: org, name, email, password });
      else await post('/auth/signup', { orgName: org, name, email, password });
      router.replace('/onboarding/company');
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  const closed = !setup && status && !status.signupOpen;

  return (
    <AuthRoot label={setup ? 'Set up Switchboard' : 'Create organization'}>
      <div className="au-split">
        <aside className="au-aside hide-sm">
          <div className="halo" />
          <Brand pill={setup ? 'first run' : 'for installers'} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
            <h2 className="au-h2">Every home you install, <span className="serif periw">in one console.</span></h2>
            <div className="au-console" aria-label="Example of the console">
              <div className="hd"><b>Needs you today</b><span>Example</span></div>
              {EXAMPLE_ROWS.map((r) => (
                <div className="crow" key={r.home}>
                  <span className="cdot" style={{ background: r.dot }} />
                  <span className="tx"><b>{r.home}</b><span>{r.d}</span></span>
                  <span className="act">{r.a}</span>
                </div>
              ))}
            </div>
            <div className="au-points">
              {POINTS.map((p) => <span key={p.t}><i><Icon name={p.icon} size={16} /></i>{p.t}</span>)}
            </div>
          </div>
          <span className="au-fine">{setup ? 'Self-hosted · everything unlocked · no trial' : '14 days free · no card needed · cancel anytime'}</span>
        </aside>

        <main className="au-main">
          <div className="au-top">
            <span className="grow"><span className="only-sm"><Brand small /></span></span>
            {!setup && <span className="hide-sm-inline">Already have an account? <Link href="/login" style={{ fontWeight: 500 }}>Sign in</Link></span>}
            <ThemeButton />
          </div>
          <div className="au-center">
            {closed ? (
              <div className="au-form">
                <div className="au-head">
                  <h1 className="au-h1">Sign-up is <span className="serif">closed.</span></h1>
                  <p className="au-sub">This server doesn’t take new organizations. Ask your administrator for an invite link — it signs you up in one step.</p>
                </div>
                <Link className="au-btn" href="/login">Sign in<Icon name="arrow-right" size={17} /></Link>
                <p className="au-foot">Want Switchboard at home? <Link href="/welcome#book" style={{ fontWeight: 600 }}>Book a free visit</Link></p>
              </div>
            ) : (
              <form className="au-form wide" onSubmit={submit}>
                <div className="au-head">
                  {setup ? (
                    <>
                      <h1 className="au-h1">Set up <span className="serif">Switchboard.</span></h1>
                      <p className="au-sub">First run on this server. You become its super admin and the owner of your own home — add more homes, staff and boards later.</p>
                    </>
                  ) : (
                    <>
                      <h1 className="au-h1">Create your <span className="serif">organization.</span></h1>
                      <p className="au-sub">You’ll be its super admin. Invite installers and support once you’re in.</p>
                    </>
                  )}
                </div>
                <IconField label={setup ? 'Company or home name' : 'Company name'} icon={setup ? 'house' : 'building'} name="orgName" required maxLength={80} autoFocus
                  placeholder={setup ? 'Our home' : 'Bright Homes Automation'} value={org} onChange={(e) => setOrg(e.target.value)} />
                <div className="au-grid2">
                  <Field label="Your name" name="name" required maxLength={80} autoComplete="name" placeholder="Faraz Ali" value={name} onChange={(e) => setName(e.target.value)} />
                  <Field label={setup ? 'Email' : 'Work email'} name="email" type="email" required autoComplete="email" placeholder="you@company.pk" value={email} onChange={(e) => { setEmail(e.target.value); setError(null); }} />
                </div>
                <PasswordField value={password} onChange={(v) => { setPassword(v); setError(null); }} meter autoComplete="new-password" />
                {error && <Note tone="bad" icon="alert-triangle">{error}</Note>}
                <button type="submit" className="au-btn blue" disabled={busy || !status}>
                  {busy ? <>Creating…<Spinner /></> : <>{setup ? 'Create and continue' : 'Start 14-day free trial'}<Icon name="arrow-right" size={17} /></>}
                </button>
                {!setup && <p className="au-foot only-sm-block">Already have an account? <Link href="/login" style={{ fontWeight: 600 }}>Sign in</Link></p>}
              </form>
            )}
          </div>
        </main>
      </div>
    </AuthRoot>
  );
}

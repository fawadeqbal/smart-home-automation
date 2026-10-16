'use client';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { AuthRoot, Brand, Note, PasswordField, Spinner, strongEnough, ThemeButton, WEAK_PASSWORD } from '@/components/auth/parts';
import { Icon } from '@/components/Icon';
import { Loader } from '@/components/Loader';
import { errorText, get, post } from '@/lib/api';
import { landingFor } from '@/lib/session';
import type { Me } from '@/lib/types';

interface ResetInfo { name: string; email: string; expiresAt: string; madeByOther: boolean }

/** Choosing a new password from a link (emailed, or made by the home owner or a super admin). */
export default function ResetPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const [info, setInfo] = useState<ResetInfo | null>(null);
  const [broken, setBroken] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    get<ResetInfo>(`/auth/reset/${token}`).then(setInfo).catch((e) => setBroken(errorText(e)));
  }, [token]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!strongEnough(password)) { setError(WEAK_PASSWORD); return; }
    if (password !== again) { setError('The two passwords are not the same.'); return; }
    setBusy(true); setError(null);
    try {
      const me = await post<Me | { twoFactor: true }>(`/auth/reset/${token}`, { password });
      setDone(true);
      // with two-step sign-in on, they sign in with the new password and their code
      setTimeout(() => router.replace('twoFactor' in me && me.twoFactor === true ? `/login?changed=1` : landingFor(me as Me)), 900);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  if (broken) {
    return (
      <AuthRoot label="Password link">
        <div className="au-stage">
          <div className="glow" />
          <div className="au-top"><Brand small /><ThemeButton /></div>
          <div className="au-center">
            <div className="au-done">
              <span className="tick" style={{ background: 'var(--ons)', color: 'var(--ont)' }}><Icon name="key" size={28} /></span>
              <h1>This link can’t be used.</h1>
              <p>{broken}</p>
              <Link className="au-btn" href="/forgot" style={{ marginTop: 8, height: 50, fontSize: 15 }}>Get a new link<Icon name="arrow-right" size={16} /></Link>
              <Link className="au-link" href="/login">Back to sign in</Link>
            </div>
          </div>
        </div>
      </AuthRoot>
    );
  }
  if (!info) return <Loader full label="Opening your link…" />;

  return (
    <AuthRoot label="New password">
      <div className="au-stage">
        <div className="glow" />
        <div className="au-top"><Brand small /><ThemeButton /></div>
        <div className="au-center">
          <form className="au-form" onSubmit={submit} style={{ gap: 16 }}>
            <div className="au-head">
              <h1 className="au-h1">Hi {info.name}, choose a <span className="serif">new password.</span></h1>
              <p className="au-sub">For <b>{info.email}</b>. You’ll be signed in here, and signed out on your other devices.</p>
            </div>
            <PasswordField label="New password" value={password} onChange={(v) => { setPassword(v); setError(null); }} meter autoFocus autoComplete="new-password" />
            <PasswordField label="Type it again" name="again" value={again} onChange={(v) => { setAgain(v); setError(null); }} autoComplete="new-password"
              placeholder="The same password" bad={!!again && again !== password} />
            {error && <Note tone="bad" icon="alert-triangle">{error}</Note>}
            {done && <Note tone="ok" icon="check">Password changed. Signing you in…</Note>}
            <button type="submit" className="au-btn" disabled={busy}>
              {busy ? <>Saving…<Spinner /></> : <>Save and sign in<Icon name="arrow-right" size={17} /></>}
            </button>
            <p className="au-fine small">This link works once, until {new Date(info.expiresAt).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}.</p>
          </form>
        </div>
      </div>
    </AuthRoot>
  );
}

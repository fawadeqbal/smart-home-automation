'use client';
import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { AuthRoot, Brand, IconField, Note, Spinner, ThemeButton } from '@/components/auth/parts';
import { Icon } from '@/components/Icon';
import { errorText, post } from '@/lib/api';

/** "Forgot password?": a link by email, or (when this server sends no email) who can make one. */
export default function ForgotPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState<{ mail: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const given = new URLSearchParams(window.location.search).get('email');
    if (given) setEmail(given);
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setError(null);
    try {
      setSent(await post<{ mail: boolean }>('/auth/forgot', { email }));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthRoot label="Forgot password">
      <div className="au-stage">
        <div className="glow" />
        <div className="au-top"><Brand small /><ThemeButton /></div>
        <div className="au-center">
          {sent ? (
            <div className="au-done">
              <span className="tick" style={sent.mail ? undefined : { background: 'var(--ons)', color: 'var(--ont)' }}>
                <Icon name={sent.mail ? 'mail' : 'key'} size={28} />
              </span>
              {sent.mail ? (
                <>
                  <h1>Check your email.</h1>
                  <p>If <b>{email}</b> has a Switchboard account, a link to choose a new password is on its way. It works once, for one hour. Look in Spam too.</p>
                </>
              ) : (
                <>
                  <h1>Ask for a password link.</h1>
                  <p>This server doesn’t send email. Your <b>home owner</b> (or an admin of your home), or your <b>company’s super admin</b>, can make you a link to choose a new password: People, then your name, then <b>Password link</b>.</p>
                </>
              )}
              <Link className="au-btn" href="/login" style={{ marginTop: 8, height: 50, fontSize: 15 }}>Back to sign in<Icon name="arrow-right" size={16} /></Link>
              {sent.mail && <button type="button" className="au-link" onClick={() => setSent(null)}>Use another email</button>}
            </div>
          ) : (
            <form className="au-form" onSubmit={submit} style={{ gap: 18 }}>
              <div className="au-head">
                <h1 className="au-h1">Forgot your <span className="serif">password?</span></h1>
                <p className="au-sub">Enter the email you sign in with. We’ll send a link to choose a new one.</p>
              </div>
              <IconField label="Email" icon="mail" name="email" type="email" required autoComplete="email" autoFocus
                placeholder="you@example.com" value={email} onChange={(e) => { setEmail(e.target.value); setError(null); }} />
              {error && <Note tone="bad" icon="alert-triangle">{error}</Note>}
              <button type="submit" className="au-btn" disabled={busy}>
                {busy ? <>Sending…<Spinner /></> : <>Send the link<Icon name="send" size={16} /></>}
              </button>
              <p className="au-foot"><Link href="/login" style={{ fontWeight: 600 }}>Back to sign in</Link></p>
            </form>
          )}
        </div>
      </div>
    </AuthRoot>
  );
}

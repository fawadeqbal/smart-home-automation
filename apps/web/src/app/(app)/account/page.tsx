'use client';
import { FormEvent, useState } from 'react';
import { passwordRules, strongEnough, WEAK_PASSWORD } from '@/components/auth/parts';
import { Icon } from '@/components/Icon';
import { useCrumbs } from '@/components/Shell';
import { Avatar, ErrorBox, PageHead, useAction } from '@/components/ui';
import { post } from '@/lib/api';
import { useSession } from '@/lib/session';

/** The signed-in person's own account: who they are, and their password. */
export default function AccountPage() {
  const { me, home } = useSession();
  useCrumbs([{ label: 'Your account' }]);
  const where = [
    ...me.homes.map((h) => `${h.name} (${h.role.toLowerCase()})`),
    ...(me.staff ? [`${me.staff.org.name} (${me.staff.role === 'SUPERADMIN' ? 'super admin' : me.staff.role.toLowerCase()})`] : []),
  ];
  return (
    <div data-screen-label="Account" className="stack" style={{ maxWidth: 720 }}>
      <PageHead eyebrow={home?.name ?? me.staff?.org.name} title="Your account" sub="Your sign-in details. Only you can change your password." />
      <section className="card card-pad row" style={{ gap: 14, alignItems: 'center' }}>
        <Avatar name={me.name} />
        <div className="stack-tight grow" style={{ minWidth: 0 }}>
          <b style={{ fontSize: 16 }}>{me.name}</b>
          <span className="muted truncate">{me.email}</span>
          {where.length > 0 && <span className="small muted">{where.join(' · ')}</span>}
        </div>
      </section>
      <ChangePassword />
    </div>
  );
}

function ChangePassword() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [show, setShow] = useState(false);
  const [done, setDone] = useState(false);
  const [local, setLocal] = useState<string | null>(null);
  const { busy, error, run } = useAction();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLocal(null); setDone(false);
    if (!strongEnough(next)) { setLocal(WEAK_PASSWORD); return; }
    if (next !== again) { setLocal('The two new passwords are not the same.'); return; }
    const ok = await run(() => post('/auth/password', { current, password: next }));
    if (ok) { setDone(true); setCurrent(''); setNext(''); setAgain(''); }
  }

  const type = show ? 'text' : 'password';
  return (
    <form className="card card-pad stack" onSubmit={submit}>
      <div className="row" style={{ gap: 8 }}>
        <Icon name="key" size={17} /><b className="grow">Change password</b>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setShow(!show)}><Icon name={show ? 'eye-off' : 'eye'} size={14} />{show ? 'Hide' : 'Show'}</button>
      </div>
      <label className="field">Current password
        <input type={type} value={current} onChange={(e) => setCurrent(e.target.value)} required autoComplete="current-password" maxLength={200} />
      </label>
      <label className="field">New password
        <input type={type} value={next} onChange={(e) => setNext(e.target.value)} required autoComplete="new-password" minLength={8} maxLength={200} />
      </label>
      {next && (
        <div className="row small" style={{ gap: 12, flexWrap: 'wrap' }}>
          {passwordRules(next).map(([ok, text]) => (
            <span key={text} className={ok ? 'ok-text' : 'muted'}><Icon name={ok ? 'check' : 'x'} size={12} /> {text}</span>
          ))}
        </div>
      )}
      <label className="field">New password again
        <input type={type} value={again} onChange={(e) => setAgain(e.target.value)} required autoComplete="new-password" maxLength={200} />
      </label>
      <ErrorBox error={local ?? error} />
      {done && <div className="ok-note"><Icon name="check" size={15} /> Password changed. You’re still signed in here; other devices were signed out.</div>}
      <div className="row"><button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Change password'}</button></div>
    </form>
  );
}

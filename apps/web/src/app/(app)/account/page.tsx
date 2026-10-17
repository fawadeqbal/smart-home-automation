'use client';
import { FormEvent, useState } from 'react';
import { passwordRules, strongEnough, WEAK_PASSWORD } from '@/components/auth/parts';
import { Icon } from '@/components/Icon';
import { useCrumbs } from '@/components/Shell';
import { Avatar, ErrorBox, PageHead, useAction } from '@/components/ui';
import { del, post } from '@/lib/api';
import { useLoad } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { Sessions, TwoStep } from '@/components/account/Security';

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
      <PageHead title="Your account" sub="Your sign-in details, two-step sign-in and where you’re signed in." />
      <section className="card card-pad row" style={{ gap: 14, alignItems: 'center' }}>
        <Avatar name={me.name} />
        <div className="stack-tight grow" style={{ minWidth: 0 }}>
          <b style={{ fontSize: 16 }}>{me.name}</b>
          <span className="muted truncate">{me.email}</span>
          {where.length > 0 && <span className="small muted">{where.join(' · ')}</span>}
        </div>
      </section>
      {home && !home.readOnly && <Memories />}
      <ChangePassword />
      <TwoStep />
      <Sessions />
    </div>
  );
}

/** What this person asked the assistant to remember in this home (theirs alone). */
function Memories() {
  const list = useLoad<{ id: string; text: string; createdAt: string }[]>('/assistant/memory');
  const [text, setText] = useState('');
  const { busy, error, run } = useAction();
  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (await run(() => post('/assistant/memory', { text }))) { setText(''); void list.reload(); }
  };
  return (
    <section className="card card-pad stack">
      <div className="row" style={{ gap: 8 }}><Icon name="sparkles" size={17} /><b className="grow">What the assistant remembers</b></div>
      <p className="small muted" style={{ margin: 0 }}>Things you asked it to remember in this home, like “the store light is the one by the stairs”. Only you see these. You can also say “forget that”.</p>
      {list.data?.length === 0 && <p className="small muted" style={{ margin: 0 }}>Nothing yet. Say “remember that…” to the assistant, or add one here.</p>}
      {list.data?.map((m) => (
        <div key={m.id} className="row memory-row">
          <span className="grow">{m.text}</span>
          <button className="icon-btn" aria-label="Forget" title="Forget" onClick={() => void run(async () => { await del(`/assistant/memory/${m.id}`); await list.reload(); })}><Icon name="trash" size={14} /></button>
        </div>
      ))}
      <form className="row" style={{ gap: 8 }} onSubmit={add}>
        <input className="grow" value={text} onChange={(e) => setText(e.target.value)} maxLength={300} placeholder="e.g. Ali’s room is the upstairs bedroom" aria-label="Something to remember" />
        <button className="btn" disabled={busy || text.trim().length < 2}>Add</button>
      </form>
      <ErrorBox error={error} />
    </section>
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

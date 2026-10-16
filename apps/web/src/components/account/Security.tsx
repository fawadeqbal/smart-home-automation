'use client';
import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { Badge, ErrorBox, FormModal, Modal, useAction } from '@/components/ui';
import { del, post } from '@/lib/api';
import { timeAgo, useLoad } from '@/lib/hooks';
import { useSession } from '@/lib/session';

interface Status { enabled: boolean; since: string | null; recoveryLeft: number }
interface SessionRow { id: string; device: string; ip: string | null; createdAt: string; lastUsedAt: string; current: boolean }

/** Recovery codes, shown once: copy or download them. */
function Codes({ codes, onClose }: { codes: string[]; onClose: () => void }) {
  const text = `Switchboard recovery codes (each works once)\n\n${codes.join('\n')}\n`;
  return (
    <Modal title="Save your recovery codes" sub="If you lose your phone, each of these lets you sign in once. Keep them somewhere safe — they won’t be shown again."
           onClose={onClose} footer={<button className="btn btn-primary" onClick={onClose}>I’ve saved them</button>}>
      <div className="dialog-body stack">
        <div className="codes-grid mono">{codes.map((c) => <span key={c}>{c}</span>)}</div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn-sm" onClick={() => void navigator.clipboard?.writeText(text)}><Icon name="copy" size={14} />Copy</button>
          <a className="btn btn-sm" download="switchboard-recovery-codes.txt" href={`data:text/plain;charset=utf-8,${encodeURIComponent(text)}`}><Icon name="download" size={14} />Download</a>
        </div>
      </div>
    </Modal>
  );
}

/** Your account → two-step sign-in: on with an authenticator app, off with your password. */
export function TwoStep() {
  const { reload } = useSession();
  const s = useLoad<Status>('/auth/2fa');
  const [setup, setSetup] = useState<{ qr: string; secret: string } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [ask, setAsk] = useState<'off' | 'codes' | null>(null);
  const { busy, error, run } = useAction();
  if (!s.data) return null;
  const d = s.data;
  const start = () => run(async () => setSetup(await post<{ qr: string; secret: string }>('/auth/2fa/setup')));
  return (
    <section className="card card-pad stack">
      <div className="row" style={{ gap: 8 }}>
        <Icon name="shield" size={17} /><b className="grow">Two-step sign-in</b>
        {d.enabled ? <Badge tone="ok">On</Badge> : <Badge tone="mute">Off</Badge>}
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        {d.enabled
          ? `Signing in asks for a code from your authenticator app as well as your password. On since ${new Date(d.since!).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}; ${d.recoveryLeft} recovery code${d.recoveryLeft === 1 ? '' : 's'} left.`
          : 'Ask for a 6-digit code from an app on your phone (Google Authenticator, Microsoft Authenticator, Authy) as well as your password. Someone who learns your password still can’t get in.'}
      </p>
      <ErrorBox error={error} />
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {d.enabled ? (
          <>
            <button className="btn btn-sm" onClick={() => setAsk('codes')}>New recovery codes</button>
            <button className="btn btn-sm" onClick={() => setAsk('off')}>Turn off</button>
          </>
        ) : <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void start()}><Icon name="shield" size={14} />Turn on</button>}
      </div>

      {setup && (
        <FormModal title="Turn on two-step sign-in" submitLabel="Turn on" onClose={() => setSetup(null)}
                   onSubmit={async (f) => {
                     const r = await post<{ codes: string[] }>('/auth/2fa/enable', { code: String(f.get('code')) });
                     setSetup(null); setCodes(r.codes); await s.reload(); await reload();
                   }}>
          <ol className="small steps-list">
            <li>Open your authenticator app and add an account (usually <b>+</b>).</li>
            <li>Scan this code. Can’t scan? Type the key below.</li>
          </ol>
          <div className="qr-box"><img src={setup.qr} alt="QR code for your authenticator app" width={180} height={180} /></div>
          <p className="mono small" style={{ textAlign: 'center', margin: 0, letterSpacing: '.04em' }}>{setup.secret}</p>
          <label className="field">3. Type the 6-digit code it shows
            <input name="code" required inputMode="numeric" autoComplete="one-time-code" maxLength={7} placeholder="123 456" autoFocus />
          </label>
        </FormModal>
      )}
      {codes && <Codes codes={codes} onClose={() => setCodes(null)} />}
      {ask && (
        <FormModal title={ask === 'off' ? 'Turn off two-step sign-in?' : 'New recovery codes'} danger={ask === 'off'}
                   sub={ask === 'off' ? 'Signing in will need only your password.' : 'The old codes stop working.'}
                   submitLabel={ask === 'off' ? 'Turn off' : 'Make new codes'} onClose={() => setAsk(null)}
                   onSubmit={async (f) => {
                     const password = String(f.get('password'));
                     if (ask === 'off') { await post('/auth/2fa/disable', { password }); await reload(); }
                     else setCodes((await post<{ codes: string[] }>('/auth/2fa/codes', { password })).codes);
                     setAsk(null); await s.reload();
                   }}>
          <label className="field">Your password<input name="password" type="password" required autoComplete="current-password" autoFocus /></label>
        </FormModal>
      )}
    </section>
  );
}

/** Your account → where you're signed in: each browser and phone, and signing them out. */
export function Sessions() {
  const list = useLoad<SessionRow[]>('/auth/sessions');
  const { busy, error, run } = useAction();
  const [all, setAll] = useState(false);
  if (!list.data) return null;
  const others = list.data.filter((x) => !x.current).length;
  const shown = all ? list.data : list.data.slice(0, 5);
  return (
    <section className="card card-pad stack">
      <div className="row" style={{ gap: 8 }}><Icon name="monitor" size={17} /><b className="grow">Where you’re signed in</b></div>
      {shown.map((x) => (
        <div key={x.id} className="row session-row">
          <Icon name={/app|Android|iPhone/.test(x.device) ? 'smartphone' : 'monitor'} size={16} />
          <span className="grow stack-tight" style={{ minWidth: 0 }}>
            <b>{x.device}{x.current && <span className="ok-text small"> · this one</span>}</b>
            <span className="small muted">Last used {timeAgo(x.lastUsedAt)}{x.ip ? ` · ${x.ip}` : ''} · signed in {new Date(x.createdAt).toLocaleDateString([], { day: 'numeric', month: 'short' })}</span>
          </span>
          {!x.current && <button className="btn btn-sm" disabled={busy} onClick={() => void run(async () => { await del(`/auth/sessions/${x.id}`); await list.reload(); })}>Sign out</button>}
        </div>
      ))}
      {!all && list.data.length > 5 && <button className="link-btn" style={{ alignSelf: 'flex-start', margin: 0 }} onClick={() => setAll(true)}>Show all {list.data.length}</button>}
      <ErrorBox error={error} />
      {others > 0 && (
        <div className="row"><button className="btn btn-sm" disabled={busy} onClick={() => void run(async () => { await post('/auth/sessions/others'); await list.reload(); })}>Sign out everywhere else ({others})</button></div>
      )}
      <p className="small muted" style={{ margin: 0 }}>Something you don’t recognise? Sign it out and change your password.</p>
    </section>
  );
}

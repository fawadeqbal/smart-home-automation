'use client';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { AuthRoot, Brand, Field, firstName, initials, Note, PasswordField, Photo, Spinner, strongEnough, ThemeButton, WEAK_PASSWORD } from '@/components/auth/parts';
import { Icon } from '@/components/Icon';
import { Loader } from '@/components/Loader';
import { errorText, get, post } from '@/lib/api';
import { MATRIX, ROLE_COLUMNS, ROLE_LABEL, ROOM_ICON, STAFF_LABEL } from '@/lib/roles';
import { landingFor } from '@/lib/session';
import type { Me, Role, StaffRole } from '@/lib/types';

interface InviteInfo {
  email: string; name: string | null; role: Role | null; staffRole: StaffRole | null;
  homeName: string | null; orgName: string | null; orgLogo: string | null; inviter: string | null; expiresAt: string;
  home: { name: string; city: string; devices: number; installer: string | null; rooms: { name: string; devices: number }[] } | null;
  existingAccount: boolean; accountName: string | null;
}

/** Joining a home (owner, family) or an organization's team (installer, support, super admin). */
export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    get<InviteInfo>(`/invites/${token}`).then(setInvite).catch((e) => setError(errorText(e)));
  }, [token]);

  if (error) return <BrokenInvite message={error} />;
  if (!invite) return <Loader full label="Opening your invite…" />;
  return invite.staffRole ? <TeamInvite token={token} invite={invite} /> : <HomeInvite token={token} invite={invite} />;
}

const daysLeft = (iso: string) => Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));
const validFor = (iso: string) => { const d = daysLeft(iso); return d <= 1 ? 'Link valid until tomorrow' : `Link valid for ${d} more days`; };

function rememberHome(me: Me) {
  try { if (me.home) localStorage.setItem('home', me.home.id); } catch { /* private mode */ }
}

/* ---------------------------------------------------------------- a home: owner, admin, member, guest */
function HomeInvite({ token, invite }: { token: string; invite: InviteInfo }) {
  const router = useRouter();
  const role = invite.role ?? 'MEMBER';
  const home = invite.home;
  const [name, setName] = useState(invite.name ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const who = firstName(invite.existingAccount ? invite.accountName : name || invite.name);
  const installer = firstName(home?.installer);
  const owner = role === 'OWNER';
  const ready = !!home && home.devices > 0;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!invite.existingAccount && !strongEnough(password)) { setError(WEAK_PASSWORD); return; }
    setBusy(true); setError(null);
    try {
      const me = await post<Me>(`/invites/${token}/accept`, { name: invite.existingAccount ? undefined : name, password });
      rememberHome(me);
      router.replace(owner ? '/onboarding/home' : '/');
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <AuthRoot label="Home invite">
      <div className="au-split">
        <aside className="au-aside compact" style={{ justifyContent: 'flex-end' }}>
          <Photo src="https://images.unsplash.com/photo-1758876023053-3aa541a0935b?fm=jpg&q=70&w=1600&auto=format&fit=crop"
            alt="Relaxing at home" credit="Vitaly Gariev" href="https://unsplash.com/@silverkblack" />
          <div className="shade" style={{ background: 'linear-gradient(180deg,rgba(13,14,17,0) 30%,rgba(13,14,17,.94) 92%)' }} />
          <div className="au-ready">
            <h2>
              {role === 'GUEST' ? <>You’re invited{who ? ',' : ''} <span className="serif gold">{who ? `${who}.` : 'in.'}</span></>
                : <>Your home is <span className="serif gold">ready{who ? `, ${who}` : ''}.</span></>}
            </h2>
            {home && (
              <div className="au-homecard">
                <div className="top">
                  <span className="hi"><Icon name="house" size={20} /></span>
                  <span className="nm">
                    <b>{home.name}</b>
                    <span>{home.installer ? `Set up by ${home.installer}` : home.city || 'Your home'}{invite.orgName ? ` · ${invite.orgName}` : ''}</span>
                  </span>
                  {ready ? <span className="au-led">Ready</span> : <span className="au-led wait">Being set up</span>}
                </div>
                <div className="au-nums">
                  <div><b>{home.rooms.length}</b><span>{home.rooms.length === 1 ? 'room' : 'rooms'}</span></div>
                  <div><b>{home.devices}</b><span>{home.devices === 1 ? 'thing you can control' : 'things you can control'}</span></div>
                </div>
                {home.rooms.length > 0 && (
                  <div className="au-chips">
                    {home.rooms.slice(0, 8).map((r) => <span key={r.name}><Icon name={ROOM_ICON(r.name)} size={13} />{r.name}</span>)}
                    {home.rooms.length > 8 && <span>+{home.rooms.length - 8} more</span>}
                  </div>
                )}
              </div>
            )}
          </div>
        </aside>

        <main className="au-main">
          <div className="au-top" style={{ justifyContent: 'space-between' }}>
            <Brand small />
            <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}><span>{validFor(invite.expiresAt)}</span><ThemeButton /></span>
          </div>
          <div className="au-center">
            <form className="au-form" onSubmit={submit}>
              <span className="au-rolepill"><Icon name="key" size={14} />Invited as {ROLE_LABEL[role].toLowerCase()}</span>
              <div className="au-head">
                <h1 className="au-h1">{invite.existingAccount ? <>Welcome <span className="serif">back.</span></> : <>One last <span className="serif">step.</span></>}</h1>
                <p className="au-sub">
                  {invite.existingAccount
                    ? <>You already use Switchboard with this email. Confirm it’s you and {home?.name ?? 'the home'} is added to your account.</>
                    : <>Choose a password and your home opens.{' '}
                      {owner && installer ? (ready ? `${installer} has already set everything up.` : `${installer} is still connecting things — they show up as soon as they’re ready.`)
                        : invite.inviter ? `${firstName(invite.inviter)} invited you.` : ''}</>}
                </p>
              </div>
              {invite.existingAccount ? (
                <div className="au-who">
                  <span className="av">{initials(invite.accountName ?? invite.email)}</span>
                  <span className="nm"><b>{invite.accountName}</b><span>{invite.email}</span></span>
                  <span className="au-tag">Has an account</span>
                </div>
              ) : (
                <>
                  <Field label="Your name" name="name" required maxLength={80} autoComplete="name" autoFocus={!name} value={name} onChange={(e) => setName(e.target.value)} />
                  <div className="au-field">
                    <span>Email</span>
                    <span className="au-locked" title="The invite is for this email"><Icon name="mail" size={17} /><span>{invite.email}</span><Icon name="lock" size={14} /></span>
                  </div>
                </>
              )}
              <PasswordField label={invite.existingAccount ? 'Password' : 'Choose a password'} value={password} meter={!invite.existingAccount}
                onChange={(v) => { setPassword(v); setError(null); }} autoComplete={invite.existingAccount ? 'current-password' : 'new-password'}
                autoFocus={invite.existingAccount || !!name} bad={!!error && invite.existingAccount} />
              {error && <Note tone="bad" icon="alert-triangle">{error}</Note>}
              <button type="submit" className="au-btn amber" disabled={busy}>
                {busy ? <>Opening…<Spinner /></> : <>{owner || role === 'ADMIN' ? 'Open my home' : `Open ${home?.name ?? 'the home'}`}<Icon name="arrow-right" size={17} /></>}
              </button>
              <p className="au-foot" style={{ marginTop: 4, fontSize: 13 }}>
                Not {invite.email}? Ask {invite.inviter ? firstName(invite.inviter) : 'whoever invited you'} to invite your own email instead.
              </p>
            </form>
          </div>
        </main>
      </div>
    </AuthRoot>
  );
}

/* ---------------------------------------------------------------- an organization's team */
const TEAM_ROWS: [string, string][] = [
  ['See homes', 'See customer homes'],
  ['Board health and signal', 'Board health and signal'],
  ['Device history', 'Device history and audit log'],
  ['Switch lights and sockets', 'Switch things on or off'],
  ['Boards, pins and wiring', 'Boards, pins and rooms'],
  ['Invite people, set access', 'People and their access'],
  ['Plan and billing', 'Team, plan and billing'],
];

function canList(staffRole: StaffRole) {
  const col = ROLE_COLUMNS.findIndex((c) => c.key === staffRole);
  const rows = MATRIX.flatMap((g) => g.rows);
  return TEAM_ROWS.map(([key, text]) => {
    const cell = rows.find(([k]) => k === key)?.[1][col] ?? { t: 'none' as const };
    const ok = cell.t !== 'none';
    const tag = cell.t === 'read' ? 'Read only' : cell.t === 'scope' ? cell.label : '';
    return { ok, text, tag };
  });
}

const TEAM_BLURB: Record<StaffRole, string> = {
  SUPPORT: 'you can look into any customer home to help them, without changing anything.',
  INSTALLER: 'you set up the homes you’re given: boards, rooms and the owner’s invite.',
  SUPERADMIN: 'you run everything: homes, boards in stock, the team and billing.',
};

function TeamInvite({ token, invite }: { token: string; invite: InviteInfo }) {
  const staffRole = invite.staffRole!;
  const org = invite.orgName ?? 'the team';
  const [name, setName] = useState(invite.name ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [joined, setJoined] = useState<Me | null>(null);
  const inviter = firstName(invite.inviter) || 'Your team';

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!invite.existingAccount && !strongEnough(password)) { setError(WEAK_PASSWORD); return; }
    setBusy(true); setError(null);
    try {
      setJoined(await post<Me>(`/invites/${token}/accept`, { name: invite.existingAccount ? undefined : name, password }));
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <AuthRoot label="Team invite">
      <div className="au-stage">
        <div className="glow" />
        <div className="au-top"><Brand small /><ThemeButton /></div>
        <div className="au-center">
          {joined ? (
            <div className="au-done">
              <span className="tick"><Icon name="check" size={30} stroke={2.5} /></span>
              <h1>You’re on the team.</h1>
              <p>
                {joined.homes.length > 0
                  ? <>{org} now shows up next to your own home. Switch between them from the top of the app.</>
                  : <>You’re in {org} as {STAFF_LABEL[staffRole].toLowerCase()}. {staffRole === 'INSTALLER' ? 'The homes you’re given show up in your console.' : 'Everything is in the console.'}</>}
              </p>
              <Link className="au-btn" href={landingFor(joined)} style={{ marginTop: 8, height: 50, fontSize: 15 }}>Open the console<Icon name="arrow-right" size={16} /></Link>
            </div>
          ) : (
            <div className="au-teamcard">
              <div>
                <div className="au-faces">
                  <span className="org">{invite.orgLogo ? <img src={invite.orgLogo} alt="" /> : initials(org)}</span>
                  {invite.inviter && <span className="who" title={invite.inviter}>{initials(invite.inviter)}</span>}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <h1 className="au-h1t">{inviter} invited you to join <span className="serif">{org}.</span></h1>
                  <p style={{ fontSize: 15, color: 'var(--mu)' }}>You’ll join as <b style={{ color: 'var(--tx)' }}>{STAFF_LABEL[staffRole]}</b> — {TEAM_BLURB[staffRole]}</p>
                </div>
                <div className="au-can" aria-label="What you can do">
                  {canList(staffRole).map((c) => (
                    <div key={c.text}>
                      <span className={`mk ${c.ok ? 'ok' : ''}`}><Icon name={c.ok ? 'check' : 'x'} size={12} stroke={2.75} /></span>
                      <span className="t">{c.text}<span className="sr-only">{c.ok ? ' — allowed' : ' — not allowed'}</span></span>
                      <span className="tg">{c.tag}</span>
                    </div>
                  ))}
                </div>
              </div>
              <form onSubmit={submit}>
                <div className="au-who">
                  <span className="av">{initials(invite.accountName || name || invite.email)}</span>
                  <span className="nm"><b>{invite.accountName ?? (name || 'New account')}</b><span>{invite.email}</span></span>
                  <span className={`au-tag ${invite.existingAccount ? '' : 'new'}`}>{invite.existingAccount ? 'Has an account' : 'New'}</span>
                </div>
                {invite.existingAccount ? (
                  <p style={{ fontSize: 14.5, color: 'var(--mu)' }}>You already use Switchboard with this email. Confirm it’s you with your password.</p>
                ) : (
                  <Field label="Your name" name="name" required maxLength={80} autoComplete="name" autoFocus={!name} value={name} onChange={(e) => setName(e.target.value)} />
                )}
                <PasswordField label={invite.existingAccount ? 'Password' : 'Choose a password'} value={password} meter={!invite.existingAccount}
                  onChange={(v) => { setPassword(v); setError(null); }} autoComplete={invite.existingAccount ? 'current-password' : 'new-password'}
                  autoFocus={invite.existingAccount || !!name} bad={!!error && invite.existingAccount} />
                {error && <Note tone="bad" icon="alert-triangle">{error}</Note>}
                <button type="submit" className="au-btn" disabled={busy} style={{ height: 52 }}>
                  {busy ? <>Joining…<Spinner /></> : <>Join {org}<Icon name="arrow-right" size={17} /></>}
                </button>
                <span style={{ fontSize: 13, color: 'var(--mu)', textAlign: 'center' }}>
                  Not you? Ask {invite.inviter ? firstName(invite.inviter) : 'your admin'} to invite your own email. · {validFor(invite.expiresAt)}
                </span>
              </form>
            </div>
          )}
        </div>
      </div>
    </AuthRoot>
  );
}

/* ---------------------------------------------------------------- used, expired or wrong link */
function BrokenInvite({ message }: { message: string }) {
  return (
    <AuthRoot label="Invite">
      <div className="au-stage">
        <div className="glow" />
        <div className="au-top"><Brand small /><ThemeButton /></div>
        <div className="au-center">
          <div className="au-done">
            <span className="tick" style={{ background: 'var(--ons)', color: 'var(--ont)' }}><Icon name="key" size={28} /></span>
            <h1>This invite can’t be opened.</h1>
            <p>{message} Links work once and for 7 days. If you already joined, just sign in.</p>
            <Link className="au-btn" href="/login" style={{ marginTop: 8, height: 50, fontSize: 15 }}>Sign in<Icon name="arrow-right" size={16} /></Link>
          </div>
        </div>
      </div>
    </AuthRoot>
  );
}

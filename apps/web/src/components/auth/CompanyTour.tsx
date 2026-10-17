'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { DragEvent, useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { Loader } from '@/components/Loader';
import { errorText, get, patch, post } from '@/lib/api';
import { landingFor, useSession } from '@/lib/session';
import type { OrgDetails } from '@/lib/types';
import { AuthRoot, Brand, Field, Note, Spinner, ThemeButton, useCopy } from './parts';

const CITIES = ['Lahore', 'Karachi', 'Islamabad', 'Rawalpindi', 'Faisalabad', 'Multan', 'Peshawar'];
const TEAM_SIZES = ['Just me', '2–5', '6–20', '20+'];
const STEPS: [string, string][] = [['Your company', 'Logo, cities, team'], ['First home', 'A customer to install'], ['Your team', 'Installers and support'], ['Ready', 'Open your console']];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
type StaffRow = { email: string; role: 'INSTALLER' | 'SUPPORT' };
type Sent = { email: string; role: StaffRow['role']; path?: string; error?: string };

/** Shrinks a picked logo to a 256 px square PNG (SVGs are kept as they are when small). */
async function logoDataUrl(file: File): Promise<string> {
  if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(file.type)) throw new Error('Choose a PNG, JPG, WebP or SVG image.');
  const raw = await new Promise<string>((resolve, reject) => {
    const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => reject(new Error('Could not read that file.')); r.readAsDataURL(file);
  });
  if (file.type === 'image/svg+xml' && raw.length < 300_000) return raw;
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error('That image could not be opened.')); i.src = raw;
  });
  const size = 256;
  const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const k = Math.min(size / img.width, size / img.height);
  const w = img.width * k, h = img.height * k;
  ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
  return canvas.toDataURL('image/png');
}

export function CompanyTour() {
  const router = useRouter();
  const { me, staffRole } = useSession();
  const [org, setOrg] = useState<OrgDetails | null>(null);
  const [step, setStep] = useState(0);
  const [reached, setReached] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { copied, copy } = useCopy();

  // step 1
  const [logo, setLogo] = useState<string | null>(null);
  const [cities, setCities] = useState<string[]>([]);
  const [team, setTeam] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // step 2
  const [homeName, setHomeName] = useState('');
  const [homeCity, setHomeCity] = useState('');
  const [installer, setInstaller] = useState<'me' | 'later'>('me');
  const [ownerName, setOwnerName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [created, setCreated] = useState<{ id: string; name: string; city: string; path: string | null } | null>(null);
  // step 3
  const [staff, setStaff] = useState<StaffRow[]>([{ email: '', role: 'INSTALLER' }, { email: '', role: 'SUPPORT' }]);
  const [sent, setSent] = useState<Sent[]>([]);

  useEffect(() => {
    if (staffRole !== 'SUPERADMIN') { router.replace(landingFor(me)); return; }
    get<OrgDetails>('/platform/org').then((o) => {
      setOrg(o);
      setLogo(o.logo);
      setCities(o.cities.length ? o.cities : []);
      setTeam(o.teamSize);
      setHomeCity(o.cities[0] ?? 'Lahore');
    }).catch((e) => setError(errorText(e)));
  }, [me, router, staffRole]);

  if (!org) return error ? <Loader full label={error} /> : <Loader full label="Opening your organization…" />;

  const go = (n: number) => { setStep(n); setReached((r) => Math.max(r, n)); setError(null); window.scrollTo(0, 0); };
  const link = (path: string) => `${window.location.origin}${path}`;
  const daysLeft = org.trialEndsAt ? Math.max(0, Math.ceil((new Date(org.trialEndsAt).getTime() - Date.now()) / 86_400_000)) : null;
  const planName = org.plans.find((p) => p.id === org.plan)?.name ?? org.plan;
  const cityOptions = [...new Set([...cities, ...CITIES])];
  const readyStaff = staff.filter((s) => EMAIL.test(s.email.trim()));
  const invited = sent.filter((s) => s.path);

  async function pickLogo(file: File | undefined) {
    if (!file) return;
    setError(null);
    try { setLogo(await logoDataUrl(file)); } catch (e) { setError(errorText(e)); }
  }

  async function run(fn: () => Promise<void>) {
    setBusy(true); setError(null);
    try { await fn(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }

  const saveCompany = () => run(async () => {
    await patch('/platform/org', { logo, cities, teamSize: team });
    setOrg(await get<OrgDetails>('/platform/org'));
    if (!homeCity && cities[0]) setHomeCity(cities[0]);
    go(1);
  });

  const createHome = () => run(async () => {
    if (!homeName.trim()) throw new Error('Give the home a name — the family name works, like “Khan residence”.');
    if (ownerEmail.trim() && !EMAIL.test(ownerEmail.trim())) throw new Error('Enter the owner’s full email address, or leave it empty.');
    const r = await post<{ id: string; name: string; invite: { path: string } | null }>('/platform/homes', {
      name: homeName.trim(), city: homeCity, installerId: installer === 'me' ? me.id : null,
      owner: ownerEmail.trim() ? { email: ownerEmail.trim(), name: ownerName.trim() || undefined } : null,
    });
    setCreated({ id: r.id, name: r.name, city: homeCity, path: r.invite?.path ?? null });
    go(2);
  });

  const sendInvites = () => run(async () => {
    const results: Sent[] = [];
    for (const s of readyStaff) {
      try {
        const r = await post<{ path: string }>('/platform/staff/invites', { email: s.email.trim(), staffRole: s.role });
        results.push({ email: s.email.trim(), role: s.role, path: r.path });
      } catch (e) {
        results.push({ email: s.email.trim(), role: s.role, error: errorText(e) });
      }
    }
    setSent((x) => [...x, ...results]);
    const failed = new Set(results.filter((r) => r.error).map((r) => r.email));
    setStaff(staff.filter((s) => failed.has(s.email.trim())));
  });

  const finish = () => run(async () => {
    await patch('/platform/org', { onboarded: true });
    router.replace('/console');
  });

  const nextLabel = step === 0 ? 'Continue' : step === 1 ? (created ? 'Continue' : 'Create home') : step === 2 ? (readyStaff.length ? `Send ${readyStaff.length} invite${readyStaff.length > 1 ? 's' : ''}` : 'Continue') : 'Open console';
  function next() {
    if (step === 0) void saveCompany();
    else if (step === 1) { if (created) go(2); else void createHome(); }
    else if (step === 2) { if (readyStaff.length) void sendInvites(); else go(3); }
    else void finish();
  }

  return (
    <AuthRoot label="Company onboarding">
      <div className="au-org">
        <aside className="au-rail">
          <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}><Brand /></span>
          <nav className="au-steps" aria-label="Steps">
            {STEPS.map(([t, d], i) => {
              const done = i !== step && i < reached;
              return (
                <button key={t} onClick={() => go(i)} disabled={i > reached || busy} aria-current={i === step ? 'step' : undefined}>
                  <span className="col">
                    <span className={`n ${i === step ? 'cur' : done ? 'done' : ''}`}>{done && i !== step ? <Icon name="check" size={14} stroke={2.75} /> : i + 1}</span>
                    {i < STEPS.length - 1 && <span className="line" />}
                  </span>
                  <span className="tx"><b className={i === step ? 'cur' : ''}>{t}</b><span>{d}</span></span>
                </button>
              );
            })}
          </nav>
          <div className="au-trial">
            {org.selfHosted ? (
              <><b>Your company</b><span>No limits on homes, boards or team.</span></>
            ) : org.status === 'TRIAL' ? (
              <><b>Trial · {daysLeft === 1 ? '1 day' : `${daysLeft} days`} left</b><span>{org.limits.homes ? `Add up to ${org.limits.homes} homes and ${org.limits.staff ?? 'any number of'} team members during the trial.` : 'No limits during the trial.'}</span></>
            ) : (
              <><b>{planName} plan</b><span>{org.limits.homes ? `Up to ${org.limits.homes} homes and ${org.limits.staff ?? 'unlimited'} team members.` : 'No limits on homes, boards or team.'}</span></>
            )}
          </div>
        </aside>

        <main className="au-org-main">
          <div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 14, marginBottom: 8 }}>
              {step < 3 && <button className="au-link" style={{ color: 'var(--mu)', fontSize: 14 }} onClick={() => void finish()} disabled={busy}>Finish later</button>}
              <ThemeButton />
            </div>

            {step === 0 && (
              <div className="au-step" key="s0">
                <div className="au-step-head" style={{ gap: 10 }}>
                  <span className="au-eyebrow blue mono">Step 1 of 3</span>
                  <h1 className="au-h1o">Tell us about <span className="serif">{org.name}.</span></h1>
                  <p className="au-sub" style={{ fontSize: 16.5 }}>Customers see your logo and name in their app.</p>
                </div>
                <div className="au-logo">
                  <button type="button" className={`drop ${logo ? 'has' : ''} ${over ? 'over' : ''}`} onClick={() => fileRef.current?.click()}
                    onDragOver={(e: DragEvent) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
                    onDrop={(e: DragEvent) => { e.preventDefault(); setOver(false); void pickLogo(e.dataTransfer.files[0]); }}
                    aria-label={logo ? 'Change your logo' : 'Add your logo'}>
                    {logo ? <img src={logo} alt="Your logo" /> : <Icon name="plus" size={22} />}
                  </button>
                  <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden onChange={(e) => { void pickLogo(e.target.files?.[0]); e.target.value = ''; }} />
                  <span className="tx">
                    <b>Your logo</b>
                    <span>Click or drop a square image. PNG or SVG works best.{logo && <> · <button className="au-link" onClick={() => setLogo(null)}>Remove</button></>}</span>
                  </span>
                </div>
                <div className="au-group">
                  <b>Cities you work in</b>
                  <div className="au-roomchips">
                    {cityOptions.map((c) => {
                      const on = cities.includes(c);
                      return <button key={c} className={`au-chip lg blue ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => setCities(on ? cities.filter((x) => x !== c) : [...cities, c])}>{on && <Icon name="check" size={14} stroke={2.5} />}{c}</button>;
                    })}
                  </div>
                </div>
                <div className="au-group">
                  <b>How many people are on your team?</b>
                  <div className="au-sizes" role="radiogroup" aria-label="Team size">
                    {TEAM_SIZES.map((t) => <button key={t} role="radio" aria-checked={team === t} className={team === t ? 'on' : ''} onClick={() => setTeam(t)}>{t}</button>)}
                  </div>
                </div>
              </div>
            )}

            {step === 1 && (
              <div className="au-step" key="s1">
                <div className="au-step-head" style={{ gap: 10 }}>
                  <span className="au-eyebrow blue mono">Step 2 of 3</span>
                  <h1 className="au-h1o">Create your <span className="serif">first home.</span></h1>
                  <p className="au-sub" style={{ fontSize: 16.5 }}>A customer you’re about to install. You can add boards and rooms later.</p>
                </div>
                {created ? (
                  <Note tone="ok" icon="check">{created.name} is created. {created.path ? 'Its owner’s invite link is waiting on the last step.' : ''}</Note>
                ) : org.usage.homes > 0 ? (
                  <Note tone="info" icon="house">You already have {org.usage.homes} {org.usage.homes === 1 ? 'home' : 'homes'}. Add another one here, or skip this step.</Note>
                ) : null}
                <div className="au-cols">
                  <div className="stack">
                    <Field label="Home name" value={homeName} onChange={(e) => setHomeName(e.target.value)} placeholder="Khan residence" maxLength={80} disabled={!!created} autoFocus />
                    <div className="au-grid2" style={{ gridTemplateColumns: '1fr 1fr' }}>
                      <label className="au-field">City
                        <select value={homeCity} onChange={(e) => setHomeCity(e.target.value)} disabled={!!created}>
                          {cityOptions.map((c) => <option key={c}>{c}</option>)}
                        </select>
                      </label>
                      <label className="au-field">Installer
                        <select value={installer} onChange={(e) => setInstaller(e.target.value as 'me' | 'later')} disabled={!!created}>
                          <option value="me">Me</option><option value="later">Choose later</option>
                        </select>
                      </label>
                    </div>
                    <Field label="Owner’s name" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="Ayesha Khan" maxLength={80} disabled={!!created} />
                    <Field label="Owner’s email" hint="— optional, for their invite link" type="email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} placeholder="ayesha@gmail.com" disabled={!!created} />
                  </div>
                  <div className="au-preview" aria-label="Preview">
                    <span className="lbl mono">Preview in your console</span>
                    <div className="hd">
                      <span className="hi"><Icon name="house" size={21} /></span>
                      <span className="nm"><b>{(created?.name ?? homeName.trim()) || 'New home'}</b><span>{homeCity} · Owner {ownerName.trim() || ownerEmail.trim() || '—'}</span></span>
                    </div>
                    <div className="steps">
                      {['Home created', 'Boards assigned', 'Devices named', 'Rooms arranged', 'Handed over to owner'].map((t, i) => {
                        const ok = i === 0 && !!created;
                        return <span key={t} className={ok ? 'ok' : ''}><i>{ok ? '✓' : i + 1}</i>{t}</span>;
                      })}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="au-step" key="s2">
                <div className="au-step-head" style={{ gap: 10 }}>
                  <span className="au-eyebrow blue mono">Step 3 of 3</span>
                  <h1 className="au-h1o">Invite <span className="serif">your team.</span></h1>
                  <p className="au-sub" style={{ fontSize: 16.5 }}>Each role only sees what it needs. You get a link to send each person — change roles anytime.</p>
                </div>
                <div className="au-roles">
                  <div><span className="ri" style={{ background: 'var(--ons)', color: 'var(--ont)' }}><Icon name="wrench" size={19} /></span><span className="tx"><b>Installer</b><span>Sets up the homes you give them: boards, rooms and the owner invite.</span></span></div>
                  <div><span className="ri" style={{ background: 'var(--acs)', color: 'var(--act)' }}><Icon name="shield" size={19} /></span><span className="tx"><b>Support</b><span>Looks into any home to help owners. Can’t change anything.</span></span></div>
                </div>
                {sent.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} aria-live="polite">
                    {sent.map((s) => (
                      <div key={s.email + (s.path ?? '')} className={`au-sent ${s.error ? 'bad' : ''}`}>
                        <Icon name={s.error ? 'alert-triangle' : 'check'} size={17} stroke={2.5} />
                        <span className="who"><b>{s.email}</b><span>{s.error ?? `${s.role === 'INSTALLER' ? 'Installer' : 'Support'} · invite ready`}</span></span>
                        {s.path && <button className="au-btn sm" onClick={() => void copy(link(s.path!))}><Icon name="copy" size={14} />{copied === link(s.path) ? 'Copied' : 'Copy link'}</button>}
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {staff.map((s, i) => (
                    <div className="au-staffrow" key={i}>
                      <span className="au-input">
                        <span className="ic"><Icon name="mail" size={16} /></span>
                        <input type="email" value={s.email} onChange={(e) => setStaff(staff.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)))} placeholder="name@company.pk" aria-label="Email" />
                      </span>
                      <span className="au-seg lg" role="radiogroup" aria-label="Role">
                        {(['INSTALLER', 'SUPPORT'] as const).map((r) => (
                          <button key={r} role="radio" aria-checked={s.role === r} className={s.role === r ? 'on' : ''}
                            onClick={() => setStaff(staff.map((x, j) => (j === i ? { ...x, role: r } : x)))}>{r === 'INSTALLER' ? 'Installer' : 'Support'}</button>
                        ))}
                      </span>
                      <button className="au-x" style={{ width: 40, height: 40 }} onClick={() => setStaff(staff.filter((_, j) => j !== i))} aria-label="Remove" title="Remove"><Icon name="x" size={16} /></button>
                    </div>
                  ))}
                  <button className="au-plus" onClick={() => setStaff([...staff, { email: '', role: 'INSTALLER' }])}><Icon name="plus" size={16} />Add {staff.length ? 'another' : 'someone'}</button>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="au-step" key="s3">
                <span className="au-bluetick"><Icon name="check" size={34} stroke={2.5} /></span>
                <div className="au-step-head" style={{ gap: 10 }}>
                  <h1 className="au-h1o" style={{ fontSize: 'clamp(34px, 4.4vw, 54px)', lineHeight: 1.02 }}>{org.name} <span className="serif">is ready.</span></h1>
                  <p className="au-sub" style={{ fontSize: 16.5 }}>Here’s what happens next.</p>
                </div>
                <div className="au-list">
                  <div>
                    <span className="lic on"><Icon name="house" size={19} /></span>
                    <span className="tx">
                      <b>{created?.name ?? (org.usage.homes ? `${org.usage.homes} ${org.usage.homes === 1 ? 'home' : 'homes'}` : 'Your first home')}</b>
                      <span>{created ? `${created.city} · waiting for boards${created.path ? ' · send the owner their link when it’s ready' : ''}` : 'Add one from Homes whenever you’re ready'}</span>
                    </span>
                    {created?.path ? <button className="au-btn sm" style={{ background: 'var(--sf)', color: 'var(--tx)', border: '1px solid var(--ln2)' }} onClick={() => void copy(link(created.path!))}><Icon name="copy" size={14} />{copied === link(created.path) ? 'Copied' : 'Owner link'}</button>
                      : <span className={`tg ${created ? 'ok' : ''}`}>{created ? 'Created' : 'Later'}</span>}
                  </div>
                  <div>
                    <span className="lic blue"><Icon name="users" size={19} /></span>
                    <span className="tx"><b>{invited.length ? `${invited.length} team invite${invited.length > 1 ? 's' : ''} ready` : 'No team invites yet'}</b><span>{invited.length ? 'Each link works once, for 7 days' : 'Invite installers and support from Team anytime'}</span></span>
                    <span className={`tg ${invited.length ? 'ok' : ''}`}>{invited.length ? 'Sent' : 'Later'}</span>
                  </div>
                  <Link href="/console/inventory" style={{ color: 'inherit' }}>
                    <span className="lic"><Icon name="package" size={19} /></span>
                    <span className="tx"><b>Add boards to stock</b><span>Type the ID printed on each board, then assign them to homes</span></span>
                    <span className="tg on">Next</span>
                  </Link>
                </div>
              </div>
            )}

            {error && <div style={{ marginTop: 24 }}><Note tone="bad" icon="alert-triangle">{error}</Note></div>}

            <div className="au-org-foot">
              <button className="au-btn ghost" onClick={() => go(step - 1)} style={{ visibility: step > 0 && step < 3 ? 'visible' : 'hidden', margin: 0 }} disabled={busy}>
                <Icon name="arrow-left" size={16} />Back
              </button>
              <span className="r">
                {(step === 1 || step === 2) && !busy && <button className="au-skip" onClick={() => go(step + 1)}>Skip</button>}
                <button className="au-btn blue" onClick={next} disabled={busy}>
                  {busy ? <>{step === 3 ? 'Opening…' : 'Saving…'}<Spinner /></> : <>{nextLabel}<Icon name="arrow-right" size={16} /></>}
                </button>
              </span>
            </div>
          </div>
        </main>
      </div>
    </AuthRoot>
  );
}

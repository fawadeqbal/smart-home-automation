'use client';
import { InputHTMLAttributes, ReactNode, useEffect, useState } from 'react';
import { Icon, toggleTheme } from '@/components/Icon';
import './auth.css';

/** Same list and rules as the API (apps/api/src/auth/auth.controller.ts), so the ticks match what the server accepts. */
const COMMON_PASSWORDS = ['password', 'password1', '12345678', '123456789', '1234567890', '11111111', '00000000', 'qwertyui',
  'qwerty123', 'iloveyou', 'abc12345', 'switchboard', 'pakistan', 'pakistan1', 'pakistan123', 'welcome1'];

export function passwordRules(pw: string): [boolean, string][] {
  return [
    [pw.length >= 8, '8+ characters'],
    [/[\d\W_]/.test(pw), 'A number or symbol'],
    [pw.length > 0 && !COMMON_PASSWORDS.includes(pw.toLowerCase()), 'Not a common password'],
  ];
}
export const strongEnough = (pw: string) => passwordRules(pw).every(([ok]) => ok);
export const WEAK_PASSWORD = 'Choose a stronger password — tick all three boxes.';

export const initials = (name: string) =>
  name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';
export const firstName = (name: string | null | undefined) => (name ?? '').trim().split(/\s+/)[0] ?? '';

/** The scoped root every auth and tour screen sits in. */
export function AuthRoot({ label, children }: { label: string; children: ReactNode }) {
  return <div className="au" data-screen-label={label}>{children}</div>;
}

export function Brand({ small, pill }: { small?: boolean; pill?: string }) {
  return (
    <span className={`au-brand ${small ? 'sm' : ''}`}>
      <span><Icon name="toggle-right" size={small ? 15 : 17} stroke={2} /></span>
      <b>Switchboard</b>
      {pill && <span className="au-pill-ink">{pill}</span>}
    </span>
  );
}

export function ThemeButton() {
  // read after mounting: the server can't know the theme, and the first render must match it
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.dataset.theme === 'dark'), []);
  return (
    <button type="button" className="au-theme" onClick={() => setDark(toggleTheme() === 'dark')}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'} title="Light / dark">
      <Icon name={dark ? 'sun' : 'moon'} size={15} />
    </button>
  );
}

/** A labelled input with an icon on the left. */
export function IconField({ label, icon, extra, bad, ...input }: { label: ReactNode; icon: string; extra?: ReactNode; bad?: boolean } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="au-field">
      {extra ? <span className="lbl">{label}{extra}</span> : label}
      <span className={`au-input ${bad ? 'bad' : ''}`}>
        <span className="ic"><Icon name={icon} size={17} /></span>
        <input {...input} />
      </span>
    </label>
  );
}

export function Field({ label, hint, ...input }: { label: ReactNode; hint?: ReactNode } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="au-field">
      <span>{label}{hint && <> <span className="hint">{hint}</span></>}</span>
      <input {...input} />
    </label>
  );
}

/** Password with show/hide, and (for new passwords) the strength bars and the three rules. */
export function PasswordField({ label = 'Password', value, onChange, meter, extra, bad, autoComplete, placeholder, autoFocus, name = 'password' }: {
  label?: ReactNode; value: string; onChange: (v: string) => void; meter?: boolean; extra?: ReactNode; bad?: boolean;
  autoComplete: string; placeholder?: string; autoFocus?: boolean; name?: string;
}) {
  const [show, setShow] = useState(false);
  const rules = passwordRules(value);
  const score = rules.filter(([ok]) => ok).length;
  const color = score === 3 ? 'var(--ok)' : score === 2 ? 'var(--on)' : 'var(--bad)';
  return (
    <>
      <label className="au-field">
        {extra ? <span className="lbl">{label}{extra}</span> : label}
        <span className={`au-input eye ${bad ? 'bad' : ''}`}>
          <span className="ic"><Icon name="lock" size={17} /></span>
          <input type={show ? 'text' : 'password'} name={name} value={value} onChange={(e) => onChange(e.target.value)} required
            autoComplete={autoComplete} placeholder={placeholder ?? (meter ? '8 characters or more' : 'Your password')} autoFocus={autoFocus}
            minLength={meter ? 8 : undefined} maxLength={200} aria-invalid={bad || undefined} />
          <button type="button" className="peek" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'} title={show ? 'Hide password' : 'Show password'}>
            <Icon name={show ? 'eye-off' : 'eye'} size={17} />
          </button>
        </span>
      </label>
      {meter && (
        <div className="au-meter" aria-live="polite">
          <div className="mbars" aria-hidden>{[0, 1, 2].map((i) => <span key={i} style={{ background: value && i < score ? color : undefined }} />)}</div>
          <div className="rules">
            {rules.map(([ok, text]) => (
              <span key={text} className={ok ? 'ok' : ''}><Icon name={ok ? 'check' : 'x'} size={13} stroke={2.5} />{text}<span className="sr-only">{ok ? ' — done' : ' — not yet'}</span></span>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

export function Note({ tone, icon, children }: { tone: 'info' | 'bad' | 'ok' | 'warn' | 'dash'; icon: string; children: ReactNode }) {
  return (
    <div className={`au-note ${tone}`} role={tone === 'bad' ? 'alert' : tone === 'ok' ? 'status' : undefined}>
      <Icon name={icon} size={17} stroke={tone === 'ok' ? 2.5 : 1.75} /><span>{children}</span>
    </div>
  );
}

/** A photo from Unsplash, with its credit (their licence asks for none, we give it anyway). */
export function Photo({ src, alt, credit, href }: { src: string; alt: string; credit: string; href: string }) {
  return (
    <>
      <div className="photo"><img src={src} alt={alt} loading="eager" decoding="async" /></div>
      <span className="credit">Photo: <a href={href} target="_blank" rel="noreferrer">{credit}</a> / Unsplash</span>
    </>
  );
}

export function Spinner() {
  return <span className="spin"><Icon name="rotate" size={17} /></span>;
}

/** Copy text, with a short "Copied" confirmation. */
export function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); } catch {
      const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select();
      try { document.execCommand('copy'); } finally { t.remove(); }
    }
    setCopied(text);
    setTimeout(() => setCopied((c) => (c === text ? null : c)), 1800);
  }
  return { copied, copy };
}

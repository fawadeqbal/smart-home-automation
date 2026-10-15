'use client';
import { FormEvent, ReactNode, useState } from 'react';
import { errorText } from '@/lib/api';
import { Icon, toggleTheme } from './Icon';

/** Shared card + submit handling for login, setup and invite pages. */
export function AuthForm({ title, intro, submitLabel, onSubmit, children, footer }: {
  title: string;
  intro?: ReactNode;
  submitLabel: string;
  onSubmit: (form: FormData) => Promise<void>;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit(new FormData(e.currentTarget));
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-side-wrap">
        <aside className="auth-side">
          <span className="side-brand"><span className="brand-mark"><Icon name="toggle-right" size={16} stroke={2} /></span><b>Switchboard</b></span>
          <div className="stack" style={{ gap: 24 }}>
            <div className="auth-statement">Every switch in every home, one console.</div>
            <div className="auth-points">
              <span><Icon name="package" size={16} />Boards from stock to switchboard, tracked</span>
              <span><Icon name="activity" size={16} />See which home needs you, before they call</span>
              <span><Icon name="users" size={16} />Owners and families get their own app</span>
            </div>
          </div>
          <div className="auth-foot">Smart switchboards · for installers and homes</div>
        </aside>
      </div>
      <main className="auth-main">
        <div className="auth-top">
          <button type="button" className="icon-btn" onClick={toggleTheme} aria-label="Switch light or dark mode"><Icon name="moon" size={16} /></button>
        </div>
        <div className="auth-center">
          <div className="auth-card">
            <div className="stack-tight">
              <h1>{title}</h1>
              {intro && <p className="muted">{intro}</p>}
            </div>
            <form onSubmit={submit}>
              {children}
              {error && <div className="alert" role="alert">{error}</div>}
              <button className="btn btn-primary btn-lg" disabled={busy}>{busy ? 'Please wait…' : submitLabel}</button>
            </form>
            {footer && <div className="auth-alt">{footer}</div>}
          </div>
        </div>
      </main>
    </div>
  );
}

export function Field({ label, ...input }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="field">
      {label}
      <input {...input} />
    </label>
  );
}

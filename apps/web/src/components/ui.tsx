'use client';
/** Small building blocks of the Switchboard design system. */
import { FormEvent, ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { errorText } from '@/lib/api';
import type { Tone } from '@/lib/types';
import { Icon } from './Icon';

export function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';
}

/** Avatar colour by role label or key: super admin ink, installer green, support blue, owners amber. */
export function avatarClass(role: string | null | undefined) {
  const r = (role ?? '').toLowerCase();
  if (r.includes('super')) return 'av-superadmin';
  if (r.includes('install')) return 'av-installer';
  if (r.includes('support')) return 'av-support';
  if (r.includes('owner') || r === 'admin' || r.includes('home admin')) return 'av-owner';
  if (r.includes('automatic') || r.includes('system')) return 'av-system';
  return 'av-member';
}

export function Avatar({ name, role, size = '' }: { name: string; role?: string | null; size?: '' | 'sm' | 'xs' }) {
  return <span className={`avatar ${size} ${avatarClass(role)}`} aria-hidden>{name === 'System' ? 'SB' : initials(name)}</span>;
}

export function Badge({ tone = 'mute', children, plain = false }: { tone?: Tone; children: ReactNode; plain?: boolean }) {
  return <span className={`badge ${tone} ${plain ? 'plain' : ''}`}>{children}</span>;
}

export function Dot({ tone, lg = false, title }: { tone: Tone; lg?: boolean; title?: string }) {
  return <span className={`sdot ${tone} ${lg ? 'lg' : ''}`} title={title} />;
}

export function PageHead({ title, sub, actions }: { eyebrow?: ReactNode; title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="ph">
      <div className="ph-text">
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {actions && <div className="ph-actions">{actions}</div>}
    </div>
  );
}

export function Seg<T extends string>({ options, value, onChange }: {
  options: { id: T; label: ReactNode; n?: number; icon?: string }[]; value: T; onChange: (v: T) => void;
}) {
  return (
    <div className="seg-group" role="tablist">
      {options.map((o) => (
        <button key={o.id} type="button" role="tab" aria-selected={o.id === value} className={`seg-btn ${o.id === value ? 'active' : ''}`} onClick={() => onChange(o.id)}>
          {o.icon && <Icon name={o.icon} size={14} />}{o.label}{o.n !== undefined && <span className="n">{o.n}</span>}
        </button>
      ))}
    </div>
  );
}

export function Kpi({ label, value, sub, fg, unit, chip, small = false }: {
  label: ReactNode; value: ReactNode; sub?: ReactNode; fg?: string; unit?: string; chip?: { icon: string; tone: string }; small?: boolean;
}) {
  return (
    <div className={`kpi ${small ? 'sm' : ''}`}>
      <span className="kpi-label">{chip && <span className={`kpi-chip tone-${chip.tone}`}><Icon name={chip.icon} size={13} /></span>}{label}</span>
      <span className={`kpi-value ${fg ?? ''}`}>{value}{unit && <span className="kpi-unit">{unit}</span>}</span>
      {sub !== undefined && <span className="kpi-sub">{sub}</span>}
    </div>
  );
}

/** Runs an async action with a busy flag and an error message. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (err) {
      setError(errorText(err));
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, setError, run };
}

/** A modal dialog. Closes on Escape and on a click outside. */
export function Modal({ title, sub, onClose, children, footer, wide = false, className = '' }: {
  title: ReactNode; sub?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean; className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    const prev = document.activeElement as HTMLElement | null;
    box.current?.querySelector<HTMLElement>('input, select, textarea, button:not(.icon-btn)')?.focus();
    return () => { window.removeEventListener('keydown', key); prev?.focus?.(); };
  }, [onClose]);
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={box} className={`dialog ${wide ? 'wide' : ''} ${className}`} role="dialog" aria-modal="true">
        <div className="dialog-head">
          <div className="grow"><h2>{title}</h2>{sub && <p>{sub}</p>}</div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" size={16} /></button>
        </div>
        {children}
        {footer && <div className="dialog-foot">{footer}</div>}
      </div>
    </div>
  );
}

/** A modal with a form: submit runs `onSubmit`; errors show inside; closes when it resolves. */
export function FormModal({ title, sub, submitLabel, onSubmit, onClose, children, wide, danger = false, done }: {
  title: ReactNode; sub?: ReactNode; submitLabel: string; onSubmit: (form: FormData) => Promise<unknown>; onClose: () => void;
  children: ReactNode; wide?: boolean; danger?: boolean; done?: ReactNode;
}) {
  const { busy, error, run } = useAction();
  const [finished, setFinished] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const ok = await run(async () => { await onSubmit(form); return true; });
    // a dialog given `done` (even while it is still null) stays open and shows it afterwards
    if (ok) { if (done !== undefined) setFinished(true); else onClose(); }
  }
  if (finished && done !== undefined) {
    return (
      <Modal title={title} onClose={onClose} wide={wide} footer={<button className="btn btn-primary" onClick={onClose}>Done</button>}>
        <div className="dialog-body">{done}</div>
      </Modal>
    );
  }
  return (
    <Modal title={title} sub={sub} onClose={onClose} wide={wide}>
      <form onSubmit={submit}>
        <div className="dialog-body">
          {children}
          {error && <div className="alert" role="alert">{error}</div>}
        </div>
        <div className="dialog-foot">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className={`btn ${danger ? 'btn-danger-solid' : 'btn-primary'}`} disabled={busy}>{busy ? 'Please wait…' : submitLabel}</button>
        </div>
      </form>
    </Modal>
  );
}

/** Asks before something that cannot be undone. */
export function Confirm({ title, body, confirmLabel = 'Confirm', danger = true, onConfirm, onClose }: {
  title: ReactNode; body: ReactNode; confirmLabel?: string; danger?: boolean; onConfirm: () => Promise<unknown>; onClose: () => void;
}) {
  return (
    <FormModal title={title} submitLabel={confirmLabel} danger={danger} onSubmit={onConfirm} onClose={onClose}>
      <div style={{ fontSize: 13.5, lineHeight: 1.5 }}>{body}</div>
    </FormModal>
  );
}

/** A link to copy (invite links). */
export function CopyField({ value, label = 'Copy link' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="copy-row">
      <input readOnly value={value} onFocus={(e) => e.currentTarget.select()} aria-label="Link" />
      <button type="button" className="btn" onClick={async () => {
        try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* select instead */ }
      }}><Icon name={copied ? 'check' : 'copy'} size={14} />{copied ? 'Copied' : label}</button>
    </div>
  );
}

/** Opens WhatsApp (app or web) with the message ready; the person picks who to send it to. */
export function WhatsAppShare({ text, label = 'Send on WhatsApp', small = false }: { text: string; label?: string; small?: boolean }) {
  return (
    <a className={`btn btn-wa ${small ? 'btn-sm' : ''}`} href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer noopener">
      <Icon name="send" size={14} />{label}
    </a>
  );
}

/** A dropdown that closes on an outside click or Escape. */
export function Dropdown({ trigger, children, align = 'left', width }: {
  trigger: (open: boolean, toggle: () => void) => ReactNode; children: (close: () => void) => ReactNode; align?: 'left' | 'right'; width?: number | string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const click = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', click);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', click); document.removeEventListener('keydown', key); };
  }, [open]);
  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block', verticalAlign: 'middle' }}>
      {trigger(open, () => setOpen((o) => !o))}
      {open && (
        <div className="menu" style={{ [align]: 0, top: 'calc(100% + 6px)', width }}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

/** A board's firmware, with the newer version next to it when it is behind. */
export function FirmwareCell({ version, latest, old }: { version: string | null; latest?: string | null; old: boolean }) {
  if (!version) return <span className="fg-mu">—</span>;
  return (
    <span className="fw-cell" title={old && latest ? `Update available: ${latest}` : 'Up to date'}>
      <span className={old ? 'fg-warn' : 'fg-mu'}>{version}</span>
      {old && latest && <span className="fw-cell-new"><Icon name="arrow-up" size={11} stroke={2.4} />{latest}</span>}
    </span>
  );
}

export function Empty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return <div className="empty">{children}{action && <div>{action}</div>}</div>;
}

export function ErrorBox({ error }: { error: string | null }) {
  return error ? <div className="alert" role="alert">{error}</div> : null;
}

/** Absolute URL for an invite path from the API. */
export const inviteUrl = (path: string) => (typeof window === 'undefined' ? path : `${window.location.origin}${path}`);

'use client';
import Link from 'next/link';
import { ReactNode, useState } from 'react';
import { Icon } from './Icon';

/** Small ⓘ next to a word; tap or hover to read what it means. */
export function Tip({ children, label = 'What is this?' }: { children: ReactNode; label?: string }) {
  return (
    <span className="tip">
      <button type="button" className="tip-btn" aria-label={label}>i</button>
      <span className="tip-body" role="tooltip">{children}</span>
    </span>
  );
}

/** "How this page works" box. Hidden until the person presses the Help button on that page. */
export function PageHelp({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const set = (v: boolean) => setOpen(v);
  void id;
  return (
    <>
      <button type="button" className={`help-toggle ${open ? 'active' : ''}`} onClick={() => set(!open)}
              aria-expanded={open} title="How this page works">
        <Icon name="help-circle" size={18} />Help
      </button>
      {open && (
        <div className="page-help" role="note">
          <div className="spread">
            <b>{title}</b>
            <button type="button" className="icon-btn" aria-label="Hide help" onClick={() => set(false)}><Icon name="x" size={16} /></button>
          </div>
          <div className="page-help-body">{children}</div>
          <Link href="/help" className="small">More help and examples →</Link>
        </div>
      )}
    </>
  );
}


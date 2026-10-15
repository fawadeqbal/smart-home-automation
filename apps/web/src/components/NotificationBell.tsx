'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { timeAgo } from '@/lib/hooks';
import { useNotifications } from '@/lib/notifications';
import { useSession } from '@/lib/session';
import { Icon } from './Icon';

const SEV_ICON: Record<string, string> = { ALERT: 'alert-triangle', WARN: 'activity', INFO: 'bell' };

/** Bell with the unread count, and a small panel with the latest notices. */
export function NotificationBell({ className = 'icon-btn' }: { className?: string }) {
  const { items, unread, markAllRead, markRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const open_ = useOpenLink();

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  return (
    <div className="bell-wrap" ref={box}>
      <button className={`${className} bell`} onClick={() => setOpen((v) => !v)} aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} aria-expanded={open}>
        <Icon name="bell" size={className.includes('lg') ? 19 : 17} />
        {unread > 0 && <span className="bell-badge">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="bell-panel" role="dialog" aria-label="Notifications">
          <div className="spread bell-head">
            <b>Notifications</b>
            {unread > 0 && <button className="link-btn small" onClick={() => void markAllRead()}>Mark all read</button>}
          </div>
          <div className="bell-list">
            {items.length === 0 && <p className="muted small" style={{ padding: 16 }}>Nothing yet. You’ll be told here about leaks, doors at night, boards going offline and more.</p>}
            {items.slice(0, 12).map((n) => (
              <button key={n.id} className={`bell-item sev-${n.severity} ${n.readAt ? '' : 'unread'}`} onClick={() => {
                if (!n.readAt) void markRead(n.id);
                setOpen(false);
                if (n.link) void open_(n.link);
              }}>
                <span className="bell-icon"><Icon name={SEV_ICON[n.severity] ?? 'help'} size={14} /></span>
                <span className="stack-tight">
                  <b>{n.title}</b>
                  <span className="small muted">{n.body}</span>
                  <span className="small muted">{timeAgo(n.createdAt)}</span>
                </span>
              </button>
            ))}
          </div>
          <Link href="/notifications" className="bell-foot" onClick={() => setOpen(false)}>All notifications & settings</Link>
        </div>
      )}
    </div>
  );
}

/** Live notices in the corner of the screen. */
/** Opens a notice's link; a link into another home (?home=…) switches to that home first. */
export function useOpenLink() {
  const router = useRouter();
  const { home, switchHome } = useSession();
  return async (link: string) => {
    const url = new URL(link, window.location.origin);
    const target = url.searchParams.get('home');
    if (target && target !== home?.id) await switchHome(target).catch(() => undefined);
    url.searchParams.delete('home');
    router.push(url.pathname + (url.search || ''));
  };
}

export function NoticeToasts() {
  const { toasts, dismissToast, markRead } = useNotifications();
  const open = useOpenLink();
  if (!toasts.length) return null;
  return (
    <div className="toasts" aria-live="assertive">
      {toasts.map((n) => (
        <div key={n.id} className={`toast ${n.severity === 'INFO' ? 'ok' : 'bad'} sev-${n.severity}`} role={n.severity === 'ALERT' ? 'alert' : 'status'}>
          <span className={`live-dot ${n.severity === 'INFO' ? '' : 'off'}`} />
          <div className="toast-body">
            <b>{n.title}</b>
            <span>{n.body} {n.link && <button className="link-btn small" onClick={() => { void markRead(n.id); dismissToast(n.id); void open(n.link!); }}>Open</button>}</span>
          </div>
          <button className="icon-btn" aria-label="Close" onClick={() => dismissToast(n.id)}><Icon name="x" size={14} /></button>
        </div>
      ))}
    </div>
  );
}

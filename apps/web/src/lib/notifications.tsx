'use client';
import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { get, post } from './api';
import { useLive } from './live';

export interface Notice {
  id: string;
  kind: string;
  severity: 'INFO' | 'WARN' | 'ALERT';
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

interface Ctx {
  items: Notice[];
  unread: number;
  toasts: Notice[];
  dismissToast: (id: string) => void;
  markAllRead: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
}
const NotificationsContext = createContext<Ctx | null>(null);

/** Loads my notices, adds new ones live, shows a toast and (if allowed) a desktop/phone notification. */
export function NotificationsProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Notice[]>([]);
  const [unread, setUnread] = useState(0);
  const [toasts, setToasts] = useState<Notice[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const load = useCallback(() => get<{ unread: number; items: Notice[] }>('/notifications')
    .then((r) => { setItems(r.items); setUnread(r.unread); }).catch(() => undefined), []);
  useEffect(() => { void load(); }, [load]);

  const dismissToast = useCallback((id: string) => {
    setToasts((t) => t.filter((x) => x.id !== id));
    clearTimeout(timers.current.get(id));
  }, []);

  useLive('notification', (n: Notice) => {
    setItems((l) => [n, ...l].slice(0, 50));
    setUnread((u) => u + 1);
    setToasts((t) => [...t, n].slice(-4));
    // alerts stay until closed; others fade after 8 s
    if (n.severity !== 'ALERT') timers.current.set(n.id, setTimeout(() => setToasts((t) => t.filter((x) => x.id !== n.id)), 8000));
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
        const shown = new Notification(n.title, { body: n.body, tag: n.id, icon: '/icon.svg' });
        shown.onclick = () => { window.focus(); if (n.link) window.location.href = n.link; };
      }
    } catch { /* some browsers only allow notifications from a service worker */ }
  });
  useLive('notifications.read', () => void load());

  const markAllRead = useCallback(async () => {
    await post('/notifications/read');
    setUnread(0);
    setItems((l) => l.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
  }, []);
  const markRead = useCallback(async (id: string) => {
    await post(`/notifications/${id}/read`);
    setItems((l) => l.map((n) => (n.id === id && !n.readAt ? { ...n, readAt: new Date().toISOString() } : n)));
    setUnread((u) => Math.max(0, u - 1));
  }, []);

  return (
    <NotificationsContext.Provider value={{ items, unread, toasts, dismissToast, markAllRead, markRead }}>
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error('useNotifications outside NotificationsProvider');
  return ctx;
}

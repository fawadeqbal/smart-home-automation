'use client';
import { useEffect, useState } from 'react';
import { get, post } from '@/lib/api';

/**
 * The service worker. In development (`next dev`) the files under /_next/static keep the same names while
 * their contents change, so the worker must not serve them from its cache there: it would run old code
 * after every edit until a hard reload (Ctrl+F5).
 */
export const SW_URL = process.env.NODE_ENV === 'production' ? '/sw.js' : '/sw.js?mode=dev';

interface InstallEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }

/** Registers the service worker, and offers "Install app" when the browser allows it. */
export function AppInstall() {
  const [event, setEvent] = useState<InstallEvent | null>(null);
  useEffect(() => {
    if ('serviceWorker' in navigator && window.isSecureContext) {
      navigator.serviceWorker.register(SW_URL).catch(() => undefined);
    }
    const onPrompt = (e: Event) => { e.preventDefault(); setEvent(e as InstallEvent); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);
  if (!event) return null;
  return (
    <button className="nav-link install-btn" onClick={async () => { await event.prompt(); setEvent(null); }}>
      ⬇ Install app
    </button>
  );
}

/** Ask this browser for push notifications and register it with the server. */
export async function enablePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error('This browser cannot receive push notifications.');
  if (!window.isSecureContext) throw new Error('Push needs https (or http://localhost). It will work once the app is online with https.');
  const { publicKey } = await get<{ publicKey: string | null }>('/push/key');
  if (!publicKey) throw new Error('Push is not set up on the server.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notifications were not allowed.');
  const reg = await navigator.serviceWorker.register(SW_URL);
  await navigator.serviceWorker.ready;
  const key = Uint8Array.from(atob(publicKey.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (publicKey.length % 4)) % 4)), (c) => c.charCodeAt(0));
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await post('/push/subscribe', sub.toJSON() as Record<string, unknown>);
}

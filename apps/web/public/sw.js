/* Switchboard service worker: works offline (shows a friendly page), and shows push notifications. */
// v2: drops the v1 cache, which could hold development files that had changed since
const CACHE = 'switchboard-v2';
const OFFLINE = '/offline.html';
// Registered as /sw.js?mode=dev by `next dev`, where file names under /_next/static don't change when the
// code does: never answer those from the cache there.
const DEV = new URL(self.location.href).searchParams.get('mode') === 'dev';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll([OFFLINE, '/icon.svg', '/manifest.webmanifest'])));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/socket.io')) return; // always live
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match(OFFLINE)));
    return;
  }
  if (url.pathname.startsWith('/_next/static/') && !DEV) {
    // production build files have the content's hash in their name and never change: cache first
    event.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
      return res;
    })));
  }
});

self.addEventListener('push', (event) => {
  let data = { title: 'Switchboard', body: '', link: '/', severity: 'INFO', id: undefined };
  try { data = { ...data, ...event.data.json() }; } catch { /* plain text */ }
  event.waitUntil(self.registration.showNotification(data.title, {
    body: data.body,
    icon: '/icon.svg',
    badge: '/icon.svg',
    tag: data.id,
    requireInteraction: data.severity === 'ALERT',
    data: { link: data.link || '/notifications' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || '/';
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) {
      if ('focus' in c) { c.navigate(link); return c.focus(); }
    }
    return self.clients.openWindow(link);
  }));
});

'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Loader } from '@/components/Loader';
import { enablePush } from '@/components/AppInstall';
import { errorText, get, put } from '@/lib/api';
import { timeAgo } from '@/lib/hooks';
import { useNotifications } from '@/lib/notifications';

interface Pref { key: string; label: string; enabled: boolean }

export default function NotificationsPage() {
  const { items, unread, markAllRead, markRead } = useNotifications();
  const [prefs, setPrefs] = useState<Pref[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [permission, setPermission] = useState<string>('unsupported');
  const [pushState, setPushState] = useState<{ busy: boolean; text: string | null; devices: number }>({ busy: false, text: null, devices: 0 });

  useEffect(() => {
    get<Pref[]>('/notifications/prefs').then(setPrefs).catch((e) => setError(errorText(e)));
    if (typeof Notification !== 'undefined') setPermission(Notification.permission);
    get<{ devices: number }>('/push/devices').then((r) => setPushState((s) => ({ ...s, devices: r.devices }))).catch(() => undefined);
  }, []);

  async function toggle(key: string, enabled: boolean) {
    try { setPrefs(await put<Pref[]>('/notifications/prefs', { [key]: enabled })); } catch (e) { setError(errorText(e)); }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Notifications</h1>
          <p className="muted">What happened at home that you should know about. Kept for 30 days.</p>
        </div>
        {unread > 0 && <button className="btn" onClick={() => void markAllRead()}>Mark all read</button>}
      </div>

      <div className="notif-layout">
        <section className="stack">
          <div className="admin-list">
            {items.length === 0 && <div className="empty">No notifications yet.</div>}
            {items.map((n) => (
              <div key={n.id} className={`notif-row sev-${n.severity} ${n.readAt ? '' : 'unread'}`}>
                <span className={`badge ${n.severity === 'ALERT' ? 'bad' : n.severity === 'WARN' ? 'warn' : 'ok'}`}>{n.severity === 'ALERT' ? 'Alert' : n.severity === 'WARN' ? 'Warning' : 'Info'}</span>
                <div className="stack-tight">
                  <b>{n.title}</b>
                  <span className="small muted">{n.body}</span>
                  <span className="small muted">{new Date(n.createdAt).toLocaleString()} · {timeAgo(n.createdAt)}</span>
                </div>
                <div className="row" style={{ marginLeft: 'auto', flexWrap: 'nowrap' }}>
                  {n.link && <Link className="btn btn-small" href={n.link} onClick={() => !n.readAt && void markRead(n.id)}>Open</Link>}
                  {!n.readAt && <button className="btn btn-small" onClick={() => void markRead(n.id)}>Read</button>}
                </div>
              </div>
            ))}
          </div>
        </section>

        <aside className="card card-pad stack notif-prefs">
          <h3>Tell me when…</h3>
          {!prefs && !error && <Loader label="Loading…" />}
          {prefs?.map((p) => (
            <label key={p.key} className="pref-row">
              <span>{p.label}</span>
              <span className="switch-input">
                <input type="checkbox" checked={p.enabled} onChange={(e) => void toggle(p.key, e.target.checked)} />
                <span />
              </span>
            </label>
          ))}
          <hr className="sep" />
          <b className="small">Alerts on your phone or computer</b>
          <p className="small muted">Get alerts even when the app is closed. {pushState.devices ? `On for ${pushState.devices} device${pushState.devices > 1 ? 's' : ''}.` : ''}</p>
          <button className="btn btn-small btn-primary" style={{ alignSelf: 'flex-start' }} disabled={pushState.busy} onClick={async () => {
            setPushState((s) => ({ ...s, busy: true, text: null }));
            try {
              await enablePush();
              const r = await get<{ devices: number }>('/push/devices');
              setPushState({ busy: false, text: 'Done — this device will get alerts.', devices: r.devices });
              setPermission('granted');
            } catch (e) {
              setPushState((s) => ({ ...s, busy: false, text: errorText(e) }));
            }
          }}>{pushState.busy ? 'Turning on…' : 'Turn on alerts for this device'}</button>
          {pushState.text && <p className="small muted">{pushState.text}</p>}
          <p className="small muted">On iPhone: first add the app to the Home Screen (Share → Add to Home Screen), then open it from there.</p>
          <b className="small">While this tab is open</b>
          {permission === 'granted' && <p className="small muted">✓ This browser will show a system notification while the app is open in the background.</p>}
          {permission === 'default' && (
            <button className="btn btn-small" style={{ alignSelf: 'flex-start' }} onClick={async () => setPermission(await Notification.requestPermission())}>
              Allow notifications in this browser
            </button>
          )}
          {permission === 'denied' && <p className="small muted">Notifications are blocked for this site in the browser settings.</p>}
          {permission === 'unsupported' && <p className="small muted">This browser can’t show system notifications.</p>}
          {error && <div className="alert">{error}</div>}
        </aside>
      </div>
    </>
  );
}

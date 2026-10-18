/**
 * Installation checklist ticks that work without signal. Each tick or note is kept on this phone
 * (localStorage) with the time it was made, and sent when the phone is back online. The server keeps
 * the newest change of each item (last write wins), so ticks sent late never undo a newer one.
 */
import { ApiError, put } from './api';
import type { InstallReport } from './types';

export interface PendingTick { key: string; done: boolean; note?: string; at: string }

const KEY = (homeId: string) => `sb.install.pending.${homeId}`;

export function pending(homeId: string): PendingTick[] {
  try {
    const raw = localStorage.getItem(KEY(homeId));
    const list = raw ? (JSON.parse(raw) as PendingTick[]) : [];
    return Array.isArray(list) ? list.filter((p) => p && typeof p.key === 'string' && typeof p.done === 'boolean') : [];
  } catch {
    return [];
  }
}

function store(homeId: string, list: PendingTick[]) {
  try {
    if (list.length) localStorage.setItem(KEY(homeId), JSON.stringify(list));
    else localStorage.removeItem(KEY(homeId));
  } catch { /* private mode or full: the tick still goes to the server when it can */ }
}

/** Remembers a change (one per item: the newest replaces an older one not sent yet). */
export function remember(homeId: string, tick: PendingTick) {
  const list = pending(homeId).filter((p) => p.key !== tick.key);
  const prev = pending(homeId).find((p) => p.key === tick.key);
  store(homeId, [...list, { ...tick, note: tick.note ?? prev?.note }]);
}

/** The report as this phone sees it: the server's, with the changes not sent yet on top. */
export function withPending(r: InstallReport, list: PendingTick[]): InstallReport {
  if (!list.length) return r;
  const items = r.items.map((i) => {
    const p = list.find((x) => x.key === i.key);
    return p ? { ...i, done: p.done, ...(p.note !== undefined ? { note: p.note } : {}) } : i;
  });
  return { ...r, items, done: items.filter((i) => i.done).length };
}

/** Sends what is waiting. Returns the server's report, or null while offline (nothing lost). */
export async function flush(homeId: string): Promise<InstallReport | null> {
  const list = pending(homeId);
  if (!list.length) return null;
  try {
    const r = await put<InstallReport>(`/platform/homes/${homeId}/installation`, { items: list });
    // only forget what was sent: a tick made while sending stays for the next time
    const now = pending(homeId).filter((p) => !list.some((s) => s.key === p.key && s.at === p.at));
    store(homeId, now);
    return r;
  } catch (err) {
    // the server said no (signed, or not their home): those ticks can never go, so drop them
    if (err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 401 && err.status !== 408 && err.status !== 429) {
      store(homeId, []);
      throw err;
    }
    return null;
  }
}

/** True when the browser knows it has no connection (a request that fails also counts as offline). */
export const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

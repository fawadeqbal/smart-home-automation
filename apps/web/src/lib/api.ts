/**
 * Calls to the API at /api (same site, so the sign-in cookies travel with them).
 * An expired 15-minute access cookie is renewed once with the refresh cookie, then the call is retried.
 */
export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

let refreshing: Promise<boolean> | null = null;

/* ---- which home the calls are about (sent as X-Home-Id; the API checks the person may open it) ---- */
let activeHome: string | null = null;
const homeListeners = new Set<(id: string | null) => void>();

export function getApiHome() {
  return activeHome;
}

let notifyQueued = false;

/**
 * Sets the home for every following call (and the live connection). Safe to call during render:
 * API calls use it at once, but listeners (the live connection, which updates React state) hear
 * about it just after the current render, never in the middle of one.
 */
export function setApiHome(id: string | null) {
  if (id === activeHome) return;
  activeHome = id;
  if (notifyQueued) return;
  notifyQueued = true;
  queueMicrotask(() => {
    notifyQueued = false;
    homeListeners.forEach((fn) => fn(activeHome));
  });
}

export function onHomeChange(fn: (id: string | null) => void): () => void {
  homeListeners.add(fn);
  return () => homeListeners.delete(fn);
}

export function refreshSession(): Promise<boolean> {
  refreshing ??= fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => setTimeout(() => (refreshing = null), 0));
  return refreshing;
}

type Body = Record<string, unknown> | unknown[] | FormData | undefined;

async function send(method: string, path: string, body: Body): Promise<Response> {
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  const headers: Record<string, string> = {};
  if (body && !isForm) headers['Content-Type'] = 'application/json';
  if (activeHome) headers['X-Home-Id'] = activeHome;
  return fetch(`/api${path}`, {
    method,
    credentials: 'include',
    headers,
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });
}

/* ---- loading state: how many calls are running, and which button started each one ---- */
let pending = 0;
const listeners = new Set<(n: number) => void>();
let lastGesture = 0;
if (typeof window !== 'undefined') {
  const mark = () => (lastGesture = Date.now());
  window.addEventListener('pointerdown', mark, true);
  window.addEventListener('keydown', (e) => e.key === 'Enter' && mark(), true);
}

/** Subscribe to the number of API calls in flight (for the top progress bar). */
export function onPending(fn: (n: number) => void): () => void {
  listeners.add(fn);
  fn(pending);
  return () => listeners.delete(fn);
}

/** The button the person just clicked (or the submit button of the form they pressed Enter in). */
function triggerButton(): HTMLElement | null {
  if (typeof document === 'undefined' || Date.now() - lastGesture > 400) return null;
  const el = document.activeElement as HTMLElement | null;
  if (!el) return null;
  if (el.tagName === 'BUTTON') return el;
  const form = el.closest('form');
  return (form?.querySelector('button:not([type="button"])') as HTMLElement | null) ?? null;
}

export async function api<T = unknown>(method: string, path: string, body?: Body): Promise<T> {
  const button = triggerButton();
  button?.setAttribute('aria-busy', 'true');
  pending++;
  listeners.forEach((fn) => fn(pending));
  try {
    return await call<T>(method, path, body);
  } finally {
    pending--;
    listeners.forEach((fn) => fn(pending));
    button?.removeAttribute('aria-busy');
  }
}

async function call<T>(method: string, path: string, body?: Body): Promise<T> {
  let res = await send(method, path, body);
  if (res.status === 401 && !path.startsWith('/auth/') && (await refreshSession())) {
    res = await send(method, path, body);
  }
  const text = await res.text();
  let data: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // Not JSON (e.g. the dev proxy timed out): show a readable message instead of a parse error.
    if (!res.ok) throw new ApiError(res.status, res.status >= 500 ? 'The server did not answer in time. Try again.' : text.slice(0, 200));
  }
  if (!res.ok) {
    const message = Array.isArray(data?.message) ? data.message.join('; ') : data?.message;
    throw new ApiError(res.status, message || `Request failed (${res.status})`);
  }
  return data as T;
}

export const get = <T>(path: string) => api<T>('GET', path);
export const post = <T>(path: string, body?: Body) => api<T>('POST', path, body ?? {});
export const patch = <T>(path: string, body: Body) => api<T>('PATCH', path, body);
export const put = <T>(path: string, body: Body) => api<T>('PUT', path, body);
export const del = <T>(path: string) => api<T>('DELETE', path);

export const errorText = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong');

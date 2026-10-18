/**
 * Firebase Cloud Messaging (HTTP v1) without the Firebase SDK: a service account's key signs a short
 * JWT (RS256, node's crypto), Google swaps it for an access token (cached ~1 hour), and each message is
 * one POST. These are the pure parts, tested on their own (test/unit/fcm.test.js).
 */
import { createSign } from 'node:crypto';

export const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

export interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
}

/**
 * The key from FCM_SERVICE_ACCOUNT: the JSON file's contents, or the same in base64 (one line, so it
 * fits a .env file). null when empty; throws with a plain message when it is something else.
 */
export function readServiceAccount(raw: string | undefined | null): ServiceAccount | null {
  const text = raw?.trim();
  if (!text) return null;
  let json = text;
  if (!text.startsWith('{')) {
    try {
      json = Buffer.from(text, 'base64').toString('utf8');
    } catch {
      throw new Error('FCM_SERVICE_ACCOUNT is neither JSON nor base64 of it.');
    }
  }
  let parsed: Partial<ServiceAccount> & { type?: string };
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('FCM_SERVICE_ACCOUNT is neither JSON nor base64 of it.');
  }
  if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
    throw new Error('FCM_SERVICE_ACCOUNT is missing project_id, client_email or private_key: use the service account key file from Firebase.');
  }
  // keys pasted through some shells keep "\n" as two characters
  const privateKey = parsed.private_key.includes('\\n') ? parsed.private_key.replace(/\\n/g, '\n') : parsed.private_key;
  return { project_id: parsed.project_id, client_email: parsed.client_email, private_key: privateKey, token_uri: parsed.token_uri };
}

const b64url = (v: string | Buffer) => Buffer.from(v).toString('base64url');

/** The signed assertion Google's token endpoint takes (good for an hour). */
export function buildJwt(sa: ServiceAccount, nowSec = Math.floor(Date.now() / 1000)): string {
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = { iss: sa.client_email, scope: FCM_SCOPE, aud: sa.token_uri || GOOGLE_TOKEN_URL, iat: nowSec, exp: nowSec + 3600 };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(sa.private_key);
  return `${unsigned}.${b64url(signature)}`;
}

export interface PushNotice {
  id: string;
  title: string;
  body: string;
  link?: string | null;
  /** INFO | WARN | ALERT */
  severity: string;
  kind?: string;
  homeId?: string;
}

/** Android channels the app makes: alerts ring and show on top; everything else is quieter. */
export const ANDROID_CHANNEL = { alerts: 'alerts', general: 'general' } as const;

/**
 * One FCM v1 message for one phone. ALERT (a leak, a door while away) goes with high priority and on the
 * "Alerts" channel; the link and the notice's id ride along as data, so a tap opens the right screen.
 */
export function fcmMessage(token: string, n: PushNotice) {
  const alert = n.severity === 'ALERT';
  const data: Record<string, string> = { id: n.id, severity: n.severity };
  if (n.link) data.link = n.link;
  if (n.kind) data.kind = n.kind;
  if (n.homeId) data.homeId = n.homeId;
  return {
    message: {
      token,
      notification: { title: n.title, body: n.body },
      data,
      android: {
        priority: alert ? 'HIGH' : 'NORMAL',
        // an hour old is no news (a door that opened yesterday)
        ttl: '3600s',
        notification: { channel_id: alert ? ANDROID_CHANNEL.alerts : ANDROID_CHANNEL.general, tag: n.id, ...(alert ? { notification_priority: 'PRIORITY_MAX' } : {}) },
      },
      apns: {
        headers: { 'apns-priority': alert ? '10' : '5' },
        payload: { aps: { ...(alert ? { sound: 'default' } : {}), 'thread-id': n.kind ?? 'switchboard' } },
      },
    },
  };
}

/**
 * Should this phone's token be forgotten after FCM's answer? 404 UNREGISTERED (the app was removed or
 * the token rotated), or 400 INVALID_ARGUMENT naming the token.
 */
export function tokenIsGone(status: number, body: unknown): boolean {
  const err = (body as { error?: { status?: string; message?: string; details?: { errorCode?: string }[] } } | null)?.error;
  const codes = [err?.status, ...(err?.details ?? []).map((d) => d.errorCode)].filter(Boolean);
  if (status === 404 || codes.includes('UNREGISTERED')) return true;
  return status === 400 && codes.includes('INVALID_ARGUMENT') && /registration token|token/i.test(err?.message ?? '');
}

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ status: number; json(): Promise<unknown> }>;

export type SendResult = 'sent' | 'gone' | 'failed';

/** Talks to Google: keeps one access token until a minute before it runs out. */
export class FcmClient {
  private token: { value: string; until: number } | null = null;
  private pending: Promise<string> | null = null;

  constructor(private readonly sa: ServiceAccount, private readonly fetchFn: Fetch = fetch as unknown as Fetch, private readonly now = () => Date.now()) {}

  get projectId() {
    return this.sa.project_id;
  }

  async accessToken(): Promise<string> {
    if (this.token && this.token.until > this.now()) return this.token.value;
    this.pending ??= (async () => {
      try {
        const jwt = buildJwt(this.sa, Math.floor(this.now() / 1000));
        const res = await this.fetchFn(this.sa.token_uri || GOOGLE_TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }).toString(),
        });
        const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string; error?: string };
        if (res.status !== 200 || !body.access_token) {
          throw new Error(`Google refused the Firebase key (${res.status}${body.error ? `: ${body.error_description ?? body.error}` : ''})`);
        }
        this.token = { value: body.access_token, until: this.now() + Math.max(60, (body.expires_in ?? 3600) - 60) * 1000 };
        return body.access_token;
      } finally {
        this.pending = null;
      }
    })();
    return this.pending;
  }

  /** Sends one notice to one phone. */
  async send(token: string, n: PushNotice): Promise<{ result: SendResult; status: number; error?: string }> {
    const access = await this.accessToken();
    const res = await this.fetchFn(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(this.sa.project_id)}/messages:send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(fcmMessage(token, n)),
    });
    if (res.status === 200) return { result: 'sent', status: 200 };
    const body = await res.json().catch(() => null);
    if (res.status === 401) this.token = null; // a revoked or expired token: get a new one next time
    if (tokenIsGone(res.status, body)) return { result: 'gone', status: res.status };
    const message = (body as { error?: { message?: string } } | null)?.error?.message;
    return { result: 'failed', status: res.status, error: message };
  }
}

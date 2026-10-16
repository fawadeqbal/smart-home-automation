/**
 * Time-based one-time codes (RFC 6238), the 6-digit codes of Google Authenticator, Microsoft
 * Authenticator, Authy and the like: HMAC-SHA1 over 30-second steps, secret shared as base32.
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP = 30;

export function base32(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function fromBase32(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const c of clean) {
    value = (value << 5) | ALPHABET.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const newSecret = () => base32(randomBytes(20));

/** The code for a 30-second step (RFC 4226 dynamic truncation). */
export function codeAt(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', fromBase32(secret)).update(counter).digest();
  const offset = mac[mac.length - 1]! & 15;
  const n = (mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(n).padStart(6, '0');
}

/** Checks a code, allowing one step either side for a phone clock a little off. Returns the step used (to refuse it twice). */
export function verifyCode(secret: string, code: string, at = Date.now(), lastStep = -1): number | null {
  const c = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const now = Math.floor(at / 1000 / STEP);
  for (const step of [now, now - 1, now + 1]) {
    if (step <= lastStep) continue;
    const want = Buffer.from(codeAt(secret, step));
    if (timingSafeEqual(want, Buffer.from(c))) return step;
  }
  return null;
}

export function otpauthUri(secret: string, account: string, issuer: string) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP}`;
}

/** Ten one-time recovery codes like "k7qm-2xfp" (shown once; only their hashes are kept). */
export function recoveryCodes(n = 10) {
  const letters = 'abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: n }, () => {
    const b = randomBytes(8);
    const s = Array.from(b, (x) => letters[x % letters.length]).join('');
    return `${s.slice(0, 4)}-${s.slice(4)}`;
  });
}

export const hashRecovery = (code: string) => createHash('sha256').update(code.trim().toLowerCase().replace(/\s/g, '')).digest('hex');

/** The secret is kept encrypted with a key from the server's JWT secret (AES-256-GCM). */
export function seal(secret: string, key: string) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', createHash('sha256').update(`totp:${key}`).digest(), iv);
  const enc = Buffer.concat([c.update(secret, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}

export function unseal(sealed: string, key: string) {
  const [iv, tag, enc] = sealed.split('.').map((x) => Buffer.from(x, 'base64'));
  const d = createDecipheriv('aes-256-gcm', createHash('sha256').update(`totp:${key}`).digest(), iv!);
  d.setAuthTag(tag!);
  return Buffer.concat([d.update(enc!), d.final()]).toString('utf8');
}

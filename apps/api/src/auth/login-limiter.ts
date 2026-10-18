import { HttpException, HttpStatus, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../common/audit.service';
import { MailService } from '../mail/mail.service';
import { MonitoringService } from '../monitoring/monitoring.service';
import { PrismaService } from '../prisma/prisma.service';

const MIN = 60_000;

/** What is limited: wrong passwords, wrong two-step codes, "Forgot password?" emails, links that don't exist. */
export type AttemptKind = 'login' | 'code' | 'forgot' | 'token';

/**
 * One limit. `pair`: this email from this network; `ip`: this network, whatever the email; `account`: this
 * email from anywhere. `max` attempts within `windowMs` start a wait of `lockMs` (0: no wait, at most `max`
 * in any `windowMs`). After a wait the count starts again from nothing.
 */
export interface LimitRule {
  scope: 'pair' | 'ip' | 'account';
  max: number;
  windowMs: number;
  lockMs: number;
  /** the account's own networks (where it has a session) aren't stopped by this one */
  trustKnownIp?: boolean;
}

export const RULES: Record<AttemptKind, LimitRule[]> = {
  login: [
    { scope: 'pair', max: 5, windowMs: 15 * MIN, lockMs: 15 * MIN },
    { scope: 'ip', max: 30, windowMs: 15 * MIN, lockMs: 15 * MIN },
    // a slow attack spread over many networks: it waits too, the owner at most 15 minutes (and not at all
    // from a network they're signed in on)
    { scope: 'account', max: 50, windowMs: 60 * MIN, lockMs: 15 * MIN, trustKnownIp: true },
  ],
  code: [
    { scope: 'pair', max: 5, windowMs: 15 * MIN, lockMs: 15 * MIN },
    { scope: 'ip', max: 30, windowMs: 15 * MIN, lockMs: 15 * MIN },
    { scope: 'account', max: 20, windowMs: 60 * MIN, lockMs: 15 * MIN },
  ],
  forgot: [
    { scope: 'account', max: 3, windowMs: 60 * MIN, lockMs: 0 },
    { scope: 'ip', max: 10, windowMs: 60 * MIN, lockMs: 0 },
  ],
  token: [{ scope: 'ip', max: 20, windowMs: 15 * MIN, lockMs: 15 * MIN }],
};

/** Rows older than this are removed (longer than any window plus its wait). */
const KEEP_MS = 24 * 60 * MIN;

export interface LimitState {
  blocked: boolean;
  /** how long until it may try again */
  waitMs: number;
  /** tries left before a wait (0 while waiting) */
  left: number;
  /** when the current wait started (null: not waiting) */
  since: number | null;
}

/**
 * Where a key stands, from the times of its attempts (any order). Windows, not a sticky counter: attempts
 * during a wait don't count (they are refused before they're checked), and the count starts from nothing
 * when a wait ends — one wrong try after the wait doesn't start another.
 */
export function limitState(times: (Date | number)[], rule: LimitRule, now: number): LimitState {
  const sorted = times.map((t) => (typeof t === 'number' ? t : t.getTime())).filter((t) => t <= now).sort((a, b) => a - b);
  let until = 0;
  let counted: number[] = [];
  for (const t of sorted) {
    if (t < until) continue;
    counted = counted.filter((x) => x > t - rule.windowMs);
    counted.push(t);
    if (rule.lockMs > 0 && counted.length >= rule.max) {
      until = t + rule.lockMs;
      counted = [];
    }
  }
  if (now < until) return { blocked: true, waitMs: until - now, left: 0, since: until - rule.lockMs };
  counted = counted.filter((x) => x > now - rule.windowMs);
  if (rule.lockMs === 0 && counted.length >= rule.max) {
    return { blocked: true, waitMs: counted[counted.length - rule.max]! + rule.windowMs - now, left: 0, since: null };
  }
  return { blocked: false, waitMs: 0, left: Math.max(0, rule.max - counted.length), since: null };
}

/** "1 minute", "12 minutes" (rounded up: never less than it really is). */
export function waitText(ms: number): string {
  const min = Math.max(1, Math.ceil(ms / MIN));
  return min === 1 ? '1 minute' : `${min} minutes`;
}

/** What people read when they must wait (they never learn whether the email has an account). */
export function blockedMessage(kind: AttemptKind, scope: LimitRule['scope'], waitMs: number): string {
  const wait = waitText(waitMs);
  if (kind === 'token') return `Too many links tried from this network. Try again in ${wait}.`;
  if (kind === 'code') return `Too many wrong codes. For your safety, try again in ${wait}.`;
  if (scope === 'ip') return `Too many failed sign-ins from this network. Try again in ${wait}.`;
  if (scope === 'account') return `Too many attempts to sign in to this account. For its safety, try again in ${wait}.`;
  return `Too many failed attempts. For your safety, try again in ${wait}, or use “Forgot password?”.`;
}

export class TooManyAttempts extends HttpException {
  constructor(message: string, public readonly waitMs: number) {
    super({ statusCode: HttpStatus.TOO_MANY_REQUESTS, message, retryAfterSec: Math.ceil(waitMs / 1000) }, HttpStatus.TOO_MANY_REQUESTS);
  }
}

/**
 * Sign-in limits kept in the database (so they hold across restarts and several API servers): failed
 * attempts with their time, email and network. Fair to the account's owner: someone typing their email
 * wrong elsewhere doesn't lock them out at home.
 */
@Injectable()
export class LoginLimiter implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('SignInLimits');
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly monitoring: MonitoringService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.prune(), 60 * MIN);
    this.timer.unref?.();
    void this.prune();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  /** Throws 429 (with how long to wait) when this email or network must wait. */
  async check(kind: AttemptKind, email: string | null, ip: string) {
    const blocked = await this.blocking(kind, email?.toLowerCase() ?? null, ip);
    if (blocked) throw new TooManyAttempts(blockedMessage(kind, blocked.rule.scope, blocked.state.waitMs), blocked.state.waitMs);
  }

  /**
   * Records a failed attempt. Returns the tries left for this email from this network, or throws 429
   * when this attempt started a wait.
   */
  async fail(kind: AttemptKind, email: string | null, ip: string): Promise<{ left: number }> {
    const key = email?.toLowerCase() ?? null;
    const now = Date.now();
    await this.prisma.loginAttempt.create({ data: { kind, email: key, ip: ip.slice(0, 64), at: new Date(now) } });
    const states = await this.states(kind, key, ip, now);
    // an attack on one account from many networks: tell its owner, once, when the wait starts
    const account = states.find((s) => s.rule.scope === 'account' && s.state.since === now);
    if (account && key && (kind === 'login' || kind === 'code')) void this.warnOwner(key, kind).catch((e) => this.log.warn(`security notice failed: ${e}`));
    const pair = states.find((s) => s.rule.scope === 'pair');
    const blocked = await this.firstBlocking(states, key, ip);
    if (blocked) throw new TooManyAttempts(blockedMessage(kind, blocked.rule.scope, blocked.state.waitMs), blocked.state.waitMs);
    return { left: pair?.state.left ?? Infinity };
  }

  /** "Forgot password?" counts every request: true when this one may go ahead (and records it). */
  async allow(kind: AttemptKind, email: string | null, ip: string): Promise<boolean> {
    const key = email?.toLowerCase() ?? null;
    if (await this.blocking(kind, key, ip)) return false;
    await this.prisma.loginAttempt.create({ data: { kind, email: key, ip: ip.slice(0, 64) } });
    return true;
  }

  /** Signed in: this email's failures from this network are forgotten (all networks when ip is null). */
  async clear(kinds: AttemptKind[], email: string, ip: string | null) {
    await this.prisma.loginAttempt.deleteMany({ where: { kind: { in: kinds }, email: email.toLowerCase(), ...(ip ? { ip } : {}) } });
  }

  private async blocking(kind: AttemptKind, email: string | null, ip: string) {
    return this.firstBlocking(await this.states(kind, email, ip, Date.now()), email, ip);
  }

  /** The limit that stops this attempt and has the longest wait (null: none). */
  private async firstBlocking(states: { rule: LimitRule; state: LimitState }[], email: string | null, ip: string) {
    const stopping = [];
    for (const s of states) {
      if (!s.state.blocked) continue;
      if (s.rule.trustKnownIp && email && (await this.knownIp(email, ip))) continue;
      stopping.push(s);
    }
    return stopping.sort((a, b) => b.state.waitMs - a.state.waitMs)[0] ?? null;
  }

  private async states(kind: AttemptKind, email: string | null, ip: string, now: number) {
    const out: { rule: LimitRule; state: LimitState }[] = [];
    for (const rule of RULES[kind]) {
      if (rule.scope !== 'ip' && !email) continue;
      // two windows and waits back covers a wait that followed another one
      const since = new Date(now - 2 * (rule.windowMs + rule.lockMs));
      const where: Prisma.LoginAttemptWhereInput = rule.scope === 'pair' ? { kind, email, ip, at: { gte: since } }
        : rule.scope === 'ip' ? { kind, ip, at: { gte: since } } : { kind, email, at: { gte: since } };
      const rows = await this.prisma.loginAttempt.findMany({ where, select: { at: true }, orderBy: { at: 'asc' }, take: 2000 });
      out.push({ rule, state: limitState(rows.map((r) => r.at), rule, now) });
    }
    return out;
  }

  /** The account is signed in (or was, in the last month) from this network. */
  private async knownIp(email: string, ip: string) {
    const s = await this.prisma.session.findFirst({
      where: { ip, user: { email }, OR: [{ lastUsedAt: { gte: new Date(Date.now() - 30 * 24 * 60 * MIN) } }, { createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * MIN) } }] },
      select: { id: true },
    });
    return !!s;
  }

  private async warnOwner(email: string, kind: AttemptKind) {
    const user = await this.prisma.user.findUnique({ where: { email }, select: { id: true, name: true, lastHomeId: true, memberships: { select: { homeId: true }, take: 5 } } });
    if (!user) return;
    const first = user.name.trim().split(/\s+/)[0] || 'there';
    const what = kind === 'code' ? 'wrong two-step codes' : 'wrong passwords';
    this.log.warn(`Many failed sign-ins for ${email}: sign-in paused for 15 minutes`);
    await this.audit.record(null, user.id, 'user.signin_paused', user.id, { kind });
    const homes = [...new Set([user.lastHomeId, ...user.memberships.map((m) => m.homeId)].filter((h): h is string => !!h))];
    const home = homes.find((h) => user.memberships.some((m) => m.homeId === h)) ?? homes[0];
    if (home) {
      await this.monitoring.notify(home, [user.id], {
        kind: 'security', severity: 'ALERT', title: 'Someone is trying to sign in to your account',
        body: `Many ${what} were typed for your account in the last hour, so signing in is paused for 15 minutes. `
          + 'If it wasn’t you, change your password and turn on two-step sign-in (Your account → Security).',
        link: '/account',
      });
    }
    void this.mail.send({
      to: email,
      subject: 'Someone is trying to sign in to your Switchboard account',
      text: `Hi ${first},\n\nMany ${what} were typed for your Switchboard account in the last hour, from different places, `
        + 'so signing in to it is paused for 15 minutes. You can still sign in from a phone or computer you already use.\n\n'
        + 'If it wasn’t you, nothing has been opened. To be safe, choose a new password and turn on two-step sign-in (Your account → Security).',
    });
  }

  private async prune() {
    try {
      await this.prisma.loginAttempt.deleteMany({ where: { at: { lt: new Date(Date.now() - KEEP_MS) } } });
    } catch (err) {
      this.log.warn(`Cleanup failed: ${(err as Error).message}`);
    }
  }
}

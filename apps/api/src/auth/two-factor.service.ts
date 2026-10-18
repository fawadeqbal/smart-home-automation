import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { StaffRole, User } from '@prisma/client';
import { verify } from '@node-rs/argon2';
import { toDataURL } from 'qrcode';
import { AuditService } from '../common/audit.service';
import { SETTINGS, Settings } from '../config';
import { MailService } from '../mail/mail.service';
import { PlatformService } from '../platform/platform.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from './auth.types';
import { LoginLimiter } from './login-limiter';
import { hashRecovery, newSecret, otpauthUri, recoveryCodes, seal, unseal, verifyCode } from './totp';

const TICKET_TTL_SEC = 5 * 60;
const MAX_TRIES = 5;

/**
 * Two-step sign-in: after the password, a 6-digit code from an authenticator app (or one of ten
 * one-time recovery codes). Turning it off needs the password. A super admin can turn it off for
 * someone who lost their phone and their codes.
 */
@Injectable()
export class TwoFactorService {
  private readonly tries = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly platform: PlatformService,
    @Inject(SETTINGS) private readonly settings: Settings,
    private readonly limiter: LoginLimiter,
  ) {}

  async status(userId: string) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { totpEnabledAt: true, recoveryHashes: true } });
    return { enabled: !!u.totpEnabledAt, since: u.totpEnabledAt, recoveryLeft: u.recoveryHashes.length };
  }

  /** A new secret to scan; it only counts once a code from it is confirmed. */
  async setup(userId: string) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, totpEnabledAt: true, org: { select: { name: true } } } });
    if (u.totpEnabledAt) throw new BadRequestException('Two-step sign-in is already on.');
    const secret = newSecret();
    await this.prisma.user.update({ where: { id: userId }, data: { totpPending: seal(secret, this.settings.jwtSecret) } });
    const uri = otpauthUri(secret, u.email, 'Switchboard');
    return { secret: secret.replace(/(.{4})/g, '$1 ').trim(), uri, qr: await toDataURL(uri, { margin: 1, width: 220 }) };
  }

  async enable(userId: string, code: string) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!u.totpPending) throw new BadRequestException('Start again: scan the code first.');
    const secret = unseal(u.totpPending, this.settings.jwtSecret);
    const step = verifyCode(secret, code);
    if (step === null) throw new BadRequestException('That code isn’t right. Check the phone’s time is set automatically, and try the newest code.');
    const codes = recoveryCodes();
    await this.prisma.user.update({
      where: { id: userId },
      data: { totpSecret: u.totpPending, totpPending: null, totpEnabledAt: new Date(), totpLastStep: step, recoveryHashes: codes.map(hashRecovery) },
    });
    await this.audit.record(null, userId, 'user.2fa_on', userId, {});
    void this.mail.send({ to: u.email, subject: 'Two-step sign-in is on', text: `Hello ${u.name.split(' ')[0]},\n\nTwo-step sign-in is now on for your Switchboard account. If this wasn't you, change your password now and tell your administrator.` });
    return { codes };
  }

  async disable(userId: string, password: string) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await verify(u.passwordHash, password))) throw new UnauthorizedException('Your password is not right.');
    await this.prisma.user.update({ where: { id: userId }, data: { totpSecret: null, totpPending: null, totpEnabledAt: null, totpLastStep: -1, recoveryHashes: [] } });
    await this.audit.record(null, userId, 'user.2fa_off', userId, {});
    void this.mail.send({ to: u.email, subject: 'Two-step sign-in is off', text: `Hello ${u.name.split(' ')[0]},\n\nTwo-step sign-in was turned off for your Switchboard account. If this wasn't you, change your password now and tell your administrator.` });
  }

  async newCodes(userId: string, password: string) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!u.totpEnabledAt) throw new BadRequestException('Two-step sign-in is off.');
    if (!(await verify(u.passwordHash, password))) throw new UnauthorizedException('Your password is not right.');
    const codes = recoveryCodes();
    await this.prisma.user.update({ where: { id: userId }, data: { recoveryHashes: codes.map(hashRecovery) } });
    await this.audit.record(null, userId, 'user.2fa_codes', userId, {});
    return { codes };
  }

  // ---------------------------------------------------------------- signing in
  /** After a right password: a short-lived ticket that only the second step accepts. */
  ticket(user: User) {
    return this.jwt.signAsync({ sub: user.id, typ: '2fa' }, { expiresIn: TICKET_TTL_SEC });
  }

  /**
   * The second step. Wrong codes are limited like passwords (per account and network, per network, per
   * account: in the database), and a ticket stops working after MAX_TRIES wrong codes.
   */
  async check(ticket: string, code: string, ip = 'unknown'): Promise<{ user: User; usedRecovery: boolean; left: number }> {
    let sub: string;
    try {
      const claims = await this.jwt.verifyAsync<{ sub: string; typ: string }>(ticket);
      if (claims.typ !== '2fa') throw new Error('wrong ticket');
      sub = claims.sub;
    } catch {
      throw new UnauthorizedException('That took too long. Sign in again.');
    }
    const u = await this.prisma.user.findUnique({ where: { id: sub } });
    if (!u || u.disabled || !u.totpSecret) throw new UnauthorizedException('Sign in again.');
    await this.limiter.check('code', u.email, ip);
    const tries = (this.tries.get(ticket) ?? 0) + 1;
    if (tries > MAX_TRIES) throw new HttpException('Too many wrong codes. Sign in again.', HttpStatus.TOO_MANY_REQUESTS);
    const wrong = async () => {
      this.tries.set(ticket, tries);
      if (this.tries.size > 5000) this.tries.clear(); // tickets last 5 minutes: an old one is harmless to forget
      const { left } = await this.limiter.fail('code', u.email, ip);
      const n = Math.min(left, MAX_TRIES - tries);
      return new UnauthorizedException(`That code isn’t right.${n <= 2 ? ` ${n} ${n === 1 ? 'try' : 'tries'} left.` : ''}`);
    };
    const typed = code.trim();
    if (/^\d{3}\s?\d{3}$/.test(typed)) {
      const step = verifyCode(unseal(u.totpSecret, this.settings.jwtSecret), typed, Date.now(), u.totpLastStep);
      if (step === null) throw await wrong();
      await this.prisma.user.update({ where: { id: u.id }, data: { totpLastStep: step } });
      this.tries.delete(ticket);
      await this.limiter.clear(['code'], u.email, ip);
      return { user: u, usedRecovery: false, left: u.recoveryHashes.length };
    }
    const h = hashRecovery(typed);
    if (!u.recoveryHashes.includes(h)) throw await wrong();
    const left = u.recoveryHashes.filter((x) => x !== h);
    await this.prisma.user.update({ where: { id: u.id }, data: { recoveryHashes: left } });
    await this.audit.record(null, u.id, 'user.2fa_recovery_used', u.id, { left: left.length });
    this.tries.delete(ticket);
    await this.limiter.clear(['code'], u.email, ip);
    return { user: u, usedRecovery: true, left: left.length };
  }

  // ---------------------------------------------------------------- lost phone
  /** A super admin turns it off for someone in their company or their homes (they set it up again after signing in). */
  async adminReset(staff: AuthUser, userId: string) {
    if (staff.staffRole !== StaffRole.SUPERADMIN || !staff.orgId) throw new ForbiddenException('Only a super admin can do this.');
    if (userId === staff.id) throw new BadRequestException('Turn your own off from your account.');
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, orgId: true, email: true, name: true, staffRole: true, memberships: { select: { home: { select: { orgId: true } } } } } });
    const ours = u && (u.orgId === staff.orgId || u.memberships.some((m) => m.home.orgId === staff.orgId));
    if (!u || !ours) throw new NotFoundException('No such person.');
    if (u.staffRole === StaffRole.SUPERADMIN) throw new ForbiddenException('Another super admin uses their recovery codes, or the server owner resets it.');
    await this.prisma.user.update({ where: { id: userId }, data: { totpSecret: null, totpPending: null, totpEnabledAt: null, totpLastStep: -1, recoveryHashes: [] } });
    await this.audit.record(null, staff.id, 'user.2fa_reset', userId, { name: u.name }, staff.orgId);
    void this.mail.send({ to: u.email, subject: 'Two-step sign-in was turned off', text: `Hello ${u.name.split(' ')[0]},\n\n${staff.name} turned off two-step sign-in for your Switchboard account, because you couldn't use your phone. Turn it on again from Your account after you sign in.` });
  }
}

import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import { Role, StaffRole } from '@prisma/client';
import type { Response } from 'express';
import { AuditService } from '../common/audit.service';
import { SETTINGS, Settings } from '../config';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService, randomToken, sha256 } from './auth.service';
import { AuthUser } from './auth.types';

/** A link someone asked for by email: short, they are waiting for it. */
const SELF_TTL_MS = 60 * 60 * 1000;
/** A link an owner or super admin made to send by WhatsApp: a day, it may be read later. */
const MADE_TTL_MS = 24 * 60 * 60 * 1000;
/** "Forgot password?" asks per email and per network, in an hour (more are ignored, silently). */
const PER_EMAIL = 3;
const PER_IP = 10;

/**
 * Choosing a new password: by email ("Forgot password?"), with a link an owner, admin or super admin made
 * for them, or while signed in. A link works once; using it signs out every other session of that person.
 */
@Injectable()
export class PasswordsService {
  private readonly asked = new Map<string, number[]>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    @Inject(SETTINGS) private readonly settings: Settings,
  ) {}

  get mailEnabled() {
    return this.mail.enabled;
  }

  // ---------------------------------------------------------------- forgot password (by email)
  /**
   * Always answers the same way, whether or not the email has an account (so this can't be used to find
   * out who uses Switchboard); the email only goes to an existing, active account.
   */
  async forgot(email: string, ip: string): Promise<{ mail: boolean }> {
    const key = email.toLowerCase();
    if (!this.allow(`e:${key}`, PER_EMAIL) || !this.allow(`i:${ip}`, PER_IP)) return { mail: this.mail.enabled };
    const user = await this.prisma.user.findUnique({ where: { email: key } });
    if (user && !user.disabled && this.mail.enabled) {
      const token = await this.create(user.id, null, SELF_TTL_MS);
      void this.mail.send({
        to: user.email,
        subject: 'Choose a new Switchboard password',
        text: `Hi ${firstName(user.name)},\n\nSomeone (hopefully you) asked to choose a new password for your Switchboard account. `
          + 'The link works once, for one hour.\n\nIf it wasn’t you, ignore this email: your password stays the same.',
        button: { label: 'Choose a new password', url: this.url(token) },
      });
    }
    return { mail: this.mail.enabled };
  }

  // ---------------------------------------------------------------- using a link
  async info(token: string) {
    const r = await this.valid(token);
    return { name: firstName(r.user.name), email: maskEmail(r.user.email), expiresAt: r.expiresAt, madeByOther: !!r.createdBy };
  }

  async reset(token: string, password: string, res: Response, userAgent?: string) {
    const r = await this.valid(token);
    const passwordHash = await hash(password);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: r.userId }, data: { passwordHash } }),
      // this link and any other open one are done; every session signs in again with the new password
      this.prisma.passwordReset.updateMany({ where: { userId: r.userId, usedAt: null }, data: { usedAt: new Date() } }),
      this.prisma.session.updateMany({ where: { userId: r.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    this.auth.clearFailures(r.user.email);
    await this.audit.record(null, r.userId, 'user.password_reset', r.userId, { by: r.createdBy ? 'link' : 'email' });
    await this.auth.startSession(r.user, res, userAgent);
    this.changedNotice(r.user.email, r.user.name);
    return r.user;
  }

  // ---------------------------------------------------------------- while signed in
  async change(user: AuthUser, current: string, next: string, currentRefresh?: string) {
    const full = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!(await verify(full.passwordHash, current))) throw new UnauthorizedException('Your current password is not right.');
    if (current === next) throw new BadRequestException('Choose a password different from the current one.');
    const keep = currentRefresh ? sha256(currentRefresh) : '';
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hash(next) } }),
      // signed out everywhere else; this browser stays signed in
      this.prisma.session.updateMany({ where: { userId: user.id, revokedAt: null, NOT: { refreshHash: keep } }, data: { revokedAt: new Date() } }),
    ]);
    await this.audit.record(null, user.id, 'user.password_change', user.id, {});
    this.changedNotice(full.email, full.name);
    return { ok: true };
  }

  // ---------------------------------------------------------------- a link made for someone else
  /**
   * A home's owner or admin (or a super admin looking after the home) makes a link for someone in it who
   * can't get the email. Never for someone who also belongs to another home or works for a company:
   * that would hand over their account elsewhere. They use "Forgot password?" instead.
   */
  async linkForHomePerson(actor: AuthUser, userId: string) {
    if (userId === actor.id) throw new BadRequestException('Change your own password from your account instead.');
    const m = await this.prisma.membership.findUnique({ where: { userId_homeId: { userId, homeId: actor.homeId } }, include: { user: true } });
    if (!m) throw new NotFoundException('No such person in this home.');
    if (actor.role !== Role.OWNER && (m.role === Role.OWNER || m.role === Role.ADMIN)) {
      throw new ForbiddenException('Only the owner can make a password link for an owner or admin.');
    }
    if (actor.staffRole === StaffRole.INSTALLER && actor.viaStaff && actor.role !== Role.OWNER) {
      throw new ForbiddenException('People and their accounts are managed by the home owner.');
    }
    const elsewhere = await this.prisma.membership.count({ where: { userId, homeId: { not: actor.homeId } } });
    if (elsewhere || m.user.staffRole) {
      throw new ForbiddenException(`${firstName(m.user.name)} also uses Switchboard elsewhere, so only they can change this password: `
        + 'they press “Forgot password?” on the sign-in page.');
    }
    if (m.user.disabled) throw new BadRequestException('This account is disabled. Enable it first.');
    const token = await this.create(userId, actor.id, MADE_TTL_MS);
    await this.audit.record(actor.homeId, actor.id, 'user.reset_link', userId, { name: m.user.name });
    return { path: `/reset/${token}`, expiresInHours: MADE_TTL_MS / 3_600_000, name: m.user.name, email: m.user.email };
  }

  /** A super admin makes a link for an installer or support person of their company. */
  async linkForStaff(actor: AuthUser, userId: string) {
    if (userId === actor.id) throw new BadRequestException('Change your own password from your account instead.');
    const target = await this.prisma.user.findFirst({ where: { id: userId, orgId: actor.orgId, staffRole: { not: null } } });
    if (!target) throw new NotFoundException('No such person on your team.');
    if (target.staffRole === StaffRole.SUPERADMIN) {
      throw new ForbiddenException('Another super admin changes their own password: “Forgot password?” on the sign-in page.');
    }
    const outside = await this.prisma.membership.count({ where: { userId, home: { orgId: { not: actor.orgId! } } } });
    if (outside) throw new ForbiddenException(`${firstName(target.name)} also has a home with another company: they use “Forgot password?”.`);
    const token = await this.create(userId, actor.id, MADE_TTL_MS);
    await this.audit.record(null, actor.id, 'staff.reset_link', userId, { name: target.name }, actor.orgId);
    return { path: `/reset/${token}`, expiresInHours: MADE_TTL_MS / 3_600_000, name: target.name, email: target.email };
  }

  // ---------------------------------------------------------------- helpers
  private async create(userId: string, createdBy: string | null, ttlMs: number) {
    const token = randomToken();
    await this.prisma.passwordReset.create({ data: { userId, createdBy, tokenHash: sha256(token), expiresAt: new Date(Date.now() + ttlMs) } });
    return token;
  }

  private async valid(token: string) {
    const r = await this.prisma.passwordReset.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
    if (!r || r.usedAt || r.expiresAt < new Date() || r.user.disabled) {
      throw new NotFoundException('This link has expired or was already used. Ask for a new one.');
    }
    return r;
  }

  private url(token: string) {
    return `${this.settings.publicUrl}/reset/${token}`;
  }

  private changedNotice(email: string, name: string) {
    void this.mail.send({
      to: email,
      subject: 'Your Switchboard password was changed',
      text: `Hi ${firstName(name)},\n\nThe password of your Switchboard account was just changed, and you were signed out on your other devices.`
        + '\n\nIf this wasn’t you, use “Forgot password?” on the sign-in page now, and tell your home owner or installer.',
    });
  }

  /** At most `max` in the last hour for this key. */
  private allow(key: string, max: number) {
    const now = Date.now();
    const recent = (this.asked.get(key) ?? []).filter((t) => now - t < 3_600_000);
    if (recent.length >= max) return false;
    recent.push(now);
    this.asked.set(key, recent);
    if (this.asked.size > 5000) this.asked.clear();      // a simple cap; this is a courtesy limit, not a wall
    return true;
  }
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] || 'there';

/** f*****@gmail.com: enough to recognise, not enough to copy. */
export function maskEmail(email: string) {
  const [user = '', domain = ''] = email.split('@');
  return `${user.slice(0, 1)}${'*'.repeat(Math.max(2, Math.min(6, user.length - 1)))}@${domain}`;
}

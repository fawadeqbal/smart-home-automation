import {
  ConflictException, ForbiddenException, HttpException, HttpStatus, Inject, Injectable, NotFoundException, UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { hash, verify } from '@node-rs/argon2';
import { OrgStatus, Role, StaffRole, User } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import type { CookieOptions, Response } from 'express';
import { SETTINGS, Settings } from '../config';
import { PrismaService } from '../prisma/prisma.service';
import {
  ACCESS_COOKIE, ACCESS_TTL_SEC, AccessClaims, AuthUser, ON_BEHALF_TTL_SEC, REFRESH_COOKIE, REFRESH_TTL_SEC,
} from './auth.types';

const TRIAL_DAYS = 14;
const RANK: Record<Role, number> = { OWNER: 4, ADMIN: 3, MEMBER: 2, GUEST: 1 };

export interface HomeContext {
  homeId: string;
  role: Role;
  viaStaff: boolean;
  readOnly: boolean;
}

const MAX_FAILED_LOGINS = 5;
const LOCK_MS = 15 * 60 * 1000;

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
export const randomToken = () => randomBytes(32).toString('base64url');

@Injectable()
export class AuthService {
  /** email -> failed attempts. In memory: fine for one API instance. */
  private readonly failures = new Map<string, { count: number; lockedUntil: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    @Inject(SETTINGS) private readonly settings: Settings,
  ) {}

  // ---------------------------------------------------------------- passwords
  hashPassword(password: string) {
    return hash(password); // argon2id with safe defaults
  }

  // ---------------------------------------------------------------- first run and sign-up
  async setupNeeded(): Promise<boolean> {
    return (await this.prisma.user.count()) === 0;
  }

  /**
   * First run of a self-hosted install: one organization, its super admin, and their own home
   * (they are its owner and its installer), so a single household can run everything itself.
   */
  async setup(input: { homeName: string; name: string; email: string; password: string }): Promise<User> {
    if (!(await this.setupNeeded())) throw new ConflictException('This platform is already set up. Sign in instead.');
    const passwordHash = await this.hashPassword(input.password);
    return this.prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({ data: { name: input.homeName, status: OrgStatus.ACTIVE, billingEmail: input.email.toLowerCase(), selfHosted: true } });
      const user = await tx.user.create({
        data: { name: input.name, email: input.email.toLowerCase(), passwordHash, orgId: org.id, staffRole: StaffRole.SUPERADMIN },
      });
      const home = await tx.home.create({ data: { orgId: org.id, name: input.homeName, installerId: user.id } });
      await tx.room.create({ data: { homeId: home.id, name: 'Living room' } });
      await tx.membership.create({ data: { userId: user.id, homeId: home.id, role: Role.OWNER } });
      return tx.user.update({ where: { id: user.id }, data: { lastHomeId: home.id } });
    });
  }

  /** A new organization (an installer company) with its first super admin, on a free trial. */
  async signup(input: { orgName: string; name: string; email: string; password: string }): Promise<User> {
    if (!this.settings.allowSignup && !(await this.setupNeeded())) throw new ForbiddenException('Sign-up is closed on this server. Ask for an invite.');
    const email = input.email.toLowerCase();
    if (await this.prisma.user.findUnique({ where: { email } })) throw new ConflictException('This email already has an account. Sign in instead.');
    const passwordHash = await this.hashPassword(input.password);
    return this.prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: { name: input.orgName, status: OrgStatus.TRIAL, trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 86400000), billingEmail: email, billingName: input.orgName },
      });
      return tx.user.create({ data: { name: input.name, email, passwordHash, orgId: org.id, staffRole: StaffRole.SUPERADMIN } });
    });
  }

  // ---------------------------------------------------------------- sign in
  async login(email: string, password: string): Promise<User> {
    const key = email.toLowerCase();
    const state = this.failures.get(key);
    if (state && state.lockedUntil > Date.now()) {
      throw new HttpException('Too many failed attempts. Try again in 15 minutes.', HttpStatus.TOO_MANY_REQUESTS);
    }
    const user = await this.prisma.user.findUnique({ where: { email: key } });
    const ok = user ? await verify(user.passwordHash, password) : false;
    if (!user || !ok) {
      const count = (state?.count ?? 0) + 1;
      this.failures.set(key, { count, lockedUntil: count >= MAX_FAILED_LOGINS ? Date.now() + LOCK_MS : 0 });
      throw new UnauthorizedException('Wrong email or password.');
    }
    if (user.disabled) throw new ForbiddenException('This account is disabled. Ask the home owner or your administrator.');
    this.failures.delete(key);
    return user;
  }

  /** Creates a session (refresh token) and sets both cookies. */
  async startSession(user: User, res: Response, userAgent?: string) {
    const refresh = randomToken();
    await this.prisma.session.create({
      data: {
        userId: user.id,
        refreshHash: sha256(refresh),
        userAgent: userAgent?.slice(0, 200),
        expiresAt: new Date(Date.now() + REFRESH_TTL_SEC * 1000),
      },
    });
    this.setCookies(res, user.id, refresh);
  }

  /** Swaps a valid refresh token for a new pair (rotation: each refresh token works once). */
  async refresh(refreshToken: string | undefined, res: Response) {
    if (!refreshToken) throw new UnauthorizedException('Not signed in.');
    const session = await this.prisma.session.findUnique({
      where: { refreshHash: sha256(refreshToken) },
      include: { user: true },
    });
    if (!session || session.revokedAt || session.expiresAt < new Date() || session.user.disabled) {
      this.clearCookies(res);
      throw new UnauthorizedException('Session expired. Sign in again.');
    }
    const next = randomToken();
    await this.prisma.session.update({
      where: { id: session.id },
      data: { refreshHash: sha256(next), expiresAt: new Date(Date.now() + REFRESH_TTL_SEC * 1000) },
    });
    this.setCookies(res, session.userId, next);
    return session.user;
  }

  async logout(refreshToken: string | undefined, res: Response) {
    if (refreshToken) {
      await this.prisma.session.updateMany({
        where: { refreshHash: sha256(refreshToken), revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    this.clearCookies(res);
  }

  // ---------------------------------------------------------------- tokens
  /**
   * Verifies a token, loads the person and the home the request is about.
   * typ "obo" = the assistant acting for them (the home is inside the token).
   */
  async authenticate(token: string, allowed: AccessClaims['typ'][], requestedHome?: string): Promise<AuthUser> {
    let claims: AccessClaims;
    try {
      claims = await this.jwt.verifyAsync<AccessClaims>(token);
    } catch {
      throw new UnauthorizedException('Not signed in or session expired.');
    }
    if (!allowed.includes(claims.typ)) throw new UnauthorizedException('Wrong kind of token.');
    const user = await this.prisma.user.findUnique({ where: { id: claims.sub } });
    if (!user || user.disabled) throw new UnauthorizedException('Account not available.');
    const home = await this.resolveHome(user, claims.typ === 'obo' ? claims.hid : requestedHome);
    return {
      id: user.id, name: user.name, email: user.email, orgId: user.orgId, staffRole: user.staffRole,
      channel: claims.typ === 'obo' ? 'voice' : 'web',
      homeId: home?.homeId ?? '', role: home?.role ?? Role.GUEST, viaStaff: home?.viaStaff ?? false, readOnly: home?.readOnly ?? false,
    };
  }

  /**
   * The person's access to a home: from a membership, from their staff role (same organization;
   * installers only on homes assigned to them), or both — whichever gives more.
   * With no home asked for: the last home they used, else their first one, else none.
   * A home they may not open is "not found", so its existence does not leak.
   */
  async resolveHome(user: Pick<User, 'id' | 'orgId' | 'staffRole' | 'lastHomeId'>, requested?: string): Promise<HomeContext | null> {
    if (!requested) {
      const memberships = await this.prisma.membership.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'asc' } });
      const pick = memberships.find((m) => m.homeId === user.lastHomeId) ?? memberships[0];
      if (pick) return user.staffRole ? this.resolveHome(user, pick.homeId) : { homeId: pick.homeId, role: pick.role, viaStaff: false, readOnly: false };
      if (user.staffRole && user.lastHomeId) return this.resolveHome(user, user.lastHomeId).catch(() => null);
      return null;
    }
    const [membership, home] = await Promise.all([
      this.prisma.membership.findUnique({ where: { userId_homeId: { userId: user.id, homeId: requested } } }),
      this.prisma.home.findUnique({ where: { id: requested }, select: { orgId: true, installerId: true } }),
    ]);
    if (!home) throw new NotFoundException('No such home.');
    let staff: HomeContext | null = null;
    if (user.staffRole && user.orgId === home.orgId) {
      if (user.staffRole === StaffRole.SUPERADMIN) staff = { homeId: requested, role: Role.OWNER, viaStaff: true, readOnly: false };
      else if (user.staffRole === StaffRole.INSTALLER && home.installerId === user.id) staff = { homeId: requested, role: Role.ADMIN, viaStaff: true, readOnly: false };
      else if (user.staffRole === StaffRole.SUPPORT) staff = { homeId: requested, role: Role.ADMIN, viaStaff: true, readOnly: true };
    }
    const own: HomeContext | null = membership ? { homeId: requested, role: membership.role, viaStaff: false, readOnly: false } : null;
    if (staff && own) {
      if (staff.readOnly) return own; // a member's own rights beat read-only support access
      return { ...staff, role: RANK[own.role] > RANK[staff.role] ? own.role : staff.role };
    }
    const ctx = staff ?? own;
    if (!ctx) throw new NotFoundException('No such home.');
    return ctx;
  }

  /** Short-lived token the voice assistant uses to act with this person's rights, in this home. */
  onBehalfToken(user: AuthUser): Promise<string> {
    return this.jwt.signAsync({ sub: user.id, typ: 'obo', hid: user.homeId } satisfies AccessClaims, { expiresIn: ON_BEHALF_TTL_SEC });
  }

  /** Builds the identity a schedule runs with: its creator, in the schedule's home. */
  async actorFor(userId: string, homeId: string, channel: AuthUser['channel']): Promise<AuthUser | null> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.disabled) return null;
    const home = await this.resolveHome(user, homeId).catch(() => null);
    if (!home) return null;
    return { id: user.id, name: user.name, email: user.email, orgId: user.orgId, staffRole: user.staffRole, channel, ...home };
  }

  private cookieOptions(maxAgeSec: number, path = '/'): CookieOptions {
    return { httpOnly: true, secure: this.settings.cookieSecure, sameSite: 'lax', path, maxAge: maxAgeSec * 1000 };
  }

  private setCookies(res: Response, userId: string, refresh: string) {
    const access = this.jwt.sign({ sub: userId, typ: 'access' } satisfies AccessClaims, { expiresIn: ACCESS_TTL_SEC });
    res.cookie(ACCESS_COOKIE, access, this.cookieOptions(ACCESS_TTL_SEC));
    res.cookie(REFRESH_COOKIE, refresh, this.cookieOptions(REFRESH_TTL_SEC, '/api/auth'));
  }

  private clearCookies(res: Response) {
    res.clearCookie(ACCESS_COOKIE, { path: '/' });
    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
  }
}

import {
  BadRequestException, ConflictException, ForbiddenException, GoneException, Injectable, NotFoundException, UnauthorizedException,
} from '@nestjs/common';
import { verify } from '@node-rs/argon2';
import { Access, Prisma, Role, StaffRole } from '@prisma/client';
import { AuthService, randomToken, sha256 } from '../auth/auth.service';
import { AuthUser, canSetup, isAdmin } from '../auth/auth.types';
import { AuditService } from '../common/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { PLANS } from '../platform/plans';

const INVITE_TTL_MS = 7 * 24 * 3600 * 1000;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
  ) {}

  /**
   * Who I am: my homes, my staff role and organization, and the home this request is about
   * (with my role, rights per room and whether I can set it up).
   */
  async me(userId: string, ctx?: Pick<AuthUser, 'homeId' | 'role' | 'viaStaff' | 'readOnly'>) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { org: true, memberships: { include: { home: { select: { id: true, name: true, city: true, archivedAt: true } } }, orderBy: { createdAt: 'asc' } } },
    });
    const home = ctx ?? (await this.auth.resolveHome(user));
    const current = home?.homeId
      ? await this.prisma.home.findUnique({ where: { id: home.homeId }, select: { id: true, name: true, city: true, timezone: true, orgId: true } })
      : null;
    const rooms = current ? await this.prisma.roomAccess.findMany({ where: { userId, room: { homeId: current.id } } }) : [];
    return {
      id: user.id, name: user.name, email: user.email,
      staff: user.staffRole && user.org
        ? {
            role: user.staffRole,
            org: {
              id: user.org.id, name: user.org.name, plan: user.org.plan, planName: PLANS[user.org.plan].name,
              status: user.org.status, trialEndsAt: user.org.trialEndsAt,
            },
          }
        : null,
      homes: user.memberships.filter((m) => !m.home.archivedAt).map((m) => ({ id: m.home.id, name: m.home.name, city: m.home.city, role: m.role })),
      home: current && home
        ? {
            id: current.id, name: current.name, city: current.city, timezone: current.timezone,
            role: home.role, viaStaff: home.viaStaff, readOnly: home.readOnly,
            canSetup: canSetup({ staffRole: user.staffRole, viaStaff: home.viaStaff, homeId: current.id }),
          }
        : null,
      // kept for older clients: the role in the current home
      role: home?.role ?? null,
      rooms: rooms.map((r) => ({ roomId: r.roomId, access: r.access })),
    };
  }

  /** People of the current home, and the installer who looks after it. */
  async list(actor: AuthUser) {
    const [members, home] = await Promise.all([
      this.prisma.membership.findMany({
        where: { homeId: actor.homeId },
        include: { user: { include: { rooms: { where: { room: { homeId: actor.homeId } } } } } },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.home.findUniqueOrThrow({ where: { id: actor.homeId }, include: { installer: { select: { id: true, name: true, email: true } } } }),
    ]);
    const order: Record<Role, number> = { OWNER: 0, ADMIN: 1, MEMBER: 2, GUEST: 3 };
    const people = members
      .sort((a, b) => order[a.role] - order[b.role])
      .map((m) => ({
        id: m.user.id, name: m.user.name, email: m.user.email, role: m.role, disabled: m.user.disabled, staff: null as StaffRole | null,
        joinedAt: m.createdAt, rooms: m.user.rooms.map((r) => ({ roomId: r.roomId, access: r.access })),
      }));
    if (home.installer && !people.some((p) => p.id === home.installer!.id)) {
      people.push({
        id: home.installer.id, name: home.installer.name, email: home.installer.email, role: null as unknown as Role,
        disabled: false, staff: StaffRole.INSTALLER, joinedAt: home.createdAt, rooms: [],
      });
    }
    return people;
  }

  /** Owners may change anyone but themselves; admins may manage members and guests only. */
  private async target(actor: AuthUser, userId: string) {
    const membership = await this.prisma.membership.findUnique({
      where: { userId_homeId: { userId, homeId: actor.homeId } }, include: { user: true },
    });
    if (!membership) throw new NotFoundException('No such person in this home.');
    if (userId === actor.id) throw new BadRequestException('You cannot change your own account here.');
    if (actor.role !== Role.OWNER && isAdmin(membership.role)) {
      throw new ForbiddenException('Only the owner can change an owner or admin.');
    }
    if (actor.staffRole === StaffRole.INSTALLER && actor.viaStaff && actor.role !== Role.OWNER) {
      throw new ForbiddenException('People and access are managed by the home owner.');
    }
    return membership;
  }

  async update(actor: AuthUser, userId: string, input: { role?: Role; disabled?: boolean; name?: string }) {
    const m = await this.target(actor, userId);
    if (input.role === Role.OWNER) throw new BadRequestException('A home has exactly one owner.');
    if (input.role === Role.ADMIN && actor.role !== Role.OWNER) {
      throw new ForbiddenException('Only the owner can make someone an admin.');
    }
    if (input.role && input.role !== m.role) {
      await this.prisma.membership.update({ where: { userId_homeId: { userId, homeId: actor.homeId } }, data: { role: input.role } });
    }
    const userData: { name?: string; disabled?: boolean } = {};
    if (input.name !== undefined) userData.name = input.name;
    if (input.disabled !== undefined) {
      const elsewhere = await this.prisma.membership.count({ where: { userId, homeId: { not: actor.homeId } } });
      if (elsewhere || m.user.staffRole) throw new BadRequestException('This person also belongs to other homes. Remove them from this home instead.');
      userData.disabled = input.disabled;
    }
    const updated = Object.keys(userData).length ? await this.prisma.user.update({ where: { id: userId }, data: userData }) : m.user;
    if (input.disabled) {
      await this.prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    await this.audit.record(actor.homeId, actor.id, 'user.update', userId, { ...input, name: updated.name });
    this.realtime.accessChanged(userId);
    return { id: updated.id, role: input.role ?? m.role, disabled: updated.disabled, name: updated.name };
  }

  async setRooms(actor: AuthUser, userId: string, rooms: { roomId: string; access: Access }[]) {
    const m = await this.target(actor, userId);
    const valid = await this.prisma.room.findMany({ where: { homeId: actor.homeId, id: { in: rooms.map((r) => r.roomId) } } });
    if (valid.length !== new Set(rooms.map((r) => r.roomId)).size) throw new BadRequestException('Unknown room.');
    const clean = rooms.map((r) => ({ ...r, access: m.role === Role.GUEST && r.access === Access.MANAGE ? Access.CONTROL : r.access }));
    await this.prisma.$transaction([
      this.prisma.roomAccess.deleteMany({ where: { userId, room: { homeId: actor.homeId } } }),
      this.prisma.roomAccess.createMany({ data: clean.map((r) => ({ userId, roomId: r.roomId, access: r.access })) }),
    ]);
    const names = new Map(valid.map((r) => [r.id, r.name]));
    await this.audit.record(actor.homeId, actor.id, 'room.access', userId, {
      name: m.user.name, rooms: clean.map((r) => ({ room: names.get(r.roomId), access: r.access })),
    });
    this.realtime.accessChanged(userId);
    return { ok: true };
  }

  /** Takes the person out of this home. An account that belongs nowhere else is deleted. */
  async remove(actor: AuthUser, userId: string) {
    const m = await this.target(actor, userId);
    if (m.role === Role.OWNER) throw new BadRequestException('The owner cannot be removed.');
    await this.prisma.$transaction([
      this.prisma.roomAccess.deleteMany({ where: { userId, room: { homeId: actor.homeId } } }),
      this.prisma.membership.delete({ where: { userId_homeId: { userId, homeId: actor.homeId } } }),
    ]);
    const left = await this.prisma.membership.count({ where: { userId } });
    if (!left && !m.user.staffRole) await this.prisma.user.delete({ where: { id: userId } });
    await this.audit.record(actor.homeId, actor.id, 'user.remove', userId, { email: m.user.email, name: m.user.name });
    this.realtime.accessChanged(userId);
  }

  // ---------------------------------------------------------------- invites into a home
  async invite(actor: AuthUser, email: string, role: Role, name?: string, rooms: { roomId: string; access: Access }[] = []) {
    const staffInstaller = actor.staffRole === StaffRole.INSTALLER && actor.viaStaff && actor.role !== Role.OWNER;
    if (role === Role.OWNER) {
      if (!actor.viaStaff) throw new BadRequestException('A home has exactly one owner.');
      if (await this.prisma.membership.findFirst({ where: { homeId: actor.homeId, role: Role.OWNER } })) {
        throw new BadRequestException('This home already has an owner.');
      }
      // staff cannot hand a customer's home to themselves (or a colleague)
      const home = await this.prisma.home.findUniqueOrThrow({ where: { id: actor.homeId }, select: { orgId: true } });
      if (await this.prisma.user.findFirst({ where: { email, orgId: home.orgId, staffRole: { not: null } } })) {
        throw new ForbiddenException('The owner must be the customer, not someone on your team.');
      }
      await this.prisma.invite.deleteMany({ where: { homeId: actor.homeId, role: Role.OWNER, usedAt: null } }); // one owner invite at a time
    } else if (staffInstaller) {
      throw new ForbiddenException('Installers can only send the owner invite. The owner invites everyone else.');
    }
    if (role === Role.ADMIN && actor.role !== Role.OWNER) throw new ForbiddenException('Only the owner can invite an admin.');
    const existing = await this.prisma.user.findUnique({ where: { email }, include: { memberships: { where: { homeId: actor.homeId } } } });
    if (existing?.memberships.length) throw new ConflictException('This person is already in this home.');
    if (rooms.length) {
      const valid = await this.prisma.room.count({ where: { homeId: actor.homeId, id: { in: rooms.map((r) => r.roomId) } } });
      if (valid !== new Set(rooms.map((r) => r.roomId)).size) throw new BadRequestException('Unknown room.');
    }
    await this.prisma.invite.deleteMany({ where: { homeId: actor.homeId, email, usedAt: null } }); // a new link replaces an old one
    const token = randomToken();
    await this.prisma.invite.create({
      data: {
        homeId: actor.homeId, email, name: name ?? null, role, tokenHash: sha256(token), createdBy: actor.id,
        expiresAt: new Date(Date.now() + INVITE_TTL_MS), rooms: rooms as unknown as Prisma.InputJsonValue,
      },
    });
    await this.audit.record(actor.homeId, actor.id, 'user.invite', email, { role, name, rooms: rooms.length });
    return { token, path: `/invite/${token}`, expiresInDays: 7, existingAccount: !!existing };
  }

  async listInvites(actor: AuthUser) {
    return this.prisma.invite.findMany({
      where: { homeId: actor.homeId, usedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, email: true, name: true, role: true, expiresAt: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revokeInvite(actor: AuthUser, id: string) {
    const installerOnly = actor.staffRole === StaffRole.INSTALLER && actor.viaStaff && actor.role !== Role.OWNER;
    // installers may withdraw only the owner invite they are allowed to send
    const { count } = await this.prisma.invite.deleteMany({ where: { id, homeId: actor.homeId, ...(installerOnly ? { role: Role.OWNER } : {}) } });
    if (!count) throw new NotFoundException('No such invite.');
    await this.audit.record(actor.homeId, actor.id, 'invite.revoke', id);
  }

  // ---------------------------------------------------------------- accepting any invite (home or staff)
  private async openInvite(token: string) {
    const invite = await this.prisma.invite.findUnique({ where: { tokenHash: sha256(token) }, include: { home: true, org: true } });
    if (!invite || invite.usedAt || invite.expiresAt < new Date()) {
      throw new GoneException('This invite link is no longer valid. Ask for a new one.');
    }
    return invite;
  }

  async describeInvite(token: string) {
    const invite = await this.openInvite(token);
    const existing = await this.prisma.user.findUnique({ where: { email: invite.email }, select: { id: true } });
    return {
      email: invite.email, name: invite.name, role: invite.role, staffRole: invite.staffRole,
      homeName: invite.home?.name ?? null, orgName: invite.org?.name ?? null, existingAccount: !!existing,
    };
  }

  /** New people choose a name and password; people with an account confirm with their password. */
  async acceptInvite(token: string, name: string | undefined, password: string) {
    const invite = await this.openInvite(token);
    let user = await this.prisma.user.findUnique({ where: { email: invite.email } });
    if (user) {
      if (!(await verify(user.passwordHash, password))) throw new UnauthorizedException('Wrong password for this account.');
      if (user.disabled) throw new ForbiddenException('This account is disabled.');
    } else if (!name?.trim()) {
      throw new BadRequestException('Enter your name.');
    }
    if (invite.staffRole && user?.staffRole && user.orgId !== invite.orgId) {
      throw new ConflictException('This account already works for another organization.');
    }
    const passwordHash = user ? null : await this.auth.hashPassword(password);
    const rooms = invite.homeId ? ((invite.rooms ?? []) as unknown as { roomId: string; access: Access }[]) : [];
    user = await this.prisma.$transaction(async (tx) => {
      await tx.invite.update({ where: { id: invite.id }, data: { usedAt: new Date() } });
      const u = user ?? (await tx.user.create({ data: { email: invite.email, name: name!.trim(), passwordHash: passwordHash! } }));
      if (invite.staffRole && invite.orgId) {
        await tx.user.update({ where: { id: u.id }, data: { orgId: invite.orgId, staffRole: invite.staffRole } });
      }
      if (invite.homeId && invite.role) {
        if (invite.role === Role.OWNER) {
          const owner = await tx.membership.findFirst({ where: { homeId: invite.homeId, role: Role.OWNER, userId: { not: u.id } } });
          if (owner) throw new ConflictException('This home already has an owner.');
          const home = await tx.home.findUniqueOrThrow({ where: { id: invite.homeId }, select: { orgId: true } });
          if (u.staffRole && u.orgId === home.orgId) throw new ForbiddenException('The owner must be the customer, not someone on the installer’s team.');
        }
        await tx.membership.upsert({
          where: { userId_homeId: { userId: u.id, homeId: invite.homeId } },
          create: { userId: u.id, homeId: invite.homeId, role: invite.role },
          update: { role: invite.role },
        });
        const live = rooms.length ? await tx.room.findMany({ where: { homeId: invite.homeId, id: { in: rooms.map((r) => r.roomId) } }, select: { id: true } }) : [];
        const keep = rooms.filter((r) => live.some((l) => l.id === r.roomId));
        if (keep.length) await tx.roomAccess.createMany({ data: keep.map((r) => ({ userId: u.id, roomId: r.roomId, access: r.access })), skipDuplicates: true });
        await tx.user.update({ where: { id: u.id }, data: { lastHomeId: invite.homeId } });
      }
      return tx.user.findUniqueOrThrow({ where: { id: u.id } });
    });
    await this.audit.record(invite.homeId, user.id, invite.staffRole ? 'staff.join' : 'invite.accept', user.id,
      { email: user.email, name: user.name, role: invite.role ?? invite.staffRole }, invite.orgId);
    return user;
  }
}

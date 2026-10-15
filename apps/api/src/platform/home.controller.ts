import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { Role, StaffRole } from '@prisma/client';
import { z } from 'zod';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import { AuditService } from '../common/audit.service';
import { ZodPipe } from '../common/zod';
import { MonitoringService } from '../monitoring/monitoring.service';
import { PrismaService } from '../prisma/prisma.service';
import { PlatformService } from './platform.service';

/** Things about the current home as a whole: its activity log, and asking the installer/support for help. */
@Controller('home')
export class HomeController {
  constructor(
    private readonly platform: PlatformService,
    private readonly prisma: PrismaService,
    private readonly monitoring: MonitoringService,
    private readonly audit: AuditService,
  ) {}

  /** Changes to this home — by its people, its installer and the system. */
  @Roles('OWNER', 'ADMIN')
  @Get('activity')
  activity(@CurrentUser() user: AuthUser, @Query('category') category?: string, @Query('limit') limit?: string) {
    return this.platform.auditRows({ homeId: user.homeId }, category, Math.min(500, Math.max(1, Number(limit) || 100)));
  }

  /** The first-visit tour: rooms and what is in them, who set the home up, and a light to try. */
  @Get('welcome')
  async welcome(@CurrentUser() user: AuthUser) {
    const home = await this.prisma.home.findUniqueOrThrow({
      where: { id: user.homeId }, select: { id: true, name: true, city: true, orgId: true, installerId: true, org: { select: { name: true, logo: true } } },
    });
    const [rooms, installer, devices] = await Promise.all([
      this.prisma.room.findMany({ where: { homeId: home.id }, orderBy: [{ order: 'asc' }, { name: 'asc' }], select: { id: true, name: true, _count: { select: { devices: true } } } }),
      home.installerId ? this.prisma.user.findUnique({ where: { id: home.installerId }, select: { name: true } }) : null,
      this.prisma.device.findMany({
        where: { node: { homeId: home.id }, type: 'switch' },
        select: { id: true, name: true, room: { select: { name: true, order: true } }, node: { select: { online: true } }, state: { select: { state: true } } },
      }),
    ]);
    // a light to try: one that is online, in the first room, and called a light if possible
    const score = (d: (typeof devices)[number]) => (d.node.online ? 0 : 100) + (d.room?.order ?? 50) + (/light|bulb|lamp|batti/i.test(d.name) ? 0 : 10);
    const pick = [...devices].sort((a, b) => score(a) - score(b))[0];
    return {
      home: { name: home.name, city: home.city },
      org: home.org, installer: installer?.name ?? null,
      rooms: rooms.map((r) => ({ id: r.id, name: r.name, devices: r._count.devices })),
      devices: devices.length,
      tryDevice: pick ? { id: pick.id, name: pick.name, room: pick.room?.name ?? null, online: pick.node.online, on: (pick.state?.state as { on?: boolean } | null)?.on === true } : null,
    };
  }

  /** Finished (or skipped) the first-visit tour of this home. */
  @Post('onboarded')
  @HttpCode(204)
  async onboarded(@CurrentUser() user: AuthUser) {
    await this.prisma.membership.updateMany({ where: { userId: user.id, homeId: user.homeId, onboardedAt: null }, data: { onboardedAt: new Date() } });
  }

  /** "Send to support": a notice for the organization's support staff, super admins and the installer. */
  @Roles('OWNER', 'ADMIN')
  @Post('support')
  @HttpCode(200)
  async support(@CurrentUser() user: AuthUser,
                @Body(new ZodPipe(z.object({ message: z.string().trim().min(1).max(1000), nodeId: z.string().max(64).optional() }))) body: { message: string; nodeId?: string }) {
    const home = await this.prisma.home.findUniqueOrThrow({ where: { id: user.homeId }, select: { id: true, name: true, orgId: true, installerId: true } });
    const staff = await this.prisma.user.findMany({
      where: { orgId: home.orgId, disabled: false, OR: [{ staffRole: { in: [StaffRole.SUPPORT, StaffRole.SUPERADMIN] } }, { id: home.installerId ?? '' }] },
      select: { id: true },
    });
    await this.monitoring.notify(home.id, staff.map((s) => s.id).filter((id) => id !== user.id), {
      kind: 'supportRequest', severity: 'WARN', title: `Help requested · ${home.name}`,
      body: `${user.name}: ${body.message}`, link: `/console/homes/${home.id}?tab=diagnostics${body.nodeId ? `&board=${body.nodeId}` : ''}`,
    });
    await this.audit.record(home.id, user.id, 'support.request', body.nodeId ?? home.id, { message: body.message });
    return { sent: staff.length, role: user.role === Role.OWNER ? 'owner' : 'admin' };
  }
}

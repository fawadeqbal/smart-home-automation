import { Injectable } from '@nestjs/common';
import { StaffRole } from '@prisma/client';
import { MonitoringService, Notice } from '../monitoring/monitoring.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Notices for a company's super admins about the company as a whole (a contract ending, stock
 * running low, a customer answering a quote). They go through the same delivery as every other
 * notice (the bell, live updates, push), so whatever reaches people's phones reaches these too.
 */
@Injectable()
export class StaffNoticesService {
  constructor(private readonly prisma: PrismaService, private readonly monitoring: MonitoringService) {}

  async superAdmins(orgId: string, notice: Notice, homeId?: string | null) {
    const admins = await this.prisma.user.findMany({ where: { orgId, staffRole: StaffRole.SUPERADMIN, disabled: false }, select: { id: true } });
    if (!admins.length) return 0;
    // a notice belongs to a home; for company-wide ones any of the company's homes will do (as for firmware rollouts)
    const home = homeId ?? (await this.prisma.home.findFirst({ where: { orgId }, orderBy: { createdAt: 'asc' }, select: { id: true } }))?.id ?? '';
    await this.monitoring.notify(home, admins.map((a) => a.id), notice);
    return admins.length;
  }

  /** The same, for chosen staff (an installer given a new job). */
  async people(userIds: string[], notice: Notice, homeId: string) {
    if (userIds.length) await this.monitoring.notify(homeId, userIds, notice);
  }
}

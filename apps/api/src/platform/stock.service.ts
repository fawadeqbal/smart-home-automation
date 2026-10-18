import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { NodeStatus } from '@prisma/client';
import { stockAlert } from './stock-rule';
import { StaffNoticesService } from '../common/staff-notices.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * "Warn me when boards in stock drop below N" (Company settings). Checked whenever the inventory
 * changes in the console, and every hour for changes made elsewhere. The warning goes out once; it
 * is armed again only after stock has gone back up to the minimum (the time it was sent is stored,
 * so a restart doesn't send it twice).
 */
@Injectable()
export class StockService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Stock');
  private timer?: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaService, private readonly notices: StaffNoticesService) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.checkAll(), 60 * 60_000);
  }
  onModuleDestroy() {
    clearInterval(this.timer);
  }

  /** Boards in stock, and the minimum (0: no warning). */
  async level(orgId: string) {
    const [org, inStock] = await Promise.all([
      this.prisma.organization.findUniqueOrThrow({ where: { id: orgId }, select: { stockMin: true } }),
      this.prisma.node.count({ where: { orgId, status: NodeStatus.STOCK } }),
    ]);
    return { inStock, min: org.stockMin, low: org.stockMin > 0 && inStock < org.stockMin };
  }

  async check(orgId: string) {
    try {
      const org = await this.prisma.organization.findUnique({ where: { id: orgId }, select: { stockMin: true, stockAlertAt: true } });
      if (!org) return;
      const inStock = await this.prisma.node.count({ where: { orgId, status: NodeStatus.STOCK } });
      const what = stockAlert(inStock, org.stockMin, org.stockAlertAt);
      if (what === 'reset') {
        await this.prisma.organization.update({ where: { id: orgId }, data: { stockAlertAt: null } });
      } else if (what === 'alert') {
        // claim the warning first, so two changes at once send it only once
        const claimed = await this.prisma.organization.updateMany({ where: { id: orgId, stockAlertAt: null }, data: { stockAlertAt: new Date() } });
        if (!claimed.count) return;
        this.log.log(`Low stock: ${inStock} of ${org.stockMin}`);
        await this.notices.superAdmins(orgId, {
          kind: 'stockLow', severity: 'WARN',
          title: inStock === 0 ? 'No boards left in stock' : `Only ${inStock} board${inStock === 1 ? '' : 's'} left in stock`,
          body: `You asked to be told below ${org.stockMin}. Order more boards before the next installations.`,
          link: '/console/inventory',
        });
      }
    } catch (err) {
      this.log.warn(`Stock check failed: ${(err as Error).message}`);
    }
  }

  private async checkAll() {
    const orgs = await this.prisma.organization.findMany({ where: { OR: [{ stockMin: { gt: 0 } }, { stockAlertAt: { not: null } }] }, select: { id: true } }).catch(() => []);
    for (const o of orgs) await this.check(o.id);
  }
}

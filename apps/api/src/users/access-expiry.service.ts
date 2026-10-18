import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Role } from '@prisma/client';
import { checkAccess, hasLimits, whenText } from '../access/access-window';
import { AuditService } from '../common/audit.service';
import { LocalService } from '../hardware/local.service';
import { MonitoringService } from '../monitoring/monitoring.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';

const TICK_MS = Number(process.env.ACCESS_TICK_MS) || 60_000;

/**
 * What happens around time-limited access, once a minute. The check itself is exact and done on every
 * request (AuthService.resolveHome); this only does the side effects:
 *  - phone passes that ran out are retired on the boards (the home's epoch goes up),
 *  - someone whose end has come is marked expired and the owners and admins are told,
 *  - someone whose hours start or end gets their live connection re-made (so it follows their rights).
 */
@Injectable()
export class AccessExpiryService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Access');
  private timer?: NodeJS.Timeout;
  private running = false;
  /** "<user>:<home>" -> inside their access at the last tick */
  private readonly inside = new Map<string, boolean>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly local: LocalService,
    private readonly monitoring: MonitoringService,
    private readonly realtime: RealtimeService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.tick(), TICK_MS);
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  async tick(now = new Date()) {
    if (this.running) return;
    this.running = true;
    try {
      await this.local.expirePasses(now);
      await this.expire(now);
      await this.followHours(now);
    } catch (err) {
      this.log.warn(`access check failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /** People whose end has come: once each (until someone extends it). */
  private async expire(now: Date) {
    const due = await this.prisma.membership.findMany({
      where: { accessUntil: { lte: now }, expiredAt: null, role: { in: [Role.MEMBER, Role.GUEST] } },
      include: { user: { select: { name: true } }, home: { select: { name: true, timezone: true } } },
      take: 100,
    });
    for (const m of due) {
      await this.prisma.membership.update({ where: { userId_homeId: { userId: m.userId, homeId: m.homeId } }, data: { expiredAt: now } });
      await this.local.revoke(m.homeId);
      // they no longer count for "who's home"
      await this.prisma.presence.deleteMany({ where: { userId: m.userId, homeId: m.homeId } });
      this.realtime.accessChanged(m.userId);
      await this.audit.record(m.homeId, null, 'user.expired', m.userId, { name: m.user.name, until: m.accessUntil });
      await this.monitoring.toHomeAdmins(m.homeId, {
        kind: 'accessEnded', severity: 'INFO', title: `${m.user.name}’s access ended`,
        body: `${m.user.name} could use ${m.home.name} until ${whenText(m.accessUntil!, m.home.timezone)}. Extend it or remove them on the People page.`,
        link: `/people?home=${m.homeId}`,
      }, `expired:${m.userId}:${m.homeId}:${m.accessUntil!.getTime()}`, 60_000);
      this.log.log(`${m.user.name}'s access to ${m.home.name} ended`);
    }
  }

  /** Hours starting or ending: the person's live connection is re-made with their rights of now. */
  private async followHours(now: Date) {
    const rows = await this.prisma.membership.findMany({
      where: {
        role: { in: [Role.MEMBER, Role.GUEST] },
        OR: [{ accessFrom: { not: null } }, { NOT: { accessDays: { isEmpty: true } } }],
      },
      select: { userId: true, homeId: true, accessUntil: true, accessFrom: true, accessTo: true, accessDays: true, home: { select: { timezone: true } } },
    });
    const seen = new Set<string>();
    for (const m of rows) {
      if (!hasLimits(m)) continue;
      const key = `${m.userId}:${m.homeId}`;
      seen.add(key);
      const ok = checkAccess(m, m.home.timezone, now).ok;
      const before = this.inside.get(key);
      this.inside.set(key, ok);
      if (before !== undefined && before !== ok) this.realtime.accessChanged(m.userId);
    }
    for (const key of [...this.inside.keys()]) if (!seen.has(key)) this.inside.delete(key);
  }
}

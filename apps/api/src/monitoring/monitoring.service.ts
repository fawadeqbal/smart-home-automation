import { Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, Role, Severity } from '@prisma/client';
import { AuthUser, isAdmin } from '../auth/auth.types';
import { zoneOffsetMinutes } from '../automation/time';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { PushService } from './push.service';

/** Kinds of notice and whether people get them unless they switch them off. */
export const NOTICE_KINDS = {
  leak: { label: 'Water leak detected', default: true, adminsOnly: false },
  doorAtNight: { label: 'Door or window opened at night (10 pm – 6 am)', default: true, adminsOnly: false },
  motionAtNight: { label: 'Motion at night (10 pm – 6 am)', default: false, adminsOnly: false },
  temperature: { label: 'Very hot or cold room (above 40 °C or below 5 °C)', default: true, adminsOnly: false },
  scheduleFailed: { label: 'One of my timers or schedules failed', default: true, adminsOnly: false },
  boardOffline: { label: 'A board disconnected or came back', default: true, adminsOnly: true },
  boardHealth: { label: 'A board has low voltage or weak Wi‑Fi', default: true, adminsOnly: true },
  powerCut: { label: 'A power cut at home (when the power is back)', default: true, adminsOnly: false },
  boardDown: { label: 'A board has been offline for an hour, or an area power cut (staff)', default: true, adminsOnly: true },
  awayAlert: { label: 'A door, window or motion sensor while the home is in away mode', default: true, adminsOnly: false },
  automation: { label: 'My rules ("when this happens, tell me")', default: true, adminsOnly: false },
  weeklySummary: { label: 'A summary of the week, on Sunday evening', default: true, adminsOnly: true },
  dailySummary: { label: 'A summary of the day, every evening at 9 pm', default: false, adminsOnly: true },
  summaryEmail: { label: 'Also email me the weekly summary', default: true, adminsOnly: true },
  backup: { label: 'A backup of the server failed (super admins)', default: true, adminsOnly: true },
  firmware: { label: 'A firmware rollout finished or stopped (staff)', default: true, adminsOnly: true },
  billing: { label: 'A new bill, a payment received, or a bill that is late', default: true, adminsOnly: true },
  installation: { label: 'The installation was signed off', default: true, adminsOnly: true },
  ticketReply: { label: 'An answer to my help request', default: true, adminsOnly: false },
  supportRequest: { label: 'A home owner asked for help (staff)', default: true, adminsOnly: true },
  security: { label: 'Someone keeps trying to sign in to my account', default: true, adminsOnly: false },
  boardReplaced: { label: 'A board was replaced or is waiting for a replacement', default: true, adminsOnly: true },
} as const;
export type NoticeKind = keyof typeof NOTICE_KINDS;

export interface Notice { kind: NoticeKind; severity: Severity; title: string; body: string; link?: string }

const HOUR = 3600000;
const SAMPLE_DAYS = 14;
const NOTICE_DAYS = 30;

/**
 * Watches what boards and sensors report, keeps board health history for charts, and turns
 * important events into notices for the right people (only those who can see that room).
 */
@Injectable()
export class MonitoringService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Monitoring');
  private readonly lastSent = new Map<string, number>(); // cooldown per kind + device/board
  private cleanup?: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaService, private readonly realtime: RealtimeService, private readonly push: PushService) {}

  onModuleInit() {
    this.cleanup = setInterval(() => void this.prune(), 6 * HOUR);
    void this.prune();
  }
  onModuleDestroy() {
    clearInterval(this.cleanup);
  }

  // ---------------------------------------------------------------- inputs (called by the other services)
  async deviceState(device: { id: string; name: string; type: string; roomId: string | null; settings: unknown; node: { homeId: string } },
                    before: Record<string, unknown> | null, now: Record<string, unknown>) {
    const homeId = device.node.homeId;
    const settings = (device.settings ?? {}) as { kind?: string };
    const link = `/devices/${device.id}?home=${homeId}`;
    const room = device.roomId ? (await this.prisma.room.findUnique({ where: { id: device.roomId } }))?.name : null;
    const where = room ? ` in the ${room}` : '';

    if (device.type === 'contact' && now.active === true && before?.active !== true) {
      const kind = settings.kind ?? 'generic';
      const away = kind === 'door' || kind === 'window' || kind === 'motion'
        ? (await this.prisma.home.findUnique({ where: { id: homeId }, select: { awayMode: true } }))?.awayMode === true : false;
      if (away) {
        const what = kind === 'motion' ? `Movement${where}` : `${device.name} opened`;
        await this.toRoom(homeId, device.roomId, {
          kind: 'awayAlert', severity: 'ALERT', title: `${what} while you're away`,
          body: kind === 'motion' ? `${device.name} saw movement and the home is in away mode.` : `The ${kind}${where} was opened and the home is in away mode.`, link,
        }, `away:${device.id}`, 60000);
      } else if (kind === 'leak') {
        await this.toRoom(homeId, device.roomId, { kind: 'leak', severity: 'ALERT', title: `Water leak${where}!`, body: `${device.name} detected water. Check it now.`, link }, `leak:${device.id}`, 10 * 60000);
      } else if ((kind === 'door' || kind === 'window') && (await this.isNight(homeId))) {
        await this.toRoom(homeId, device.roomId, { kind: 'doorAtNight', severity: 'WARN', title: `${device.name} opened`, body: `The ${kind}${where} was opened at night.`, link }, `door:${device.id}`, 60000);
      } else if (kind === 'motion' && (await this.isNight(homeId))) {
        await this.toRoom(homeId, device.roomId, { kind: 'motionAtNight', severity: 'WARN', title: `Motion${where}`, body: `${device.name} saw movement at night.`, link }, `motion:${device.id}`, 15 * 60000);
      }
    }
    if (device.type === 'dht' && typeof now.temperature === 'number') {
      const t = now.temperature;
      if (t >= 40 || t <= 5) {
        await this.toRoom(homeId, device.roomId, {
          kind: 'temperature', severity: 'WARN', title: `${t >= 40 ? 'Very hot' : 'Very cold'}${where}`,
          body: `${device.name} reads ${t.toFixed(1)} °C.`, link,
        }, `temp:${device.id}`, HOUR);
      }
    }
  }

  // (a board going offline and coming back is told by OutagesService: once it knows whether it was a
  // power cut, the internet, or the board, and only if it lasted long enough to matter)

  async boardHealth(node: { id: string; name: string; homeId: string }, h: { rssi?: number; vcc?: number; heap?: number }) {
    await this.prisma.healthSample.create({ data: { nodeId: node.id, rssi: h.rssi ?? null, vcc: h.vcc ?? null, heap: h.heap ?? null } });
    const problems: string[] = [];
    if (h.vcc !== undefined && h.vcc < 3000) problems.push(`low supply voltage (${(h.vcc / 1000).toFixed(2)} V)`);
    if (h.rssi !== undefined && h.rssi < -85) problems.push(`very weak Wi‑Fi (${h.rssi} dBm)`);
    if (h.heap !== undefined && h.heap < 6000) problems.push(`low memory (${Math.round(h.heap / 1024)} KB free)`);
    if (problems.length) {
      await this.toAdmins(node.homeId, {
        kind: 'boardHealth', severity: 'WARN', title: `${node.name} needs attention`, body: `It reports ${problems.join(' and ')}.`, link: `/diagnostics?home=${node.homeId}&board=${node.id}`,
      }, `health:${node.id}`, 6 * HOUR);
    }
  }

  async scheduleFailed(s: { homeId: string; createdById: string; name: string }, summary: string) {
    await this.send(s.homeId, [s.createdById], { kind: 'scheduleFailed', severity: 'WARN', title: `“${s.name}” did not fully work`, body: summary, link: `/automations?home=${s.homeId}` });
  }

  /** A notice for specific people (e.g. staff answering a support request). */
  async notify(homeId: string, userIds: string[], notice: Notice) {
    await this.send(homeId, userIds, notice);
  }

  /** The same, at most once per `cooldownKey` in `cooldownMs`. */
  async notifyOnce(homeId: string, userIds: string[], notice: Notice, cooldownKey: string, cooldownMs: number) {
    if (this.coolingDown(cooldownKey, cooldownMs)) return;
    await this.send(homeId, userIds, notice);
  }

  /** Everyone in the home (a power cut concerns them all). */
  async toHome(homeId: string, notice: Notice, cooldownKey: string, cooldownMs: number) {
    if (this.coolingDown(cooldownKey, cooldownMs)) return;
    const members = await this.prisma.membership.findMany({ where: { homeId, user: { disabled: false } }, select: { userId: true } });
    await this.send(homeId, members.map((m) => m.userId), notice);
  }

  /** The home's owners and admins, and its installer. */
  async toHomeAdmins(homeId: string, notice: Notice, cooldownKey: string, cooldownMs: number) {
    await this.toAdmins(homeId, notice, cooldownKey, cooldownMs);
  }

  // ---------------------------------------------------------------- reading (for the app)
  async list(user: AuthUser) {
    const [items, unread] = await Promise.all([
      this.prisma.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 50 }),
      this.prisma.notification.count({ where: { userId: user.id, readAt: null } }),
    ]);
    return { unread, items };
  }

  async markRead(user: AuthUser, id?: string) {
    await this.prisma.notification.updateMany({ where: { userId: user.id, readAt: null, ...(id ? { id } : {}) }, data: { readAt: new Date() } });
    this.realtime.toUser(user.id, 'notifications.read', {});
  }

  async prefs(user: AuthUser) {
    const row = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { notifyPrefs: true } });
    const saved = (row.notifyPrefs ?? {}) as Record<string, boolean>;
    return Object.entries(NOTICE_KINDS)
      .filter(([, k]) => !k.adminsOnly || isAdmin(user.role) || !!user.staffRole)
      .map(([key, k]) => ({ key, label: k.label, enabled: saved[key] ?? k.default }));
  }

  async setPrefs(user: AuthUser, prefs: Record<string, boolean>) {
    const clean = Object.fromEntries(Object.entries(prefs).filter(([k, v]) => k in NOTICE_KINDS && typeof v === 'boolean'));
    const row = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { notifyPrefs: true } });
    await this.prisma.user.update({ where: { id: user.id }, data: { notifyPrefs: { ...(row.notifyPrefs as object), ...clean } as Prisma.InputJsonValue } });
    return this.prefs(user);
  }

  /** Board health samples for charts, averaged into buckets so long ranges stay small. */
  async healthHistory(homeId: string, nodeId: string, hours: number) {
    const node = await this.prisma.node.findFirst({ where: { id: nodeId, homeId } });
    if (!node) throw new NotFoundException('No such board.');
    const since = new Date(Date.now() - hours * HOUR);
    const bucket = hours <= 6 ? 60 : hours <= 48 ? 600 : 3600; // seconds
    const rows = await this.prisma.$queryRaw<{ t: Date; rssi: number | null; vcc: number | null; heap: number | null }[]>`
      SELECT to_timestamp(floor(extract(epoch FROM at) / ${bucket}) * ${bucket}) AS t,
             avg(rssi)::float AS rssi, avg(vcc)::float AS vcc, avg(heap)::float AS heap
      FROM "HealthSample" WHERE "nodeId" = ${nodeId} AND at >= ${since}
      GROUP BY 1 ORDER BY 1`;
    return rows.map((r) => ({ at: r.t, rssi: r.rssi, vcc: r.vcc, heap: r.heap }));
  }

  // ---------------------------------------------------------------- delivery
  private async toAdmins(homeId: string, notice: Notice, cooldownKey: string, cooldownMs: number) {
    if (this.coolingDown(cooldownKey, cooldownMs)) return;
    // owners and admins of the home, and its installer ("your installer has been told")
    const [admins, home] = await Promise.all([
      this.prisma.membership.findMany({ where: { homeId, role: { in: [Role.OWNER, Role.ADMIN] }, user: { disabled: false } }, select: { userId: true } }),
      this.prisma.home.findUnique({ where: { id: homeId }, select: { installerId: true } }),
    ]);
    const ids = new Set(admins.map((m) => m.userId));
    if (home?.installerId) ids.add(home.installerId);
    await this.send(homeId, [...ids], notice);
  }

  /** Everyone who may at least see the room (owners and admins always). */
  private async toRoom(homeId: string, roomId: string | null, notice: Notice, cooldownKey: string, cooldownMs: number) {
    if (this.coolingDown(cooldownKey, cooldownMs)) return;
    const members = await this.prisma.membership.findMany({
      where: {
        homeId, user: { disabled: false },
        OR: [{ role: { in: [Role.OWNER, Role.ADMIN] } }, ...(roomId ? [{ user: { rooms: { some: { roomId } } } }] : [])],
      },
      select: { userId: true },
    });
    await this.send(homeId, members.map((m) => m.userId), notice);
  }

  private async send(homeId: string, userIds: string[], notice: Notice) {
    if (!userIds.length) return;
    const people = await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, notifyPrefs: true } });
    const wanted = people.filter((p) => ((p.notifyPrefs ?? {}) as Record<string, boolean>)[notice.kind] ?? NOTICE_KINDS[notice.kind].default);
    for (const p of wanted) {
      const n = await this.prisma.notification.create({
        data: { homeId, userId: p.id, kind: notice.kind, severity: notice.severity, title: notice.title, body: notice.body, link: notice.link },
      });
      this.realtime.toUser(p.id, 'notification', n);
      void this.push.send(p.id, { id: n.id, title: n.title, body: n.body, link: n.link, severity: n.severity });
    }
    if (wanted.length) this.log.log(`${notice.title} -> ${wanted.length} people`);
  }

  private coolingDown(key: string, ms: number) {
    const last = this.lastSent.get(key) ?? 0;
    if (Date.now() - last < ms) return true;
    this.lastSent.set(key, Date.now());
    return false;
  }

  private async isNight(homeId: string) {
    const home = await this.prisma.home.findUnique({ where: { id: homeId }, select: { timezone: true } });
    const now = new Date();
    const local = new Date(now.getTime() + zoneOffsetMinutes(home?.timezone ?? 'UTC', now) * 60000);
    const h = local.getUTCHours();
    return h >= 22 || h < 6;
  }

  private async prune() {
    try {
      await this.prisma.healthSample.deleteMany({ where: { at: { lt: new Date(Date.now() - SAMPLE_DAYS * 24 * HOUR) } } });
      await this.prisma.notification.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - NOTICE_DAYS * 24 * HOUR) } } });
    } catch (err) {
      this.log.warn(`Cleanup failed: ${(err as Error).message}`);
    }
  }
}

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { NodeStatus, OutageKind, Prisma, StaffRole } from '@prisma/client';
import { AuthUser } from '../auth/auth.types';
import { localDate, zoneOffsetMinutes } from '../automation/time';
import { MqttService } from '../mqtt/mqtt.service';
import { PrismaService } from '../prisma/prisma.service';
import { MonitoringService } from './monitoring.service';

const MIN = 60_000;
const HOUR = 60 * MIN;
/** a board that comes back online and sends no health report in this time: we can't tell why it was gone */
const CLASSIFY_WAIT_MS = 3 * MIN;
/** shorter cuts of the Wi-Fi or internet are blips: kept, never announced */
const NETWORK_NOTICE_MIN_S = 5 * 60;
/** the home hears that a board is offline only if it stays offline this long (a short power cut gets one notice, when it's over) */
const OFFLINE_NOTICE_MS = 10 * MIN;
/** the team hears about a board offline this long (once per outage) */
const DOWN_ALERT_MS = HOUR;
/** boards of other homes in the same place, offline within this of each other: an area-wide cut */
const AREA_WINDOW_MS = 20 * MIN;
const KEEP_DAYS = 365;
/** uptime that went back by more than this: the board started again */
const RESTART_JUMP_MS = 15_000;

/** What the board says about why it last started (ESP8266 getResetReason). */
export function kindFromReset(reset: string | undefined): OutageKind {
  const r = (reset ?? '').toLowerCase();
  if (!r || r.includes('power on')) return OutageKind.POWER;      // older firmware sends no reason: a fresh start is most likely power
  if (r.includes('external')) return OutageKind.RESET;             // the reset button (or FLASH held at power-up)
  if (r.includes('software/system') || r.includes('deep-sleep')) return OutageKind.RESTART;   // an update, a Wi-Fi change, a restart from the app
  if (r.includes('watchdog') || r.includes('exception')) return OutageKind.CRASH;
  return OutageKind.UNKNOWN;
}

export const KIND_TEXT: Record<OutageKind, string> = {
  POWER: 'Power cut',
  NETWORK: 'Wi‑Fi or internet down',
  RESTART: 'Board restarted (update or setting change)',
  RESET: 'Board reset (button pressed)',
  CRASH: 'Board restarted after a fault',
  UNKNOWN: 'Board was offline',
};

export function duration(seconds: number) {
  const m = Math.round(seconds / 60);
  if (m < 1) return `${Math.max(1, Math.round(seconds))} s`;
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h${m % 60 ? ` ${m % 60} min` : ''}`;
}

/** "3:10 pm" in the home's time zone, with "yesterday" / "Mon 14 Oct" when not today. */
export function when(at: Date, tz: string, now = new Date()) {
  const local = new Date(at.getTime() + zoneOffsetMinutes(tz, at) * MIN);
  let h = local.getUTCHours();
  const m = local.getUTCMinutes();
  const ampm = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  const time = `${h}:${String(m).padStart(2, '0')} ${ampm}`;
  const d = localDate(tz, at);
  const today = localDate(tz, now);
  const yesterday = localDate(tz, new Date(now.getTime() - 24 * HOUR));
  if (d.y === today.y && d.m === today.m && d.d === today.d) return time;
  if (d.y === yesterday.y && d.m === yesterday.m && d.d === yesterday.d) return `yesterday ${time}`;
  const label = new Date(Date.UTC(d.y, d.m - 1, d.d)).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  return `${label} ${time}`;
}

interface Pending { offlineSince: Date; onlineAt: Date; timer: NodeJS.Timeout }
type OfflineTimer = { since: number; timer: NodeJS.Timeout };

/**
 * Power cuts, Wi-Fi or internet outages and board restarts, worked out from what each board reports
 * when it comes back: how long it has been running and why it last started. Recorded for history,
 * told to the home once per cut, and to the company's team when a board stays offline for an hour
 * (or when many homes in one place go down together: probably load-shedding there).
 */
@Injectable()
export class OutagesService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Outages');
  private readonly pending = new Map<string, Pending>();
  private readonly offlineTimers = new Map<string, OfflineTimer>();
  private timer?: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaService, private readonly monitoring: MonitoringService, private readonly mqtt: MqttService) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.watch().catch((e) => this.log.warn(`watch failed: ${e}`)), 5 * MIN);
  }

  onModuleDestroy() {
    clearInterval(this.timer);
    for (const p of this.pending.values()) clearTimeout(p.timer);
    for (const t of this.offlineTimers.values()) clearTimeout(t.timer);
  }

  // ---------------------------------------------------------------- what the boards report (from NodesService)
  async offline(nodeId: string, lastSeenAt: Date | null) {
    const since = lastSeenAt ?? new Date();
    await this.prisma.node.update({ where: { id: nodeId }, data: { offlineSince: since, downAlertAt: null } });
    // tell the home only if it stays offline: most cuts are over in minutes and get one notice when they end
    clearTimeout(this.offlineTimers.get(nodeId)?.timer);
    const timer = setTimeout(() => {
      this.offlineTimers.delete(nodeId);
      void this.stillOffline(nodeId, since).catch((e) => this.log.warn(`offline notice failed: ${e}`));
    }, OFFLINE_NOTICE_MS);
    this.offlineTimers.set(nodeId, { since: since.getTime(), timer });
  }

  private async stillOffline(nodeId: string, since: Date) {
    const node = await this.prisma.node.findUnique({
      where: { id: nodeId }, select: { name: true, online: true, status: true, homeId: true, offlineSince: true, home: { select: { timezone: true } } },
    });
    if (!node?.homeId || node.online || node.status !== NodeStatus.ADOPTED || node.offlineSince?.getTime() !== since.getTime()) return;
    await this.monitoring.toHomeAdmins(node.homeId, {
      kind: 'boardOffline', severity: 'WARN', title: `${node.name} is offline`,
      body: `Since ${when(since, node.home?.timezone || 'Asia/Karachi')}. If the power is out at home, that's why: it comes back by itself. `
        + 'If the power is on, check the Wi‑Fi router. Wall buttons still work.',
      link: `/diagnostics?home=${node.homeId}&board=${nodeId}`,
    }, `off:${nodeId}`, 30 * MIN);
  }

  async online(nodeId: string) {
    clearTimeout(this.offlineTimers.get(nodeId)?.timer);
    this.offlineTimers.delete(nodeId);
    const node = await this.prisma.node.findUnique({ where: { id: nodeId }, select: { offlineSince: true } });
    await this.prisma.node.update({ where: { id: nodeId }, data: { offlineSince: null } });
    if (!node?.offlineSince) return;
    const prev = this.pending.get(nodeId);
    if (prev) clearTimeout(prev.timer);
    const onlineAt = new Date();
    // no health report soon after: we don't know why it was away
    const timer = setTimeout(() => {
      this.pending.delete(nodeId);
      void this.record(nodeId, OutageKind.UNKNOWN, node.offlineSince!, onlineAt).catch((e) => this.log.warn(`record failed: ${e}`));
    }, CLASSIFY_WAIT_MS);
    this.pending.set(nodeId, { offlineSince: node.offlineSince, onlineAt, timer });
  }

  /** A health report: uptime tells whether the board restarted since we last heard from it. */
  async telemetry(nodeId: string, t: { uptime?: number; reset?: string }, at = new Date()) {
    if (typeof t.uptime !== 'number') return;
    const bootAt = new Date(at.getTime() - t.uptime * 1000);
    const node = await this.prisma.node.findUnique({ where: { id: nodeId }, select: { bootedAt: true, status: true } });
    if (!node) return;
    // compared with the previous report's estimate (kept fresh every report, so the board's clock drifting
    // a few seconds a day never adds up): uptime that restarted moves the start time forward
    const shift = node.bootedAt ? bootAt.getTime() - node.bootedAt.getTime() : 0;
    const restarted = !!node.bootedAt && shift > RESTART_JUMP_MS;
    if (!node.bootedAt || Math.abs(shift) > 2000) await this.prisma.node.update({ where: { id: nodeId }, data: { bootedAt: bootAt } });
    const pending = this.pending.get(nodeId);
    if (pending) {
      clearTimeout(pending.timer);
      this.pending.delete(nodeId);
    }
    if (!node.bootedAt) {
      // the first report we have from this board: nothing to compare with
      if (pending) await this.record(nodeId, OutageKind.UNKNOWN, pending.offlineSince, pending.onlineAt);
    } else if (restarted && node.bootedAt < bootAt) {
      // it was off (or restarting) from the last time it was alive until it started again
      // the latest sign of life before it started again: its last health report, or the last time it was heard from
      const alive = await this.prisma.healthSample.findFirst({ where: { nodeId, at: { lt: bootAt } }, orderBy: { at: 'desc' }, select: { at: true } });
      const signs = [alive?.at, pending?.offlineSince].filter((d): d is Date => !!d && d < bootAt);
      const from = signs.length ? new Date(Math.max(...signs.map((d) => d.getTime()))) : bootAt;
      await this.record(nodeId, kindFromReset(t.reset), from < bootAt ? from : bootAt, bootAt, t.reset);
    } else if (pending && !restarted) {
      // it stayed powered all along: the Wi-Fi or the internet was down (or the server, during a deploy)
      if (this.serverWasAway(pending.offlineSince)) return;
      await this.record(nodeId, OutageKind.NETWORK, pending.offlineSince, pending.onlineAt);
    }
  }

  /** The server's own broker connection was coming back then (a broker restart): not the home's fault. */
  private serverWasAway(since: Date) {
    const t = since.getTime();
    return this.mqtt.reconnects.some((r) => Math.abs(r - t) <= 2 * MIN);
  }

  // ---------------------------------------------------------------- recording and telling
  async record(nodeId: string, kind: OutageKind, startedAt: Date, endedAt: Date, reset?: string) {
    const seconds = Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000));
    const node = await this.prisma.node.findUnique({
      where: { id: nodeId },
      select: { id: true, name: true, homeId: true, status: true, publicPlace: true, publicIsp: true, home: { select: { name: true, timezone: true } } },
    });
    if (!node?.homeId || node.status !== NodeStatus.ADOPTED) return null;
    const outage = await this.prisma.outage.create({
      data: { nodeId, homeId: node.homeId, kind, startedAt, endedAt, seconds, reset: reset ?? null, place: node.publicPlace, isp: node.publicIsp },
    });
    this.log.log(`${node.name}: ${KIND_TEXT[kind]} for ${duration(seconds)}${reset ? ` (${reset})` : ''}`);
    const tz = node.home?.timezone || 'Asia/Karachi';
    const span = `${when(startedAt, tz)} to ${when(endedAt, tz)} (${duration(seconds)})`;
    const link = `/diagnostics?home=${node.homeId}#outages`;
    if (kind === OutageKind.POWER && seconds >= 20) {
      // one notice per cut, however many boards the home has
      await this.monitoring.toHome(node.homeId, {
        kind: 'powerCut', severity: 'INFO', title: 'Power cut at home',
        body: `No power from ${span}. Everything is back on${seconds >= 30 * 60 ? '; timers that were due in that time didn’t run' : ''}.`, link,
      }, `power:${node.homeId}`, 15 * MIN);
    } else if (kind === OutageKind.NETWORK && seconds >= NETWORK_NOTICE_MIN_S) {
      await this.monitoring.toHomeAdmins(node.homeId, {
        kind: 'boardOffline', severity: 'INFO', title: 'Internet or Wi‑Fi was down',
        body: `${node.name} couldn’t reach the internet from ${span}, but stayed powered: the Wi‑Fi router or the internet connection was down. It’s back.`, link,
      }, `net:${node.homeId}`, 15 * MIN);
    } else if (kind === OutageKind.CRASH) {
      await this.monitoring.toHomeAdmins(node.homeId, {
        kind: 'boardHealth', severity: 'WARN', title: `${node.name} restarted after a fault`,
        body: `It reported “${reset}” and was back in ${duration(seconds)}. If this keeps happening, ask your installer to check it.`, link,
      }, `crash:${nodeId}`, 6 * HOUR);
    } else if (kind === OutageKind.UNKNOWN && seconds >= NETWORK_NOTICE_MIN_S) {
      await this.monitoring.toHomeAdmins(node.homeId, {
        kind: 'boardOffline', severity: 'INFO', title: `${node.name} is back online`, body: `It was offline from ${span}.`, link,
      }, `back:${nodeId}`, 15 * MIN);
    }
    return outage;
  }

  // ---------------------------------------------------------------- the team: long outages, areas
  /** Every 5 minutes: boards offline for an hour get the team's attention, once. */
  async watch(now = new Date()) {
    const long = await this.prisma.node.findMany({
      where: { status: NodeStatus.ADOPTED, online: false, offlineSince: { lt: new Date(now.getTime() - DOWN_ALERT_MS) }, downAlertAt: null, homeId: { not: null } },
      include: { home: { select: { id: true, name: true, orgId: true, installerId: true, timezone: true } } },
    });
    for (const node of long) {
      await this.prisma.node.update({ where: { id: node.id }, data: { downAlertAt: now } });
      const home = node.home!;
      const since = node.offlineSince!;
      // other homes in the same place that went down around the same time: an area cut, not this home's problem
      const area = node.publicPlace ? await this.prisma.node.findMany({
        where: {
          status: NodeStatus.ADOPTED, online: false, publicPlace: node.publicPlace, homeId: { not: home.id }, home: { orgId: home.orgId },
          offlineSince: { gte: new Date(since.getTime() - AREA_WINDOW_MS), lte: new Date(since.getTime() + AREA_WINDOW_MS) },
        },
        select: { homeId: true },
      }) : [];
      const homes = new Set(area.map((n) => n.homeId)).size;
      const tz = home.timezone || 'Asia/Karachi';
      const staff = await this.teamFor(home.orgId, home.installerId);
      if (homes >= 2) {
        await this.monitoring.notifyOnce(home.id, staff, {
          kind: 'boardDown', severity: 'INFO', title: `Probably a power cut in ${node.publicPlace!.split(',')[0]}`,
          body: `${homes + 1} homes there went offline around ${when(since, tz)} and are still offline. Nothing to do unless it goes on for hours.`,
          link: '/console/outages',
        }, `area:${node.publicPlace}:${Math.floor(since.getTime() / HOUR)}`, 3 * HOUR);
      } else {
        await this.monitoring.notifyOnce(home.id, staff, {
          kind: 'boardDown', severity: 'WARN', title: `${home.name}: ${node.name} offline for ${duration((now.getTime() - since.getTime()) / 1000)}`,
          body: `Last heard ${when(since, tz)}.${node.publicPlace ? ` Other homes in ${node.publicPlace.split(',')[0]} are online, so it’s not an area power cut.` : ''} `
            + 'The home may have its own power or internet problem, or the board needs a visit.',
          link: `/console/homes/${home.id}`,
        }, `down:${node.id}:${since.getTime()}`, 12 * HOUR);
      }
    }
    await this.prisma.outage.deleteMany({ where: { startedAt: { lt: new Date(now.getTime() - KEEP_DAYS * 24 * HOUR) } } });
  }

  private async teamFor(orgId: string, installerId: string | null) {
    const admins = await this.prisma.user.findMany({ where: { orgId, staffRole: StaffRole.SUPERADMIN, disabled: false }, select: { id: true } });
    return [...new Set([...admins.map((u) => u.id), ...(installerId ? [installerId] : [])])];
  }

  // ---------------------------------------------------------------- reading
  /** A home's outages and totals (power cuts and internet outages; restarts listed, not counted). */
  async forHome(user: AuthUser, days: number) {
    const since = new Date(Date.now() - days * 24 * HOUR);
    const [rows, home] = await Promise.all([
      this.prisma.outage.findMany({ where: { homeId: user.homeId, startedAt: { gte: since } }, orderBy: { startedAt: 'desc' }, take: 200, include: { node: { select: { name: true } } } }),
      this.prisma.home.findUniqueOrThrow({ where: { id: user.homeId }, select: { timezone: true } }),
    ]);
    return { days, timezone: home.timezone, summary: summarize(mergePower(rows)), outages: rows.map(view) };
  }

  /** The console: homes in scope, their cuts, places where several homes went down together, boards down now. */
  async forStaff(homeWhere: Prisma.HomeWhereInput, days: number) {
    const since = new Date(Date.now() - days * 24 * HOUR);
    const rows = await this.prisma.outage.findMany({
      where: { startedAt: { gte: since }, node: { home: homeWhere } }, orderBy: { startedAt: 'desc' }, take: 1000,
      include: { node: { select: { name: true, home: { select: { id: true, name: true } } } } },
    });
    const down = await this.prisma.node.findMany({
      where: { status: NodeStatus.ADOPTED, online: false, home: homeWhere },
      select: { id: true, name: true, offlineSince: true, lastSeenAt: true, publicPlace: true, home: { select: { id: true, name: true } } },
      orderBy: { offlineSince: 'asc' },
    });
    // per home, one cut seen by several of its boards counts once
    const rowsByHome = new Map<string, typeof rows>();
    for (const o of rows) rowsByHome.set(o.node.home!.id, [...(rowsByHome.get(o.node.home!.id) ?? []), o]);
    const byHome = new Map<string, { homeId: string; home: string; power: number; powerSeconds: number; network: number; networkSeconds: number; crashes: number }>();
    for (const [homeId, list] of rowsByHome) {
      const s = summarize(mergePower(list));
      byHome.set(homeId, { homeId, home: list[0]!.node.home!.name, power: s.powerCuts, powerSeconds: s.powerSeconds,
        network: s.networkOuts, networkSeconds: s.networkSeconds, crashes: s.crashes });
    }
    return {
      days,
      homes: [...byHome.values()].sort((a, b) => b.powerSeconds + b.networkSeconds - (a.powerSeconds + a.networkSeconds)),
      areas: areaCuts(rows),
      down: down.map((n) => ({ boardId: n.id, board: n.name, homeId: n.home!.id, home: n.home!.name, place: n.publicPlace, since: n.offlineSince ?? n.lastSeenAt })),
      outages: rows.slice(0, 200).map((o) => ({ ...view(o), home: o.node.home!.name, homeId: o.node.home!.id })),
    };
  }
}

type Row = { id: string; kind: OutageKind; startedAt: Date; endedAt: Date; seconds: number; reset: string | null; place: string | null; node: { name: string } };

function view(o: Row) {
  return { id: o.id, kind: o.kind, label: KIND_TEXT[o.kind], board: o.node.name, startedAt: o.startedAt, endedAt: o.endedAt, seconds: o.seconds, reset: o.reset };
}

/** One power cut seen by several boards of a home counts once (overlapping times). */
export function mergePower<T extends { kind: OutageKind; startedAt: Date; endedAt: Date; seconds: number }>(rows: T[]): T[] {
  const power = rows.filter((r) => r.kind === OutageKind.POWER).sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
  const merged: T[] = [];
  for (const r of power) {
    const last = merged[merged.length - 1];
    if (last && r.startedAt.getTime() <= last.endedAt.getTime() + 2 * MIN) {
      const end = r.endedAt > last.endedAt ? r.endedAt : last.endedAt;
      merged[merged.length - 1] = { ...last, endedAt: end, seconds: Math.round((end.getTime() - last.startedAt.getTime()) / 1000) };
    } else merged.push(r);
  }
  return [...merged, ...rows.filter((r) => r.kind !== OutageKind.POWER)];
}

export function summarize(rows: { kind: OutageKind; seconds: number; startedAt: Date; endedAt: Date }[]) {
  const power = rows.filter((r) => r.kind === OutageKind.POWER);
  const net = rows.filter((r) => r.kind === OutageKind.NETWORK);
  const last = power.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())[0] ?? null;
  return {
    powerCuts: power.length, powerSeconds: power.reduce((s, r) => s + r.seconds, 0),
    networkOuts: net.length, networkSeconds: net.reduce((s, r) => s + r.seconds, 0),
    restarts: rows.filter((r) => r.kind === OutageKind.RESTART || r.kind === OutageKind.RESET).length,
    crashes: rows.filter((r) => r.kind === OutageKind.CRASH).length,
    lastPower: last ? { startedAt: last.startedAt, endedAt: last.endedAt, seconds: last.seconds } : null,
  };
}

/** Power cuts that hit two or more homes in one place within 20 minutes: probably load-shedding there. */
export function areaCuts(rows: (Row & { node: { home?: { id: string; name: string } | null } })[]) {
  const power = rows.filter((r) => r.kind === OutageKind.POWER && r.place).sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
  const groups: { place: string; startedAt: Date; endedAt: Date; homes: Set<string> }[] = [];
  for (const r of power) {
    const g = groups.find((x) => x.place === r.place && Math.abs(r.startedAt.getTime() - x.startedAt.getTime()) <= AREA_WINDOW_MS);
    if (g) {
      g.homes.add(r.node.home?.name ?? '?');
      if (r.endedAt > g.endedAt) g.endedAt = r.endedAt;
    } else groups.push({ place: r.place!, startedAt: r.startedAt, endedAt: r.endedAt, homes: new Set([r.node.home?.name ?? '?']) });
  }
  return groups.filter((g) => g.homes.size >= 2).reverse().map((g) => ({
    place: g.place, startedAt: g.startedAt, endedAt: g.endedAt, seconds: Math.round((g.endedAt.getTime() - g.startedAt.getTime()) / 1000), homes: [...g.homes],
  }));
}


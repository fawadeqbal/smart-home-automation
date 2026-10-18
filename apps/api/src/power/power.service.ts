import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { NodeStatus, OutageKind, Prisma, Role } from '@prisma/client';
import { AuthService } from '../auth/auth.service';
import { AuthUser } from '../auth/auth.types';
import { localDate, zoneOffsetMinutes, zonedToUtc } from '../automation/time';
import { AuditService } from '../common/audit.service';
import { DEFAULT_TARIFF, EnergyService, kwhBetween } from '../energy/energy.service';
import { DevicesService } from '../hardware/devices.service';
import { MonitoringService, Notice } from '../monitoring/monitoring.service';
import { duration, OutagesService, when } from '../monitoring/outages.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import {
  billFor, checkReading, cleanSlabs, Cycle, cycleFor, cycleUsage, meterAt, previousCycle, project, Reading, round1, Slab, unitsBetween, warningsDue,
} from './bill';
import { gridStep, isHeavy, isMainsSensor, loadsToCut, loadsToRestore } from './grid';
import { cleanSchedule, clockText, CutWindow, cutText, findPattern, nextCut, windowText } from './shedding';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const TICK_MS = Number(process.env.POWER_TICK_MS) || MIN;
/** the "electricity may go" notice goes out this long before an expected cut */
const CUT_NOTICE_MIN = 15;
/** a learned pattern is worked out again after this long (or when a cut is recorded) */
const PATTERN_TTL_MS = 15 * MIN;
/** a home with fewer days than this of its own history also looks at its area */
const OWN_DAYS_ENOUGH = 7;

type HomeRow = { id: string; timezone: string };
type DeviceSnap = { id: string; name: string; on: boolean; online: boolean };

export const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
const units = (n: number) => (n < 10 ? n.toFixed(1) : String(Math.round(n)));
const rs = (n: number) => `Rs ${Math.round(n).toLocaleString('en-PK')}`;

/**
 * Electricity at home beyond the switches: load-shedding (the pattern of daily cuts and the next one),
 * UPS mode from a mains-sense sensor (heavy loads off while on battery, back on after), and the bill
 * from the meter readings people type (units this billing month, where it's heading, the slab warning).
 */
@Injectable()
export class PowerService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Power');
  private timer?: NodeJS.Timeout;
  private ticking = false;
  private lastBillCheck = 0;
  /** one home's grid changes are handled one at a time, in order */
  private readonly queue = new Map<string, Promise<unknown>>();
  private readonly patterns = new Map<string, { at: number; value: Awaited<ReturnType<PowerService['learned']>> }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly devices: DevicesService,
    private readonly outages: OutagesService,
    private readonly energy: EnergyService,
    private readonly monitoring: MonitoringService,
    private readonly realtime: RealtimeService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit() {
    this.devices.onStateChange((d, before, now) => {
      if (!isMainsSensor(d) || !d.node.homeId) return;
      return this.serial(d.node.homeId, () => this.onMains(d.node.homeId!, d.id, before, now));
    });
    this.devices.beforeCommand((user, device, command, opts) => this.guard(user, device, command, opts.confirmed));
    this.timer = setInterval(() => void this.tick(), TICK_MS);
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  private serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const next = (this.queue.get(key) ?? Promise.resolve()).catch(() => undefined).then(fn);
    this.queue.set(key, next);
    void next.finally(() => { if (this.queue.get(key) === next) this.queue.delete(key); }).catch(() => undefined);
    return next;
  }

  // ================================================================ UPS mode (the grid sensor)
  private async onMains(homeId: string, sensorId: string, before: Record<string, unknown> | null, now: Record<string, unknown>, at = new Date()) {
    const home = await this.prisma.home.findUniqueOrThrow({
      where: { id: homeId }, select: { id: true, timezone: true, gridOffSince: true, gridLoads: true, gridRestore: true, gridSwitchedOff: true },
    });
    const step = gridStep(before, now, home.gridOffSince, at);
    if (step.type === 'none') return;
    const sensor = await this.prisma.device.findUnique({ where: { id: sensorId }, select: { nodeId: true } });
    const tz = home.timezone;
    if (step.type === 'off') {
      const snaps = await this.snapshot(homeId, home.gridLoads);
      const cut = loadsToCut(home.gridLoads, snaps);
      await this.prisma.home.update({ where: { id: homeId }, data: { gridOffSince: step.since, gridSwitchedOff: [] } });
      const done = await this.switchAll(homeId, cut, false);
      await this.prisma.home.update({ where: { id: homeId }, data: { gridSwitchedOff: done } });
      const names = this.names(snaps, done);
      this.log.log(`Home ${homeId}: grid off${names.length ? `; switched off ${names.join(', ')}` : ''}`);
      await this.toAdmins(homeId, {
        kind: 'ups', severity: 'WARN', title: `On UPS or solar since ${clockText(step.since, tz)}`,
        body: `The grid power went at ${clockText(step.since, tz)}.`
          + (names.length ? ` Switched off to save the battery: ${names.join(', ')}.${home.gridRestore ? ' They go back on when the power returns.' : ''}` : '')
          + ' Go easy on heavy things (AC, iron, geyser, motor) until it’s back.',
        link: '/energy',
      });
    } else {
      const restore = loadsToRestore(home.gridRestore, home.gridSwitchedOff, await this.snapshot(homeId, home.gridSwitchedOff));
      // the grid is on again before anything is switched back (heavy loads may go on now)
      await this.prisma.home.update({ where: { id: homeId }, data: { gridOffSince: null, gridSwitchedOff: [] } });
      const done = await this.switchAll(homeId, restore, true);
      const names = this.names(await this.snapshot(homeId, done), done);
      if (!step.blip && sensor) {
        await this.outages.recordMains(sensor.nodeId, step.since, at);
        this.patterns.delete(homeId);
        await this.toAdmins(homeId, {
          kind: 'ups', severity: 'INFO', title: `Power back after ${duration(step.seconds)}`,
          body: `The grid was off from ${when(step.since, tz, at)} to ${clockText(at, tz)}.`
            + (names.length ? ` Switched back on: ${names.join(', ')}.` : home.gridSwitchedOff.length && !home.gridRestore ? ' What was switched off stays off.' : ''),
          link: '/energy',
        });
        // everyone else hears about it like any power cut
        const others = await this.prisma.membership.findMany({ where: { homeId, role: { notIn: [Role.OWNER, Role.ADMIN] }, user: { disabled: false } }, select: { userId: true } });
        await this.monitoring.notify(homeId, others.map((m) => m.userId), {
          kind: 'powerCut', severity: 'INFO', title: 'Power cut at home',
          body: `No grid power from ${when(step.since, tz, at)} to ${clockText(at, tz)} (${duration(step.seconds)}). It’s back.`, link: '/energy',
        });
      }
      this.log.log(`Home ${homeId}: grid back after ${duration(step.seconds)}${step.blip ? ' (a flicker)' : ''}`);
    }
    this.realtime.powerChanged(homeId);
    this.realtime.devicesChanged(homeId);
  }

  /** The state of these switches now. */
  private async snapshot(homeId: string, ids: string[]): Promise<DeviceSnap[]> {
    if (!ids.length) return [];
    const rows = await this.prisma.device.findMany({
      where: { id: { in: ids }, type: 'switch', node: { homeId } }, select: { id: true, name: true, state: true, node: { select: { online: true } } },
    });
    return rows.map((d) => ({ id: d.id, name: d.name, on: (d.state?.state as { on?: boolean } | null)?.on === true, online: d.node.online }));
  }

  private names(snaps: DeviceSnap[], ids: string[]) {
    return ids.map((id) => snaps.find((s) => s.id === id)?.name).filter((n): n is string => !!n);
  }

  /** Switches these on or off with the owner's rights; returns the ones the boards confirmed. */
  private async switchAll(homeId: string, ids: string[], on: boolean) {
    if (!ids.length) return [];
    const owner = await this.prisma.membership.findFirst({ where: { homeId, role: Role.OWNER, user: { disabled: false } }, select: { userId: true } });
    const actor = owner ? await this.auth.actorFor(owner.userId, homeId, 'automation') : null;
    if (!actor) return [];
    const done: string[] = [];
    await Promise.all(ids.map(async (id) => {
      try {
        await this.devices.command(actor, id, { on }, { confirmed: ['ups'] });
        done.push(id);
      } catch (err) {
        this.log.warn(`UPS mode could not switch ${id} ${on ? 'on' : 'off'}: ${(err as Error).message}`);
      }
    }));
    return ids.filter((id) => done.includes(id));
  }

  private async toAdmins(homeId: string, notice: Notice) {
    const admins = await this.prisma.membership.findMany({ where: { homeId, role: { in: [Role.OWNER, Role.ADMIN] }, user: { disabled: false } }, select: { userId: true } });
    await this.monitoring.notify(homeId, admins.map((m) => m.userId), notice);
  }

  /**
   * While on UPS, switching on one of the heavy loads the owner picked needs a "yes, anyway" from the
   * app (?confirm=ups); timers and rules don't switch them on at all until the grid is back.
   */
  private async guard(user: AuthUser, device: { id: string; name: string; type: string; node: { homeId: string | null } }, command: Record<string, unknown>, confirmed: string[]) {
    if (device.type !== 'switch' || !device.node.homeId || confirmed.includes('ups')) return;
    if (command.on !== true && command.toggle !== true) return;
    const home = await this.prisma.home.findUnique({ where: { id: device.node.homeId }, select: { gridOffSince: true, gridLoads: true, timezone: true } });
    if (!home?.gridOffSince || !home.gridLoads.includes(device.id)) return;
    if (command.toggle) {
      const st = await this.prisma.deviceState.findUnique({ where: { deviceId: device.id }, select: { state: true } });
      if ((st?.state as { on?: boolean } | null)?.on === true) return;   // a toggle that switches it off
    }
    const since = clockText(home.gridOffSince, home.timezone);
    if (user.channel === 'automation') {
      throw new ConflictException({ statusCode: 409, code: 'ups', message: `Not switched on: the home is on UPS since ${since}, and ${device.name} is one of the heavy loads kept off until the grid is back.` });
    }
    throw new ConflictException({
      statusCode: 409, code: 'ups',
      message: `The home is on UPS since ${since}. ${device.name} draws a lot and can empty the battery fast. Switch it on anyway?`,
    });
  }

  /** UPS mode settings and state, with the switches that look heavy suggested (owners and admins). */
  async grid(user: AuthUser) {
    const home = await this.prisma.home.findUniqueOrThrow({ where: { id: user.homeId }, select: { gridOffSince: true, gridLoads: true, gridRestore: true, gridSwitchedOff: true, timezone: true } });
    const [sensor, switches] = await Promise.all([
      this.outages.mainsSensor(user.homeId),
      this.prisma.device.findMany({
        where: { node: { homeId: user.homeId, status: NodeStatus.ADOPTED }, type: 'switch' },
        select: { id: true, name: true, aliases: true, watts: true, room: { select: { name: true } } }, orderBy: { name: 'asc' },
      }),
    ]);
    return {
      sensor: sensor ? { id: sensor.id, name: sensor.name } : null,
      off: !!home.gridOffSince, since: home.gridOffSince,
      loads: home.gridLoads.filter((id) => switches.some((s) => s.id === id)), restore: home.gridRestore,
      switchedOff: home.gridSwitchedOff,
      switches: switches.map((s) => ({ id: s.id, name: s.name, room: s.room?.name ?? null, heavy: isHeavy(s) })),
    };
  }

  async setGrid(user: AuthUser, input: { loads?: string[]; restore?: boolean }) {
    const data: Prisma.HomeUpdateInput = {};
    if (input.loads) {
      const ok = await this.prisma.device.findMany({ where: { id: { in: input.loads }, type: 'switch', node: { homeId: user.homeId } }, select: { id: true } });
      data.gridLoads = ok.map((d) => d.id).slice(0, 20);
    }
    if (input.restore !== undefined) data.gridRestore = input.restore;
    await this.prisma.home.update({ where: { id: user.homeId }, data });
    await this.audit.record(user.homeId, user.id, 'home.ups', user.homeId, { loads: data.gridLoads, restore: input.restore, channel: user.channel });
    this.realtime.powerChanged(user.homeId);
    return this.grid(user);
  }

  // ================================================================ load-shedding
  /** The pattern from the home's own power cuts in the last 14 days, or its area's when it has too little. */
  private async learned(home: HomeRow & { createdAt: Date }, now: Date) {
    const since = new Date(now.getTime() - 14 * DAY);
    const own = await this.prisma.outage.findMany({ where: { homeId: home.id, kind: OutageKind.POWER, endedAt: { gte: since } }, select: { startedAt: true, endedAt: true } });
    // how many of the 14 days we know about: since the home (or its first cut, if earlier) started
    const first = Math.min(home.createdAt.getTime(), ...own.map((o) => o.startedAt.getTime()));
    const observedDays = Math.max(1, Math.min(14, Math.ceil((now.getTime() - first) / DAY)));
    const mine = findPattern(own.map((o) => ({ start: o.startedAt.getTime(), end: o.endedAt.getTime() })), home.timezone, now, { observedDays });
    const slots = slotCounts(own.map((o) => ({ start: o.startedAt.getTime(), end: o.endedAt.getTime() })), home.timezone, now);
    if (mine.windows.length && observedDays >= OWN_DAYS_ENOUGH) return { source: 'learned' as const, ...mine, slots, cuts: own.length, place: null };
    // too little of its own: the same place's other homes (boards report where they connect from)
    const node = await this.prisma.node.findFirst({ where: { homeId: home.id, publicPlace: { not: null } }, orderBy: { lastSeenAt: 'desc' }, select: { publicPlace: true, home: { select: { orgId: true } } } });
    if (node?.publicPlace) {
      const area = await this.prisma.outage.findMany({
        where: { place: node.publicPlace, kind: OutageKind.POWER, endedAt: { gte: since }, homeId: { not: home.id }, node: { home: { orgId: node.home!.orgId } } },
        select: { startedAt: true, endedAt: true },
      });
      const cuts = area.map((o) => ({ start: o.startedAt.getTime(), end: o.endedAt.getTime() }));
      const theirs = findPattern(cuts, home.timezone, now);
      if (theirs.windows.length) return { source: 'area' as const, ...theirs, slots: slotCounts(cuts, home.timezone, now), cuts: area.length, place: node.publicPlace.split(',')[0]! };
    }
    return { source: mine.windows.length ? 'learned' as const : 'none' as const, ...mine, slots, cuts: own.length, place: null };
  }

  private async learnedCached(home: HomeRow & { createdAt: Date }, now: Date) {
    const hit = this.patterns.get(home.id);
    if (hit && now.getTime() - hit.at < PATTERN_TTL_MS) return hit.value;
    const value = await this.learned(home, now);
    this.patterns.set(home.id, { at: now.getTime(), value });
    return value;
  }

  /** The home's load-shedding: the typed schedule (if any), the learned pattern, and the next expected cut. */
  async shedding(homeId: string, now = new Date()) {
    const home = await this.prisma.home.findUniqueOrThrow({ where: { id: homeId }, select: { id: true, timezone: true, createdAt: true, loadShedding: true } });
    const typed = (home.loadShedding as unknown as CutWindow[]) ?? [];
    // fresh for whoever asks (a few small queries); the minute-by-minute notices use the cached one
    const learned = await this.learned(home, now);
    this.patterns.set(home.id, { at: now.getTime(), value: learned });
    const windows = typed.length ? typed : learned.windows;
    const source = typed.length ? 'typed' : learned.source;
    const next = nextCut(windows, home.timezone, now);
    return {
      timezone: home.timezone, source, windows,
      typed, learned: { source: learned.source, windows: learned.windows, observedDays: learned.observedDays, needed: learned.needed, cuts: learned.cuts, place: learned.place, slots: learned.slots },
      next: next ? { at: next.at, until: next.until, now: next.now, text: cutText(next, home.timezone, now) } : null,
      text: windows.length ? windows.map(windowText).join('; ') : null,
    };
  }

  async setShedding(user: AuthUser, windows: { from: string; to: string; days?: number[] }[]) {
    const clean = cleanSchedule(windows);
    if (typeof clean === 'string') throw new BadRequestException(clean);
    await this.prisma.home.update({ where: { id: user.homeId }, data: { loadShedding: clean as unknown as Prisma.InputJsonValue, cutNoticeAt: null } });
    await this.audit.record(user.homeId, user.id, 'home.loadShedding', user.homeId, { windows: clean, channel: user.channel });
    this.realtime.powerChanged(user.homeId);
    return this.shedding(user.homeId);
  }

  /** The home page's power line: on UPS or not, and the next expected cut. */
  async status(user: AuthUser, now = new Date()) {
    const [home, sensor, shed] = await Promise.all([
      this.prisma.home.findUniqueOrThrow({ where: { id: user.homeId }, select: { gridOffSince: true, gridSwitchedOff: true, timezone: true } }),
      this.outages.mainsSensor(user.homeId),
      this.shedding(user.homeId, now),
    ]);
    const off = await this.snapshot(user.homeId, home.gridSwitchedOff);
    return {
      timezone: home.timezone,
      grid: { sensor: !!sensor, off: !!home.gridOffSince, since: home.gridOffSince, sinceText: home.gridOffSince ? clockText(home.gridOffSince, home.timezone) : null, switchedOff: off.map((d) => d.name) },
      next: shed.next, source: shed.source,
    };
  }

  // ================================================================ the bill (meter readings)
  async readings(homeId: string) {
    const rows = await this.prisma.meterReading.findMany({ where: { homeId }, orderBy: { readAt: 'desc' }, take: 400 });
    const by = new Map((await this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.byId).filter((x): x is string => !!x))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
    return rows.map((r) => ({ id: r.id, kwh: r.kwh, readAt: r.readAt, newMeter: r.newMeter, by: r.byId ? by.get(r.byId) ?? null : null }));
  }

  private async allReadings(homeId: string): Promise<Reading[]> {
    return this.prisma.meterReading.findMany({ where: { homeId }, orderBy: { readAt: 'asc' }, select: { id: true, kwh: true, readAt: true, newMeter: true } });
  }

  private when(readAt: Date | undefined, now = new Date()) {
    const at = readAt ?? now;
    if (Number.isNaN(at.getTime())) throw new BadRequestException('Give the date the meter was read.');
    if (at.getTime() > now.getTime() + 10 * MIN) throw new BadRequestException('That date is in the future.');
    if (at.getTime() < now.getTime() - 3 * 365 * DAY) throw new BadRequestException('That date is too long ago.');
    return at;
  }

  async addReading(user: AuthUser, input: { kwh: number; readAt?: Date; newMeter?: boolean }) {
    const readAt = this.when(input.readAt);
    const next = { kwh: input.kwh, readAt, newMeter: !!input.newMeter };
    const problem = checkReading(await this.allReadings(user.homeId), next);
    if (problem) throw new BadRequestException(problem);
    const row = await this.prisma.meterReading.create({ data: { homeId: user.homeId, kwh: input.kwh, readAt, newMeter: !!input.newMeter, byId: user.id } });
    await this.audit.record(user.homeId, user.id, 'meter.reading', row.id, { kwh: input.kwh, readAt, newMeter: !!input.newMeter, channel: user.channel });
    this.realtime.powerChanged(user.homeId);
    await this.checkBill(user.homeId).catch((e) => this.log.warn(`bill check failed: ${e}`));
    return this.bill(user);
  }

  async updateReading(user: AuthUser, id: string, input: { kwh?: number; readAt?: Date; newMeter?: boolean }) {
    const row = await this.prisma.meterReading.findFirst({ where: { id, homeId: user.homeId } });
    if (!row) throw new NotFoundException('No such reading.');
    const next = { kwh: input.kwh ?? row.kwh, readAt: input.readAt ? this.when(input.readAt) : row.readAt, newMeter: input.newMeter ?? row.newMeter };
    const problem = checkReading(await this.allReadings(user.homeId), next, id);
    if (problem) throw new BadRequestException(problem);
    await this.prisma.meterReading.update({ where: { id }, data: next });
    await this.audit.record(user.homeId, user.id, 'meter.reading.edit', id, { from: { kwh: row.kwh, readAt: row.readAt }, to: next, channel: user.channel });
    this.realtime.powerChanged(user.homeId);
    return this.bill(user);
  }

  async removeReading(user: AuthUser, id: string) {
    const row = await this.prisma.meterReading.findFirst({ where: { id, homeId: user.homeId } });
    if (!row) throw new NotFoundException('No such reading.');
    await this.prisma.meterReading.delete({ where: { id } });
    await this.audit.record(user.homeId, user.id, 'meter.reading.remove', id, { kwh: row.kwh, readAt: row.readAt, channel: user.channel });
    this.realtime.powerChanged(user.homeId);
    return this.bill(user);
  }

  async setBill(user: AuthUser, input: { billingDay?: number; slabs?: Slab[]; protectedLimit?: number | null; reminder?: boolean }) {
    const data: Prisma.HomeUpdateInput = {};
    if (input.billingDay !== undefined) {
      if (!Number.isInteger(input.billingDay) || input.billingDay < 1 || input.billingDay > 31) throw new BadRequestException('The billing day is a day of the month, 1 to 31.');
      data.billingDay = input.billingDay;
    }
    if (input.slabs !== undefined) {
      const clean = cleanSlabs(input.slabs);
      if (typeof clean === 'string') throw new BadRequestException(clean);
      data.tariffSlabs = clean as unknown as Prisma.InputJsonValue;
    }
    if (input.protectedLimit !== undefined) {
      if (input.protectedLimit !== null && !(input.protectedLimit >= 10 && input.protectedLimit <= 2000)) throw new BadRequestException('The protected limit is a number of units, e.g. 200.');
      data.protectedLimit = input.protectedLimit === null ? null : Math.round(input.protectedLimit);
      data.billWarned = {};
    }
    await this.prisma.home.update({ where: { id: user.homeId }, data });
    await this.audit.record(user.homeId, user.id, 'home.bill', user.homeId, { ...input, channel: user.channel });
    this.realtime.powerChanged(user.homeId);
    return this.bill(user);
  }

  /** This billing month: units so far (readings, filled in with estimates), where it's heading, and the bill. */
  async bill(user: AuthUser, now = new Date()) {
    return this.billFor(user.homeId, now);
  }

  async billFor(homeId: string, now = new Date()) {
    const home = await this.prisma.home.findUniqueOrThrow({
      where: { id: homeId }, select: { timezone: true, billingDay: true, tariff: true, tariffSlabs: true, protectedLimit: true },
    });
    const tz = home.timezone;
    const cycle = cycleFor(home.billingDay, tz, now);
    const readings = await this.allReadings(homeId);
    const runs = await this.energy.homeRuns(homeId, cycle.start, now);
    const usage = cycleUsage(readings, cycle, now, (a, b) => kwhBetween(runs, a.getTime(), b.getTime()).kwh);
    const projected = project(usage.units, cycle, usage.asOf);
    const flat = home.tariff ?? DEFAULT_TARIFF;
    const slabs = (home.tariffSlabs as unknown as Slab[]) ?? [];
    const soFar = billFor(usage.units, flat, slabs);
    const atEnd = projected !== null ? billFor(projected, flat, slabs) : null;
    const top = kwhBetween(runs, cycle.start.getTime(), now.getTime()).devices.filter((d) => d.kwh >= 0.05).slice(0, 5).map((d) => ({ id: d.id, name: d.name, kwh: round1(d.kwh) }));
    const prev = previousCycle(home.billingDay, tz, cycle);
    const a = meterAt(readings, prev.start);
    const b = meterAt(readings, prev.end);
    const lastMonth = a && b ? round1(unitsBetween(readings, prev.start, prev.end)) : null;
    const limit = home.protectedLimit;
    const day = localDate(tz, cycle.end).d;
    return {
      timezone: tz, billingDay: home.billingDay, billingDayText: ordinal(day),
      cycle: { start: cycle.start, end: cycle.end, daysIn: Math.max(0, Math.floor((now.getTime() - cycle.start.getTime()) / DAY)), daysLeft: Math.max(0, Math.ceil((cycle.end.getTime() - now.getTime()) / DAY)) },
      units: usage.units, asOf: usage.asOf, source: usage.source, estimated: usage.estimated,
      startReading: usage.startReading, latest: usage.latest ? { kwh: usage.latest.kwh, readAt: usage.latest.readAt } : null,
      projected, tariff: flat, tariffSet: home.tariff !== null, slabs,
      cost: { soFar: soFar.cost, projected: atEnd?.cost ?? null, lines: (atEnd ?? soFar).lines },
      protectedLimit: limit, over: limit !== null && usage.units > limit, heading: limit !== null && projected !== null && projected > limit,
      topDevices: top, lastMonth,
      message: this.billMessage(limit, usage.units, projected, ordinal(localDate(tz, cycle.start).d), ordinal(day), usage.source),
    };
  }

  /** "You've used 162 units since the 1st. At this pace you'll reach 214 by the 1st — …" */
  private billMessage(limit: number | null, used: number, projected: number | null, since: string, by: string, source: string) {
    if (source === 'none') return 'Type the number on your meter to see this month’s units and bill.';
    const est = source === 'estimate' ? ' (an estimate from your switches — type a meter reading for the real number)' : '';
    let text = `You've used ${units(used)} units since the ${since}${est}.`;
    if (projected !== null) text += ` At this pace you'll reach ${Math.round(projected)} by the ${by}`;
    if (limit && used > limit) return `${text}. That's past ${limit}: this bill won't get the protected rate.`;
    if (limit && projected !== null && projected > limit) return `${text} — staying at ${limit} or below keeps the protected rate.`;
    return projected !== null ? `${text}.` : text;
  }

  /** Warns owners and admins (each warning once a month) when the bill is heading past the protected limit. */
  async checkBill(homeId: string, now = new Date()) {
    const home = await this.prisma.home.findUniqueOrThrow({ where: { id: homeId }, select: { protectedLimit: true, billWarned: true } });
    if (!home.protectedLimit) return [];
    const b = await this.billFor(homeId, now);
    // only on a meter reading: estimates alone are too rough to warn about money
    if (b.source === 'estimate' || b.source === 'none') return [];
    const cycleKey = new Date(b.cycle.start).toISOString();
    const warned = (home.billWarned ?? {}) as { cycle?: string; sent?: string[] };
    const sent = warned.cycle === cycleKey ? warned.sent ?? [] : [];
    const due = warningsDue(home.protectedLimit, b.units, b.projected, sent);
    if (!due.length) return [];
    await this.prisma.home.update({ where: { id: homeId }, data: { billWarned: { cycle: cycleKey, sent: [...sent, ...due] } } });
    const top = b.topDevices.slice(0, 3);
    const most = top.length ? ` Most used (estimates): ${top.map((d) => `${d.name} about ${units(d.kwh)} units`).join(', ')}.` : '';
    const limit = home.protectedLimit;
    const kind = due.includes('over') ? 'over' : due.includes('pace') ? 'pace' : 'near';
    await this.toAdmins(homeId, {
      kind: 'bill', severity: kind === 'near' ? 'INFO' : 'WARN',
      title: kind === 'over' ? `Electricity: past ${limit} units this month` : kind === 'pace' ? `Electricity: heading past ${limit} units` : `Electricity: ${Math.round(b.units)} of ${limit} units used`,
      body: `${b.message}${most}`, link: '/energy',
    });
    return due;
  }

  // ================================================================ the clock
  async tick(now = new Date()) {
    if (this.ticking) return;
    this.ticking = true;
    try {
      await this.cutNotices(now);
      await this.readingReminders(now);
      if (now.getTime() - this.lastBillCheck > HOUR) {
        this.lastBillCheck = now.getTime();
        const homes = await this.prisma.home.findMany({ where: { archivedAt: null, protectedLimit: { not: null }, meterReadings: { some: { readAt: { gte: new Date(now.getTime() - 40 * DAY) } } } }, select: { id: true } });
        for (const h of homes) await this.checkBill(h.id, now).catch((e) => this.log.warn(`bill check failed: ${e}`));
      }
    } catch (err) {
      this.log.warn(`tick failed: ${(err as Error).message}`);
    } finally {
      this.ticking = false;
    }
  }

  /** "Electricity may go at 2:00 — run the motor or iron now", about 15 minutes before an expected cut (for those who asked). */
  private async cutNotices(now: Date) {
    const homes = await this.prisma.home.findMany({ where: { archivedAt: null }, select: { id: true, timezone: true, createdAt: true, loadShedding: true, cutNoticeAt: true, gridOffSince: true } });
    for (const h of homes) {
      const typed = (h.loadShedding as unknown as CutWindow[]) ?? [];
      const windows = typed.length ? typed : (await this.learnedCached(h, now)).windows;
      const next = nextCut(windows, h.timezone, now);
      if (!next || next.now || h.gridOffSince) continue;
      const mins = (next.at.getTime() - now.getTime()) / MIN;
      if (mins > CUT_NOTICE_MIN || mins < 2 || h.cutNoticeAt?.getTime() === next.at.getTime()) continue;
      await this.prisma.home.update({ where: { id: h.id }, data: { cutNoticeAt: next.at } });
      const members = await this.prisma.membership.findMany({ where: { homeId: h.id, user: { disabled: false } }, select: { userId: true } });
      const at = clockText(next.at, h.timezone);
      await this.monitoring.notify(h.id, members.map((m) => m.userId), {
        kind: 'cutSoon', severity: 'INFO', title: `Electricity may go at ${at}`,
        body: `${typed.length ? 'Your area’s load-shedding schedule' : 'Most days the power goes'} around ${at}${windowEnd(next.until, h.timezone)}. Run the motor or iron now if you need them.`, link: '/energy',
      });
    }
  }

  /** On the billing day, a reminder to type the meter reading (for owners and admins who asked for it). */
  private async readingReminders(now: Date) {
    const homes = await this.prisma.home.findMany({ where: { archivedAt: null }, select: { id: true, timezone: true, billingDay: true, readingReminderAt: true } });
    for (const h of homes) {
      const cycle = cycleFor(h.billingDay, h.timezone, now);
      const local = new Date(now.getTime() + zoneOffsetMinutes(h.timezone, now) * MIN);
      const hour = local.getUTCHours();
      if (now.getTime() - cycle.start.getTime() > DAY || hour < 9 || hour >= 21) continue;
      if (h.readingReminderAt && h.readingReminderAt >= cycle.start) continue;
      await this.prisma.home.update({ where: { id: h.id }, data: { readingReminderAt: now } });
      const admins = await this.prisma.membership.findMany({ where: { homeId: h.id, role: { in: [Role.OWNER, Role.ADMIN] }, user: { disabled: false } }, select: { userId: true } });
      await this.monitoring.notify(h.id, admins.map((m) => m.userId), {
        kind: 'meterReading', severity: 'INFO', title: 'Meter reading day',
        body: 'The meter reader comes today. Type the number on your meter (kWh) in the app, so this month’s units and bill are right.', link: '/energy',
      });
    }
  }
}

/** " (until about 3:00 pm)" */
function windowEnd(until: Date, tz: string) {
  return ` (until about ${clockText(until, tz)})`;
}

/** For the day strip: in how many of the last 14 days each half hour had a cut. */
export function slotCounts(cuts: { start: number; end: number }[], tz: string, now: Date) {
  const counts = new Array(48).fill(0) as number[];
  const today = localDate(tz, now);
  for (let i = 13; i >= 0; i--) {
    const start = zonedToUtc(tz, today.y, today.m, today.d - i, 0, 0).getTime();
    for (let s = 0; s < 48; s++) {
      const a = start + s * 30 * MIN;
      const b = a + 30 * MIN;
      if (cuts.some((c) => Math.min(b, c.end) - Math.max(a, c.start) >= 10 * MIN)) counts[s]!++;
    }
  }
  return counts;
}

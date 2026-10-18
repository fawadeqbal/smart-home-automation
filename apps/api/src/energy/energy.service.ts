import { BadRequestException, Injectable } from '@nestjs/common';
import { OutageKind } from '@prisma/client';
import { AccessService } from '../access/access.service';
import { AuthUser } from '../auth/auth.types';
import { AuditService } from '../common/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { localDate, zoneOffsetMinutes, zonedToUtc } from '../automation/time';

/** Rupees per unit (kWh) when the owner hasn't set their own: a middle-of-the-road household rate. */
export const DEFAULT_TARIFF = 60;

/** What a device probably draws when on, from what it is called (watts). Null: can't tell. */
export function guessWatts(name: string, aliases: string[] = []): number | null {
  const t = ` ${[name, ...aliases].join(' ').toLowerCase()} `;
  const has = (...w: string[]) => w.some((x) => t.includes(x));
  if (has('geyser', 'water heater')) return 2000;
  if (has(' ac ', 'a/c', 'aircon', 'air con', 'split', 'inverter ac')) return 1500;
  if (has('heater', 'room heater')) return 1200;
  if (has('iron', 'istri', 'press')) return 1000;
  if (has('microwave', 'oven', 'kettle')) return 1200;
  if (has('motor', 'pump', 'tanki')) return 750;
  if (has('washing', 'washer')) return 500;
  if (has('cooler', 'air cooler')) return 200;
  if (has('fridge', 'refrigerator', 'freezer')) return 150;
  if (has(' tv', 'television', 'led tv')) return 100;
  if (has('fan', 'pankha', 'exhaust')) return 75;
  if (has('computer', ' pc', 'desktop')) return 150;
  if (has('router', 'modem', 'wifi')) return 10;
  if (has('light', 'bulb', 'batti', 'lamp', 'tube', 'led', 'spot', 'chandelier', 'jhoomar')) return 15;
  return null;
}

export interface Interval { start: number; end: number }

/** When a switch was on between `from` and `to`, from its history (and the state it was in at `from`). */
export function onIntervals(events: { at: Date; on: boolean }[], wasOn: boolean, from: number, to: number): Interval[] {
  const out: Interval[] = [];
  let since = wasOn ? from : null;
  for (const e of events) {
    const t = Math.min(Math.max(e.at.getTime(), from), to);
    if (e.on && since === null) since = t;
    else if (!e.on && since !== null) {
      if (t > since) out.push({ start: since, end: t });
      since = null;
    }
  }
  if (since !== null && to > since) out.push({ start: since, end: to });
  return out;
}

/** The same intervals with power cuts taken out (nothing runs without power). */
export function withoutCuts(on: Interval[], cuts: Interval[]): Interval[] {
  let parts = on;
  for (const c of cuts) {
    parts = parts.flatMap((p) => {
      if (c.end <= p.start || c.start >= p.end) return [p];
      const keep: Interval[] = [];
      if (c.start > p.start) keep.push({ start: p.start, end: c.start });
      if (c.end < p.end) keep.push({ start: c.end, end: p.end });
      return keep;
    });
  }
  return parts;
}

/** Hours in each local day (YYYY-MM-DD) of the home's time zone. */
export function hoursByDay(intervals: Interval[], timeZone: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const iv of intervals) {
    let t = iv.start;
    while (t < iv.end) {
      const d = localDate(timeZone, new Date(t));
      const next = zonedToUtc(timeZone, d.y, d.m, d.d + 1, 0, 0).getTime();
      const until = Math.min(next, iv.end);
      const key = `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
      out.set(key, (out.get(key) ?? 0) + (until - t) / 3_600_000);
      t = until;
    }
  }
  return out;
}

const round = (n: number, places = 2) => Math.round(n * 10 ** places) / 10 ** places;

/** A switch's on-times (power cuts taken out) and its power, for estimates over any stretch of time. */
export interface DeviceRun { id: string; name: string; watts: number; intervals: Interval[] }

/** Estimated units of these switches between `from` and `to` (ms), in all and per device. */
export function kwhBetween(runs: DeviceRun[], from: number, to: number) {
  const devices = runs.map((r) => {
    const hours = r.intervals.reduce((a, iv) => a + Math.max(0, Math.min(iv.end, to) - Math.max(iv.start, from)), 0) / 3_600_000;
    return { id: r.id, name: r.name, kwh: (hours * r.watts) / 1000 };
  }).sort((a, b) => b.kwh - a.kwh);
  return { kwh: devices.reduce((a, d) => a + d.kwh, 0), devices };
}

/**
 * Electricity estimates: how long each switch was on (from its history, minus power cuts) times
 * the power it draws, and what that costs at the home's rate. Estimates, not a meter: they say so.
 */
@Injectable()
export class EnergyService {
  constructor(private readonly prisma: PrismaService, private readonly access: AccessService, private readonly audit: AuditService) {}

  async usage(user: AuthUser, days: number, now = new Date()) {
    days = Math.max(1, Math.min(90, Math.round(days)));
    const home = await this.prisma.home.findUniqueOrThrow({ where: { id: user.homeId }, select: { timezone: true, tariff: true } });
    const tz = home.timezone;
    // from local midnight `days - 1` days ago, so "7 days" is today and the six before
    const today = localDate(tz, now);
    const from = zonedToUtc(tz, today.y, today.m, today.d - (days - 1), 0, 0);
    const to = now;
    const tariff = home.tariff ?? DEFAULT_TARIFF;

    const levels = await this.access.roomLevels(user);
    const devices = (await this.prisma.device.findMany({
      // devices waiting for a replacement board too: their past use still counts
      where: { node: { homeId: user.homeId, status: { in: ['ADOPTED', 'FAULTY'] } }, type: 'switch' },
      include: { room: { select: { name: true } }, state: true },
      orderBy: { name: 'asc' },
    })).filter((d) => this.access.levelFor(levels, d.roomId));
    const ids = devices.map((d) => d.id);
    const [events, before, cuts] = await Promise.all([
      this.prisma.stateEvent.findMany({ where: { deviceId: { in: ids }, at: { gte: from, lte: to } }, orderBy: { at: 'asc' }, select: { deviceId: true, at: true, state: true } }),
      this.prisma.stateEvent.findMany({
        where: { deviceId: { in: ids }, at: { lt: from } }, distinct: ['deviceId'], orderBy: [{ deviceId: 'asc' }, { at: 'desc' }], select: { deviceId: true, state: true },
      }),
      this.prisma.outage.findMany({
        where: { homeId: user.homeId, kind: OutageKind.POWER, endedAt: { gte: from }, startedAt: { lte: to } }, select: { nodeId: true, startedAt: true, endedAt: true },
      }),
    ]);
    const isOn = (s: unknown) => (s as { on?: unknown } | null)?.on === true;

    const dayKeys: string[] = [];
    for (let i = 0; i < days; i++) {
      const d = localDate(tz, zonedToUtc(tz, today.y, today.m, today.d - (days - 1) + i, 12, 0));
      dayKeys.push(`${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`);
    }
    const perDay = new Map(dayKeys.map((k) => [k, 0]));
    const rows = devices.map((d) => {
      const own = events.filter((e) => e.deviceId === d.id).map((e) => ({ at: e.at, on: isOn(e.state) }));
      const startedOn = isOn(before.find((b) => b.deviceId === d.id)?.state ?? null);
      const myCuts = cuts.filter((c) => c.nodeId === d.nodeId).map((c) => ({ start: c.startedAt.getTime(), end: c.endedAt.getTime() }));
      const intervals = withoutCuts(onIntervals(own, startedOn, from.getTime(), to.getTime()), myCuts);
      const guess = guessWatts(d.name, d.aliases);
      const watts = d.watts ?? guess ?? 0;
      let hours = 0;
      for (const [day, h] of hoursByDay(intervals, tz)) {
        hours += h;
        if (perDay.has(day)) perDay.set(day, perDay.get(day)! + (h * watts) / 1000);
      }
      const kwh = (hours * watts) / 1000;
      return {
        id: d.id, name: d.name, room: d.room?.name ?? null, watts, wattsSource: d.watts ? 'set' : guess ? 'guessed' : 'unknown',
        hours: round(hours, 1), kwh: round(kwh), cost: Math.round(kwh * tariff), onNow: isOn(d.state?.state ?? null),
      };
    }).sort((a, b) => b.kwh - a.kwh || b.hours - a.hours);

    const kwh = rows.reduce((a, r) => a + r.kwh, 0);
    // a month at this pace, from the whole days only once there are a few of them
    const elapsedDays = Math.max(1, (to.getTime() - from.getTime()) / 86_400_000);
    return {
      days, from, to, timezone: tz, tariff, tariffSet: home.tariff !== null, currency: 'Rs',
      total: { kwh: round(kwh), cost: Math.round(kwh * tariff), hours: round(rows.reduce((a, r) => a + r.hours, 0), 1) },
      month: { kwh: Math.round((kwh / elapsedDays) * 30), cost: Math.round(((kwh / elapsedDays) * 30 * tariff) / 10) * 10 },
      perDay: dayKeys.map((day) => ({ day, kwh: round(perDay.get(day)!), cost: Math.round(perDay.get(day)! * tariff) })),
      devices: rows,
      unknown: rows.filter((r) => r.wattsSource === 'unknown').length,
      powerCuts: cuts.length,
    };
  }

  /**
   * Every switch of the home (whoever is asking), with when it was on between `from` and `to`, minus
   * power cuts: what the bill falls back on for days without a meter reading.
   */
  async homeRuns(homeId: string, from: Date, to: Date): Promise<DeviceRun[]> {
    const devices = await this.prisma.device.findMany({
      where: { node: { homeId, status: 'ADOPTED' }, type: 'switch' }, select: { id: true, nodeId: true, name: true, aliases: true, watts: true },
    });
    const ids = devices.map((d) => d.id);
    const [events, before, cuts] = await Promise.all([
      this.prisma.stateEvent.findMany({ where: { deviceId: { in: ids }, at: { gte: from, lte: to } }, orderBy: { at: 'asc' }, select: { deviceId: true, at: true, state: true } }),
      this.prisma.stateEvent.findMany({
        where: { deviceId: { in: ids }, at: { lt: from } }, distinct: ['deviceId'], orderBy: [{ deviceId: 'asc' }, { at: 'desc' }], select: { deviceId: true, state: true },
      }),
      this.prisma.outage.findMany({ where: { homeId, kind: OutageKind.POWER, endedAt: { gte: from }, startedAt: { lte: to } }, select: { nodeId: true, source: true, startedAt: true, endedAt: true } }),
    ]);
    const isOn = (s: unknown) => (s as { on?: unknown } | null)?.on === true;
    return devices.map((d) => {
      const own = events.filter((e) => e.deviceId === d.id).map((e) => ({ at: e.at, on: isOn(e.state) }));
      // a cut seen by the grid sensor stopped everything not on the UPS; a board's own cut, its switches
      const myCuts = cuts.filter((c) => c.nodeId === d.nodeId || c.source === 'mains').map((c) => ({ start: c.startedAt.getTime(), end: c.endedAt.getTime() }));
      const intervals = withoutCuts(onIntervals(own, isOn(before.find((b) => b.deviceId === d.id)?.state ?? null), from.getTime(), to.getTime()), myCuts);
      return { id: d.id, name: d.name, watts: d.watts ?? guessWatts(d.name, d.aliases) ?? 0, intervals };
    });
  }

  async setTariff(user: AuthUser, tariff: number | null) {
    if (tariff !== null && !(tariff > 0 && tariff < 1000)) throw new BadRequestException('Give the price of one unit in rupees, e.g. 55.');
    await this.prisma.home.update({ where: { id: user.homeId }, data: { tariff } });
    await this.audit.record(user.homeId, user.id, 'home.tariff', user.homeId, { tariff });
  }
}

import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Access, Prisma, Role } from '@prisma/client';
import { AccessService } from '../access/access.service';
import { AuthService } from '../auth/auth.service';
import { AuthUser, isAdmin } from '../auth/auth.types';
import { AuditService } from '../common/audit.service';
import { DevicesService } from '../hardware/devices.service';
import { MonitoringService } from '../monitoring/monitoring.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { PlaceService } from './place.service';
import { sunOn } from './sun';
import { localDate, parseHhMm, zoneOffsetMinutes } from './time';

export type TriggerEvent = 'on' | 'off' | 'opens' | 'closes' | 'above' | 'below';
export interface Trigger { deviceId: string; event: TriggerEvent; value?: number; field?: 'temperature' | 'humidity' | 'level' }
export interface Conditions { from?: string; to?: string; days?: number[]; away?: boolean }
export type RuleAction =
  | { type: 'device'; deviceId: string; on: boolean; forMinutes?: number }
  | { type: 'scene'; sceneId: string }
  | { type: 'notify'; to: 'me' | 'admins' | 'everyone'; message?: string };
export interface RuleInput { name?: string; trigger: Trigger; conditions?: Conditions; actions: RuleAction[]; cooldownSec?: number; enabled?: boolean }

type DeviceRow = { id: string; name: string; type: string; roomId: string | null; settings: unknown; autoOffMinutes: number | null; node: { homeId: string | null; online: boolean } };

const TICK_MS = Number(process.env.RULES_TICK_MS) || 20_000;
const AWAY_END = '23:30';

/** Which events a device can trigger, and the reading they look at. */
export function eventsFor(type: string): TriggerEvent[] {
  if (type === 'switch') return ['on', 'off'];
  if (type === 'contact') return ['opens', 'closes'];
  if (type === 'dht' || type === 'analog') return ['above', 'below'];
  return [];
}

/** Did this change of state make the trigger happen (a crossing, not a reading that stays above)? */
export function fires(t: Trigger, before: Record<string, unknown> | null, now: Record<string, unknown>): boolean {
  switch (t.event) {
    case 'on': return now.on === true && before?.on !== true;
    case 'off': return now.on === false && before?.on === true;
    case 'opens': return now.active === true && before?.active !== true;
    case 'closes': return now.active === false && before?.active === true;
    case 'above':
    case 'below': {
      const field = t.field ?? (typeof now.level === 'number' && typeof now.temperature !== 'number' ? 'level' : 'temperature');
      const v = now[field];
      const was = before?.[field];
      if (typeof v !== 'number' || typeof t.value !== 'number') return false;
      const over = (x: unknown) => typeof x === 'number' && (t.event === 'above' ? x > t.value! : x < t.value!);
      return over(v) && !over(was);
    }
  }
}

/** Is it within the rule's time window and days (in the home's time zone)? */
export function withinWindow(c: Conditions, timeZone: string, at = new Date()): boolean {
  const local = new Date(at.getTime() + zoneOffsetMinutes(timeZone, at) * 60000);
  if (c.days?.length && !c.days.includes(local.getUTCDay())) return false;
  const from = c.from ? parseHhMm(c.from) : null;
  const to = c.to ? parseHhMm(c.to) : null;
  if (!from || !to) return true;
  const m = local.getUTCHours() * 60 + local.getUTCMinutes();
  const a = from.hh * 60 + from.mm;
  const b = to.hh * 60 + to.mm;
  return a <= b ? m >= a && m < b : m >= a || m < b;   // "22:00 to 06:00" wraps midnight
}

/**
 * "When this happens, do that" rules; safety auto-off; away mode's lived-in lights. Rules run with
 * their creator's rights (checked again each time), through the normal acknowledged command path.
 */
@Injectable()
export class RulesService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Rules');
  private timer?: NodeJS.Timeout;
  private ticking = false;
  /** when away mode last switched each light (so it doesn't flicker) */
  private readonly awayTouched = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly devices: DevicesService,
    private readonly access: AccessService,
    private readonly auth: AuthService,
    private readonly monitoring: MonitoringService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
    private readonly place: PlaceService,
  ) {}

  onModuleInit() {
    this.devices.onStateChange((d, before, now) => this.onDeviceState(d, before, now));
    this.timer = setInterval(() => void this.tick(), TICK_MS);
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  // ---------------------------------------------------------------- reading and writing rules
  async list(user: AuthUser) {
    const rows = await this.prisma.rule.findMany({
      where: { homeId: user.homeId, ...(isAdmin(user.role) ? {} : { createdById: user.id }) },
      include: { createdBy: { select: { name: true } } }, orderBy: [{ enabled: 'desc' }, { createdAt: 'desc' }],
    });
    const names = await this.deviceNames(user.homeId);
    const scenes = new Map((await this.prisma.scene.findMany({ where: { homeId: user.homeId }, select: { id: true, name: true } })).map((s) => [s.id, s.name]));
    return rows.map((r) => this.dto(r, names, scenes));
  }

  async create(user: AuthUser, input: RuleInput) {
    const clean = await this.check(user, input);
    const names = await this.deviceNames(user.homeId);
    const scenes = new Map((await this.prisma.scene.findMany({ where: { homeId: user.homeId }, select: { id: true, name: true } })).map((s) => [s.id, s.name]));
    const name = input.name?.trim() || describeRule(clean.trigger, clean.conditions, clean.actions, names, scenes);
    const rule = await this.prisma.rule.create({
      data: {
        homeId: user.homeId, name: name.slice(0, 120), createdById: user.id, enabled: input.enabled ?? true,
        trigger: clean.trigger as unknown as Prisma.InputJsonValue, conditions: clean.conditions as unknown as Prisma.InputJsonValue,
        actions: clean.actions as unknown as Prisma.InputJsonValue, cooldownSec: clean.cooldownSec,
      },
      include: { createdBy: { select: { name: true } } },
    });
    await this.audit.record(user.homeId, user.id, 'rule.create', rule.id, { name: rule.name, channel: user.channel });
    this.realtime.schedulesChanged(user.homeId);
    return this.dto(rule, names, scenes);
  }

  async update(user: AuthUser, id: string, input: Partial<RuleInput>) {
    const rule = await this.own(user, id);
    const data: Prisma.RuleUpdateInput = {};
    if (input.enabled !== undefined) data.enabled = input.enabled;
    if (input.name !== undefined) data.name = input.name.trim().slice(0, 120) || rule.name;
    if (input.trigger || input.conditions || input.actions || input.cooldownSec !== undefined) {
      const clean = await this.check(user, {
        trigger: input.trigger ?? (rule.trigger as unknown as Trigger), conditions: input.conditions ?? (rule.conditions as Conditions),
        actions: input.actions ?? (rule.actions as unknown as RuleAction[]), cooldownSec: input.cooldownSec ?? rule.cooldownSec,
      });
      data.trigger = clean.trigger as unknown as Prisma.InputJsonValue;
      data.conditions = clean.conditions as unknown as Prisma.InputJsonValue;
      data.actions = clean.actions as unknown as Prisma.InputJsonValue;
      data.cooldownSec = clean.cooldownSec;
    }
    await this.prisma.rule.update({ where: { id }, data });
    this.realtime.schedulesChanged(user.homeId);
    return (await this.list(user)).find((r) => r.id === id);
  }

  async remove(user: AuthUser, id: string) {
    const rule = await this.own(user, id);
    await this.prisma.rule.delete({ where: { id } });
    await this.audit.record(user.homeId, user.id, 'rule.remove', id, { name: rule.name, channel: user.channel });
    this.realtime.schedulesChanged(user.homeId);
  }

  private async check(user: AuthUser, input: RuleInput) {
    const t = input.trigger;
    const dev = await this.prisma.device.findFirst({ where: { id: t?.deviceId, node: { homeId: user.homeId } }, select: { id: true, type: true, roomId: true, name: true } });
    if (!dev) throw new BadRequestException('Pick the device that starts the rule.');
    await this.access.require(user, dev.roomId, Access.VIEW);
    const allowed = eventsFor(dev.type);
    if (!allowed.includes(t.event)) throw new BadRequestException(`${dev.name} can start a rule when: ${allowed.join(', ') || 'nothing'}.`);
    const trigger: Trigger = { deviceId: dev.id, event: t.event };
    if (t.event === 'above' || t.event === 'below') {
      if (typeof t.value !== 'number' || !Number.isFinite(t.value)) throw new BadRequestException('Say the value, e.g. above 30.');
      trigger.value = t.value;
      trigger.field = dev.type === 'analog' ? 'level' : t.field === 'humidity' ? 'humidity' : 'temperature';
    }

    const c = input.conditions ?? {};
    const conditions: Conditions = {};
    if (c.from || c.to) {
      if (!c.from || !c.to || !parseHhMm(c.from) || !parseHhMm(c.to)) throw new BadRequestException('A time window needs a start and an end, like 22:00 to 06:00.');
      conditions.from = c.from.padStart(5, '0');
      conditions.to = c.to.padStart(5, '0');
    }
    if (c.days?.length) conditions.days = [...new Set(c.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
    if (typeof c.away === 'boolean') conditions.away = c.away;

    if (!input.actions?.length) throw new BadRequestException('Say what to do: switch something, run a scene or tell someone.');
    if (input.actions.length > 10) throw new BadRequestException('At most 10 things to do in one rule.');
    const actions: RuleAction[] = [];
    for (const a of input.actions) {
      if (a.type === 'device') {
        const d = await this.prisma.device.findFirst({ where: { id: a.deviceId, node: { homeId: user.homeId } }, select: { roomId: true, type: true, name: true } });
        if (!d) throw new BadRequestException('One of the devices does not exist.');
        if (d.type !== 'switch') throw new BadRequestException(`${d.name} can't be switched.`);
        await this.access.require(user, d.roomId, Access.CONTROL);
        const forMinutes = a.forMinutes ? Math.max(1, Math.min(24 * 60, Math.round(a.forMinutes))) : undefined;
        actions.push({ type: 'device', deviceId: a.deviceId, on: !!a.on, ...(forMinutes && a.on ? { forMinutes } : {}) });
      } else if (a.type === 'scene') {
        const s = await this.prisma.scene.findFirst({ where: { id: a.sceneId, homeId: user.homeId } });
        if (!s) throw new BadRequestException('No such scene.');
        actions.push({ type: 'scene', sceneId: s.id });
      } else if (a.type === 'notify') {
        const to = a.to === 'everyone' || a.to === 'admins' ? a.to : 'me';
        if (to !== 'me' && !isAdmin(user.role)) throw new ForbiddenException('Only the owner or an admin can send notices to others.');
        actions.push({ type: 'notify', to, ...(a.message?.trim() ? { message: a.message.trim().slice(0, 200) } : {}) });
      } else {
        throw new BadRequestException('Unknown action.');
      }
    }
    const cooldownSec = Math.max(30, Math.min(24 * 3600, Math.round(input.cooldownSec ?? 120)));
    return { trigger, conditions, actions, cooldownSec };
  }

  // ---------------------------------------------------------------- running rules
  async onDeviceState(d: DeviceRow, before: Record<string, unknown> | null, now: Record<string, unknown>) {
    const homeId = d.node.homeId;
    if (!homeId) return;
    // safety auto-off: count from when it goes on; nothing to do once it's off
    if (d.type === 'switch') {
      if (now.on === true && before?.on !== true && d.autoOffMinutes) {
        await this.prisma.device.update({ where: { id: d.id }, data: { autoOffAt: new Date(Date.now() + d.autoOffMinutes * 60_000) } });
      } else if (now.on === false) {
        await this.prisma.device.updateMany({ where: { id: d.id, autoOffAt: { not: null } }, data: { autoOffAt: null } });
      }
    }
    const rules = await this.prisma.rule.findMany({ where: { homeId, enabled: true } });
    const matching = rules.filter((r) => (r.trigger as unknown as Trigger).deviceId === d.id && fires(r.trigger as unknown as Trigger, before, now));
    if (!matching.length) return;
    const home = await this.prisma.home.findUniqueOrThrow({ where: { id: homeId }, select: { timezone: true, awayMode: true } });
    for (const r of matching) {
      const c = r.conditions as Conditions;
      if (!withinWindow(c, home.timezone)) continue;
      if (c.away === true && !home.awayMode) continue;
      if (c.away === false && home.awayMode) continue;
      if (r.lastFiredAt && Date.now() - r.lastFiredAt.getTime() < r.cooldownSec * 1000) continue;
      await this.prisma.rule.update({ where: { id: r.id }, data: { lastFiredAt: new Date() } });
      void this.run(r, d, now).catch((e) => this.log.warn(`Rule "${r.name}" failed: ${e}`));
    }
  }

  private async run(r: { id: string; name: string; homeId: string; createdById: string; actions: Prisma.JsonValue }, trigger: DeviceRow, now: Record<string, unknown>) {
    const actor = await this.auth.actorFor(r.createdById, r.homeId, 'automation');
    let summary: string;
    if (!actor || actor.readOnly) {
      summary = 'Skipped: its creator no longer has access to this home.';
    } else {
      const done: string[] = [];
      const failed: string[] = [];
      for (const a of r.actions as unknown as RuleAction[]) {
        try {
          if (a.type === 'device') {
            const res = await this.devices.command(actor, a.deviceId, { on: a.on });
            if (a.on && a.forMinutes) await this.offAt(a.deviceId, a.forMinutes);
            done.push(`${res.name} ${a.on ? 'on' : 'off'}${a.forMinutes && a.on ? ` for ${a.forMinutes} min` : ''}`);
          } else if (a.type === 'scene') {
            const scene = await this.prisma.scene.findFirst({ where: { id: a.sceneId, homeId: r.homeId } });
            if (!scene) throw new Error('the scene was deleted');
            for (const s of scene.actions as unknown as { deviceId: string; on: boolean }[]) await this.devices.command(actor, s.deviceId, { on: s.on });
            done.push(`scene ${scene.name}`);
          } else if (a.type === 'notify') {
            const to = await this.recipients(r.homeId, a.to, r.createdById);
            const what = describeTrigger(trigger, now);
            await this.monitoring.notify(r.homeId, to, {
              kind: 'automation', severity: trigger.type === 'contact' ? 'WARN' : 'INFO',
              title: r.name, body: a.message ?? `${what}.`, link: `/automations?home=${r.homeId}`,
            });
            done.push(`told ${a.to === 'me' ? 'its creator' : a.to}`);
          }
        } catch (err) {
          failed.push((err as Error).message);
        }
      }
      summary = [done.length ? `Done: ${done.join(', ')}.` : '', failed.length ? `Failed: ${failed.join('; ')}` : ''].filter(Boolean).join(' ') || 'Nothing to do.';
    }
    this.log.log(`Rule "${r.name}": ${summary}`);
    await this.prisma.rule.update({ where: { id: r.id }, data: { lastResult: summary } });
    this.realtime.schedulesChanged(r.homeId);
  }

  private async recipients(homeId: string, to: 'me' | 'admins' | 'everyone', creator: string) {
    if (to === 'me') return [creator];
    const members = await this.prisma.membership.findMany({
      where: { homeId, user: { disabled: false }, ...(to === 'admins' ? { role: { in: [Role.OWNER, Role.ADMIN] } } : {}) }, select: { userId: true },
    });
    return members.map((m) => m.userId);
  }

  /** It goes off by itself this many minutes from now (the sooner of this and its own auto-off). */
  private async offAt(deviceId: string, minutes: number) {
    const at = new Date(Date.now() + minutes * 60_000);
    const d = await this.prisma.device.findUnique({ where: { id: deviceId }, select: { autoOffAt: true } });
    if (!d?.autoOffAt || d.autoOffAt > at) await this.prisma.device.update({ where: { id: deviceId }, data: { autoOffAt: at } });
  }

  // ---------------------------------------------------------------- the clock: auto-off and away mode
  async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      await this.autoOff();
      await this.awayLights();
    } catch (err) {
      this.log.warn(`tick failed: ${(err as Error).message}`);
    } finally {
      this.ticking = false;
    }
  }

  private async autoOff() {
    const due = await this.prisma.device.findMany({
      where: { autoOffAt: { lte: new Date() } }, include: { node: { select: { homeId: true, online: true } }, state: true }, take: 50,
    });
    for (const d of due) {
      await this.prisma.device.update({ where: { id: d.id }, data: { autoOffAt: null } });
      if (!d.node.homeId || (d.state?.state as { on?: boolean } | null)?.on !== true) continue;
      const actor = await this.ownerActor(d.node.homeId);
      if (!actor) continue;
      try {
        await this.devices.command(actor, d.id, { on: false });
        this.log.log(`${d.name} switched off by itself`);
      } catch (err) {
        this.log.warn(`Could not switch ${d.name} off by itself: ${(err as Error).message}`);
      }
    }
  }

  /** In the evening, chosen lights go on and off at random times, as if someone were home. */
  private async awayLights(now = new Date()) {
    const homes = await this.prisma.home.findMany({ where: { awayMode: true, NOT: { awayLights: { isEmpty: true } } }, select: { id: true, timezone: true, awayLights: true } });
    for (const h of homes) {
      const p = await this.place.of(h.id);
      const d = localDate(h.timezone, now);
      const sunset = sunOn(h.timezone, d.y, d.m, d.d, 'SUNSET', 15, p.lat, p.lon);
      const end = parseHhMm(AWAY_END)!;
      const local = new Date(now.getTime() + zoneOffsetMinutes(h.timezone, now) * 60000);
      const minute = local.getUTCHours() * 60 + local.getUTCMinutes();
      const sunsetLocal = sunset ? new Date(sunset.getTime() + zoneOffsetMinutes(h.timezone, sunset) * 60000) : null;
      const start = sunsetLocal ? sunsetLocal.getUTCHours() * 60 + sunsetLocal.getUTCMinutes() : 18 * 60 + 30;
      const stop = end.hh * 60 + end.mm;
      if (minute < start || minute >= stop) continue;
      const lights = await this.prisma.device.findMany({ where: { id: { in: h.awayLights }, type: 'switch', node: { homeId: h.id, online: true } }, include: { state: true } });
      const actor = await this.ownerActor(h.id);
      if (!actor) continue;
      for (const l of lights) {
        const on = (l.state?.state as { on?: boolean } | null)?.on === true;
        const last = this.awayTouched.get(l.id) ?? 0;
        if (on || Date.now() - last < 15 * 60_000) continue;
        // about once every 20 minutes per light, for 20 to 75 minutes, never past the end of the evening
        if (Math.random() > TICK_MS / (20 * 60_000)) continue;
        const minutes = Math.min(20 + Math.floor(Math.random() * 56), stop - minute);
        if (minutes < 5) continue;
        try {
          await this.devices.command(actor, l.id, { on: true });
          await this.offAt(l.id, minutes);
          this.awayTouched.set(l.id, Date.now());
          this.log.log(`Away mode: ${l.name} on for ${minutes} min`);
        } catch (err) {
          this.log.warn(`Away mode could not switch ${l.name}: ${(err as Error).message}`);
        }
      }
    }
  }

  /** The home's owner: auto-off and away mode act with their rights. */
  private async ownerActor(homeId: string) {
    const owner = await this.prisma.membership.findFirst({ where: { homeId, role: Role.OWNER, user: { disabled: false } }, select: { userId: true } });
    return owner ? this.auth.actorFor(owner.userId, homeId, 'automation') : null;
  }

  // ---------------------------------------------------------------- away mode
  async away(user: AuthUser) {
    const home = await this.prisma.home.findUniqueOrThrow({ where: { id: user.homeId }, select: { awayMode: true, awaySince: true, awayById: true, awayLights: true, timezone: true } });
    const by = home.awayById ? await this.prisma.user.findUnique({ where: { id: home.awayById }, select: { name: true } }) : null;
    const switches = await this.prisma.device.findMany({
      where: { node: { homeId: user.homeId, status: 'ADOPTED' }, type: 'switch', enabled: true },
      select: { id: true, name: true, room: { select: { name: true } } }, orderBy: { name: 'asc' },
    });
    const p = await this.place.today(user.homeId, home.timezone);
    return {
      on: home.awayMode, since: home.awaySince, by: by?.name ?? null,
      lights: home.awayLights.filter((id) => switches.some((s) => s.id === id)),
      switches: switches.map((s) => ({ id: s.id, name: s.name, room: s.room?.name ?? null })),
      eveningFrom: p.sunset ? new Date(p.sunset.getTime() + 15 * 60_000) : null, eveningTo: AWAY_END,
    };
  }

  /** Away mode: door and motion alerts at any hour, and (if lights are picked) a lived-in look in the evening. */
  async setAway(user: AuthUser, input: { on?: boolean; lights?: string[] }) {
    if (user.readOnly) throw new ForbiddenException('Support can look but not change things.');
    const home = await this.prisma.home.findUniqueOrThrow({ where: { id: user.homeId }, select: { awayMode: true } });
    const data: Prisma.HomeUpdateInput = {};
    if (input.lights !== undefined) {
      if (!isAdmin(user.role)) throw new ForbiddenException('Only the owner or an admin picks the away-mode lights.');
      const ok = await this.prisma.device.findMany({ where: { id: { in: input.lights }, type: 'switch', node: { homeId: user.homeId } }, select: { id: true } });
      data.awayLights = ok.map((d) => d.id).slice(0, 20);
    }
    if (input.on !== undefined && input.on !== home.awayMode) {
      data.awayMode = input.on;
      data.awaySince = input.on ? new Date() : null;
      data.awayById = input.on ? user.id : null;
    }
    await this.prisma.home.update({ where: { id: user.homeId }, data });
    if (data.awayMode !== undefined) {
      await this.audit.record(user.homeId, user.id, input.on ? 'away.on' : 'away.off', user.homeId, { channel: user.channel });
      const members = await this.prisma.membership.findMany({ where: { homeId: user.homeId, user: { disabled: false }, NOT: { userId: user.id } }, select: { userId: true } });
      await this.monitoring.notify(user.homeId, members.map((m) => m.userId), {
        kind: 'awayAlert', severity: 'INFO', title: input.on ? 'Away mode is on' : 'Away mode is off',
        body: input.on ? `${user.name} turned on away mode: door and motion alerts at any hour.` : `${user.name} turned away mode off. Welcome home.`, link: `/?home=${user.homeId}`,
      });
    }
    this.realtime.devicesChanged(user.homeId);
    return this.away(user);
  }

  // ---------------------------------------------------------------- helpers
  private async own(user: AuthUser, id: string) {
    const r = await this.prisma.rule.findFirst({ where: { id, homeId: user.homeId } });
    if (!r) throw new NotFoundException('No such rule.');
    if (!isAdmin(user.role) && r.createdById !== user.id) throw new ForbiddenException('Only its creator or an admin can change this rule.');
    return r;
  }

  private async deviceNames(homeId: string) {
    const rows = await this.prisma.device.findMany({ where: { node: { homeId } }, select: { id: true, name: true, room: { select: { name: true } } } });
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  private dto(r: { id: string; name: string; enabled: boolean; trigger: Prisma.JsonValue; conditions: Prisma.JsonValue; actions: Prisma.JsonValue; cooldownSec: number;
    lastFiredAt: Date | null; lastResult: string | null; createdById: string; createdBy: { name: string } }, names: Map<string, string>, scenes: Map<string, string>) {
    const trigger = r.trigger as unknown as Trigger;
    const actions = r.actions as unknown as RuleAction[];
    const conditions = r.conditions as Conditions;
    return {
      id: r.id, name: r.name, enabled: r.enabled, trigger: { ...trigger, deviceName: names.get(trigger.deviceId) ?? 'Removed device' },
      conditions, cooldownSec: r.cooldownSec, lastFiredAt: r.lastFiredAt, lastResult: r.lastResult, createdBy: r.createdBy.name, createdById: r.createdById,
      actions: actions.map((a) => a.type === 'device' ? { ...a, deviceName: names.get(a.deviceId) ?? 'Removed device' }
        : a.type === 'scene' ? { ...a, sceneName: scenes.get(a.sceneId) ?? 'Removed scene' } : a),
      summary: describeRule(trigger, conditions, actions, names, scenes),
    };
  }
}

const EVENT_TEXT: Record<TriggerEvent, string> = { on: 'turns on', off: 'turns off', opens: 'opens', closes: 'closes', above: 'goes above', below: 'goes below' };

/** "When the Main door opens between 22:00 and 06:00: Hall light on for 5 min, tell me". */
export function describeRule(t: Trigger, c: Conditions, actions: RuleAction[], names: Map<string, string>, scenes: Map<string, string>) {
  const dev = names.get(t.deviceId) ?? 'a device';
  const unit = t.field === 'humidity' || t.field === 'level' ? '%' : '°C';
  const when = `When ${dev} ${t.event === 'opens' && /motion/i.test(dev) ? 'sees movement' : EVENT_TEXT[t.event]}${t.value !== undefined ? ` ${t.value}${unit}` : ''}`;
  const window = c.from && c.to ? ` between ${c.from} and ${c.to}` : '';
  const away = c.away === true ? ' while away' : c.away === false ? ' while home' : '';
  const does = actions.map((a) => a.type === 'device' ? `${names.get(a.deviceId) ?? 'a device'} ${a.on ? 'on' : 'off'}${a.forMinutes ? ` for ${a.forMinutes} min` : ''}`
    : a.type === 'scene' ? `run ${scenes.get(a.sceneId) ?? 'a scene'}` : a.to === 'me' ? 'tell me' : `tell ${a.to}`).join(', ');
  return `${when}${window}${away}: ${does}`;
}

function describeTrigger(d: DeviceRow, now: Record<string, unknown>) {
  if (d.type === 'contact') return now.active ? `${d.name} was triggered` : `${d.name} went back to normal`;
  if (d.type === 'switch') return `${d.name} turned ${now.on ? 'on' : 'off'}`;
  const v = now.temperature ?? now.level ?? now.humidity;
  return `${d.name} reads ${typeof v === 'number' ? v.toFixed(1) : v}`;
}

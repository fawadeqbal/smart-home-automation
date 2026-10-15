import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Access, Prisma, Schedule, ScheduleKind } from '@prisma/client';
import { AccessService } from '../access/access.service';
import { AuthService } from '../auth/auth.service';
import { AuthUser, isAdmin } from '../auth/auth.types';
import { AuditService } from '../common/audit.service';
import { DevicesService } from '../hardware/devices.service';
import { MonitoringService } from '../monitoring/monitoring.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { nextDaily, parseHhMm } from './time';

export interface Action { deviceId: string; on: boolean }
export interface ScheduleInput {
  name?: string;
  kind: 'ONCE' | 'DAILY';
  /** ONCE: either an absolute time or minutes from now */
  runAt?: string;
  inMinutes?: number;
  /** DAILY */
  time?: string;
  days?: number[];
  actions?: Action[];
  sceneId?: string;
}
export interface SceneInput { name: string; icon?: string; actions: Action[] }

const TICK_MS = 5000;

/**
 * Timers, daily schedules and scenes. A scheduled run uses the rights of the person who created it
 * (re-checked at run time), goes through the normal command path (acknowledged by the board), and is
 * marked in history as channel "automation".
 */
@Injectable()
export class AutomationService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Automation');
  private timer?: NodeJS.Timeout;
  private ticking = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly devices: DevicesService,
    private readonly access: AccessService,
    private readonly realtime: RealtimeService,
    private readonly audit: AuditService,
    private readonly monitoring: MonitoringService,
    private readonly auth: AuthService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.tick(), TICK_MS);
  }
  onModuleDestroy() {
    clearInterval(this.timer);
  }

  // ---------------------------------------------------------------- reading
  async listSchedules(user: AuthUser) {
    const rows = await this.prisma.schedule.findMany({
      where: { homeId: user.homeId, ...(isAdmin(user.role) ? {} : { createdById: user.id }) },
      include: { createdBy: { select: { name: true } }, scene: { select: { name: true } } },
      orderBy: [{ enabled: 'desc' }, { nextRunAt: 'asc' }],
    });
    const names = await this.deviceNames(user.homeId);
    return rows.map((s) => this.scheduleDto(s, names));
  }

  async listScenes(user: AuthUser) {
    const rows = await this.prisma.scene.findMany({ where: { homeId: user.homeId }, orderBy: { name: 'asc' }, include: { createdBy: { select: { name: true } } } });
    const names = await this.deviceNames(user.homeId);
    const levels = await this.access.roomLevels(user);
    const rooms = await this.deviceRooms(user.homeId);
    // a scene is usable by someone who may control every device in it
    return rows.map((s) => {
      const actions = s.actions as unknown as Action[];
      const canRun = actions.every((a) => {
        const level = this.access.levelFor(levels, rooms.get(a.deviceId) ?? null);
        return level === Access.CONTROL || level === Access.MANAGE;
      });
      return {
        id: s.id, name: s.name, icon: s.icon, createdBy: s.createdBy.name, canRun,
        actions: actions.map((a) => ({ ...a, deviceName: names.get(a.deviceId) ?? 'Removed device' })),
      };
    });
  }

  // ---------------------------------------------------------------- schedules
  async createSchedule(user: AuthUser, input: ScheduleInput) {
    const home = await this.prisma.home.findUniqueOrThrow({ where: { id: user.homeId } });
    let actions: Action[] = [];
    let sceneId: string | null = null;
    if (input.sceneId) {
      const scene = await this.prisma.scene.findFirst({ where: { id: input.sceneId, homeId: user.homeId } });
      if (!scene) throw new NotFoundException('No such scene.');
      sceneId = scene.id;
      await this.assertCanControl(user, scene.actions as unknown as Action[]);
    } else {
      actions = await this.checkActions(user, input.actions ?? []);
    }

    let runAt: Date | null = null;
    let time: string | null = null;
    let days: number[] = [];
    let nextRunAt: Date | null;
    if (input.kind === 'ONCE') {
      runAt = input.inMinutes !== undefined ? new Date(Date.now() + input.inMinutes * 60000) : input.runAt ? new Date(input.runAt) : null;
      if (!runAt || Number.isNaN(runAt.getTime())) throw new BadRequestException('Say when: a time or a number of minutes.');
      if (runAt.getTime() < Date.now() - 60000) throw new BadRequestException('That time has already passed.');
      if (runAt.getTime() > Date.now() + 366 * 86400000) throw new BadRequestException('Timers can be at most a year ahead.');
      nextRunAt = runAt;
    } else {
      if (!input.time || !parseHhMm(input.time)) throw new BadRequestException('Daily schedules need a time like 19:30.');
      time = input.time.padStart(5, '0');
      days = [...new Set((input.days ?? []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
      nextRunAt = nextDaily(time, days, home.timezone, new Date());
    }

    const name = input.name?.trim() || (await this.autoName(user.homeId, actions, sceneId));
    const created = await this.prisma.schedule.create({
      data: {
        homeId: user.homeId, name, kind: input.kind as ScheduleKind, runAt, time, days, sceneId,
        actions: actions as unknown as Prisma.InputJsonValue, createdById: user.id, nextRunAt,
      },
      include: { createdBy: { select: { name: true } }, scene: { select: { name: true } } },
    });
    await this.audit.record(user.homeId, user.id, 'schedule.create', created.id, { name, kind: input.kind, channel: user.channel });
    this.realtime.schedulesChanged(user.homeId);
    return this.scheduleDto(created, await this.deviceNames(user.homeId));
  }

  async setEnabled(user: AuthUser, id: string, enabled: boolean) {
    const s = await this.own(user, id);
    const home = await this.prisma.home.findUniqueOrThrow({ where: { id: user.homeId } });
    let nextRunAt = s.nextRunAt;
    if (enabled) {
      if (s.kind === 'DAILY') nextRunAt = nextDaily(s.time!, s.days, home.timezone, new Date());
      else if (!s.runAt || s.runAt.getTime() < Date.now()) throw new BadRequestException('This timer has already run.');
    }
    await this.prisma.schedule.update({ where: { id }, data: { enabled, nextRunAt } });
    this.realtime.schedulesChanged(user.homeId);
  }

  async removeSchedule(user: AuthUser, id: string) {
    const s = await this.own(user, id);
    await this.prisma.schedule.delete({ where: { id: s.id } });
    await this.audit.record(user.homeId, user.id, 'schedule.remove', id, { name: s.name, channel: user.channel });
    this.realtime.schedulesChanged(user.homeId);
  }

  // ---------------------------------------------------------------- scenes
  async createScene(user: AuthUser, input: SceneInput) {
    const actions = await this.checkActions(user, input.actions);
    if (!actions.length) throw new BadRequestException('A scene needs at least one device.');
    try {
      const scene = await this.prisma.scene.create({
        data: { homeId: user.homeId, name: input.name.trim(), icon: input.icon ?? 'sparkles', actions: actions as unknown as Prisma.InputJsonValue, createdById: user.id },
      });
      await this.audit.record(user.homeId, user.id, 'scene.create', scene.id, { name: scene.name });
      this.realtime.schedulesChanged(user.homeId);
      return scene;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw new BadRequestException('A scene with that name exists.');
      throw err;
    }
  }

  async removeScene(user: AuthUser, id: string) {
    const scene = await this.prisma.scene.findFirst({ where: { id, homeId: user.homeId } });
    if (!scene) throw new NotFoundException('No such scene.');
    if (!isAdmin(user.role) && scene.createdById !== user.id) throw new ForbiddenException('Only its creator or an admin can delete this scene.');
    await this.prisma.scene.delete({ where: { id } });
    this.realtime.schedulesChanged(user.homeId);
  }

  async runScene(user: AuthUser, id: string) {
    const scene = await this.prisma.scene.findFirst({ where: { id, homeId: user.homeId } });
    if (!scene) throw new NotFoundException('No such scene.');
    const result = await this.runActions(user, scene.actions as unknown as Action[]);
    await this.audit.record(user.homeId, user.id, 'scene.run', id, { name: scene.name, channel: user.channel, result: result.summary });
    return result;
  }

  // ---------------------------------------------------------------- the clock
  private async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const due = await this.prisma.schedule.findMany({
        where: { enabled: true, nextRunAt: { lte: new Date() } },
        include: { scene: true, createdBy: true, home: true },
        take: 50,
      });
      for (const s of due) await this.fire(s);
    } catch (err) {
      this.log.error(`Scheduler tick failed: ${(err as Error).message}`);
    } finally {
      this.ticking = false;
    }
  }

  private async fire(s: Schedule & { scene: { actions: Prisma.JsonValue } | null; createdBy: { id: string; disabled: boolean }; home: { timezone: string } }) {
    // move it forward first, so a slow or failing run never fires twice
    const next = s.kind === 'DAILY' ? nextDaily(s.time!, s.days, s.home.timezone, new Date()) : null;
    await this.prisma.schedule.update({ where: { id: s.id }, data: { nextRunAt: next, enabled: s.kind === 'DAILY' } });

    let summary: string;
    let ok = false;
    const actor = s.createdBy.disabled ? null : await this.auth.actorFor(s.createdById, s.homeId, 'automation');
    if (s.createdBy.disabled) {
      summary = 'Skipped: its creator’s account is disabled.';
    } else if (!actor || actor.readOnly) {
      summary = 'Skipped: its creator no longer has access to this home.';
    } else {
      const actions = (s.scene ? s.scene.actions : s.actions) as unknown as Action[];
      const result = await this.runActions(actor, actions);
      summary = result.summary;
      ok = result.ok;
    }
    if (!ok && !s.createdBy.disabled) await this.monitoring.scheduleFailed(s, summary).catch(() => undefined);
    this.log.log(`Schedule "${s.name}": ${summary}`);
    await this.prisma.schedule.update({ where: { id: s.id }, data: { lastRunAt: new Date(), lastResult: summary } });
    this.realtime.scheduleRan(s.homeId, { id: s.id, name: s.name, result: summary, createdById: s.createdById });
    this.realtime.schedulesChanged(s.homeId);
  }

  private async runActions(actor: AuthUser, actions: Action[]) {
    const names = await this.deviceNames(actor.homeId);
    const done: string[] = [];
    const failed: string[] = [];
    for (const a of actions) {
      const label = names.get(a.deviceId) ?? 'a removed device';
      try {
        await this.devices.command(actor, a.deviceId, { on: a.on });
        done.push(`${label} ${a.on ? 'on' : 'off'}`);
      } catch (err) {
        failed.push(`${label}: ${(err as Error).message}`);
      }
    }
    const summary = [done.length ? `Done: ${done.join(', ')}.` : '', failed.length ? `Failed: ${failed.join('; ')}` : ''].filter(Boolean).join(' ') || 'Nothing to do.';
    return { ok: failed.length === 0, done, failed, summary };
  }

  // ---------------------------------------------------------------- helpers
  private async own(user: AuthUser, id: string) {
    const s = await this.prisma.schedule.findFirst({ where: { id, homeId: user.homeId } });
    if (!s) throw new NotFoundException('No such schedule.');
    if (!isAdmin(user.role) && s.createdById !== user.id) throw new ForbiddenException('Only its creator or an admin can change this schedule.');
    return s;
  }

  private async checkActions(user: AuthUser, actions: Action[]): Promise<Action[]> {
    if (actions.length > 30) throw new BadRequestException('At most 30 devices at once.');
    const rows = await this.prisma.device.findMany({ where: { id: { in: actions.map((a) => a.deviceId) }, node: { homeId: user.homeId } } });
    for (const a of actions) {
      const d = rows.find((r) => r.id === a.deviceId);
      if (!d) throw new BadRequestException('One of the devices does not exist.');
    }
    await this.assertCanControl(user, actions);
    return actions.map((a) => ({ deviceId: a.deviceId, on: !!a.on }));
  }

  private async assertCanControl(user: AuthUser, actions: Action[]) {
    const rooms = await this.deviceRooms(user.homeId);
    for (const a of actions) await this.access.require(user, rooms.get(a.deviceId) ?? null, Access.CONTROL);
  }

  private async deviceNames(homeId: string) {
    const rows = await this.prisma.device.findMany({ where: { node: { homeId } }, select: { id: true, name: true } });
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  private async deviceRooms(homeId: string) {
    const rows = await this.prisma.device.findMany({ where: { node: { homeId } }, select: { id: true, roomId: true } });
    return new Map(rows.map((r) => [r.id, r.roomId]));
  }

  private async autoName(homeId: string, actions: Action[], sceneId: string | null) {
    if (sceneId) return (await this.prisma.scene.findUnique({ where: { id: sceneId } }))?.name ?? 'Scene';
    const names = await this.deviceNames(homeId);
    const words = actions.map((a) => `${names.get(a.deviceId) ?? 'device'} ${a.on ? 'on' : 'off'}`);
    return words.length <= 2 ? words.join(', ') : `${words.slice(0, 2).join(', ')} +${words.length - 2}`;
  }

  private scheduleDto(s: Schedule & { createdBy: { name: string }; scene: { name: string } | null }, names: Map<string, string>) {
    const actions = (s.actions as unknown as Action[]).map((a) => ({ ...a, deviceName: names.get(a.deviceId) ?? 'Removed device' }));
    return {
      id: s.id, name: s.name, kind: s.kind, runAt: s.runAt, time: s.time, days: s.days, enabled: s.enabled,
      nextRunAt: s.nextRunAt, lastRunAt: s.lastRunAt, lastResult: s.lastResult,
      sceneId: s.sceneId, sceneName: s.scene?.name ?? null, actions, createdBy: s.createdBy.name, createdById: s.createdById,
    };
  }
}

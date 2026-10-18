import {
  BadRequestException, ForbiddenException, HttpException, Inject, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit,
} from '@nestjs/common';
import { Access, NodeStatus, Prisma, Schedule, ScheduleKind } from '@prisma/client';
import { AccessService } from '../access/access.service';
import { AuthService } from '../auth/auth.service';
import { AuthUser, isAdmin } from '../auth/auth.types';
import { AuditService } from '../common/audit.service';
import { SETTINGS, Settings } from '../config';
import { DevicesService } from '../hardware/devices.service';
import { MonitoringService } from '../monitoring/monitoring.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { PlaceService } from './place.service';
import {
  clockText, failureLine, IfMissed, lateNote, missedDecision, retryDelayMin, RunStatus, runSummary, skippedText,
} from './schedule-policy';
import { nextSun, SunEvent } from './sun';
import { nextDaily, parseHhMm } from './time';

export interface Action { deviceId: string; on: boolean }
/** What is left of a run whose board was offline or didn't answer (kept in the database, so a restart keeps it). */
interface RetryState { attempt: number; actions: Action[]; done: string[]; failed: string[]; late: string }
type DueSchedule = Schedule & { scene: { actions: Prisma.JsonValue } | null; createdBy: { id: string; disabled: boolean }; home: { timezone: string } };
export interface ScheduleInput {
  name?: string;
  /** after the server was down: run late anyway, skip, or decide by what it does (the default) */
  ifMissed?: IfMissed;
  kind: 'ONCE' | 'DAILY' | 'SUN';
  /** SUN: sunrise or sunset, and minutes after it (negative: before) */
  sunEvent?: SunEvent;
  offsetMin?: number;
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

/**
 * Timers, daily schedules and scenes. A scheduled run uses the rights of the person who created it
 * (re-checked at run time), goes through the normal command path (acknowledged by the board), and is
 * marked in history as channel "automation". A device whose board was offline or didn't answer is
 * tried again a few times; a run that is very late because the server was down may be skipped.
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
    private readonly place: PlaceService,
    @Inject(SETTINGS) private readonly settings: Settings,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.tick(), this.settings.schedulerTickMs);
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
    const waiting = await this.waitingDevices(user.homeId);
    return rows.map((s) => this.scheduleDto(s, names, waiting));
  }

  async listScenes(user: AuthUser) {
    const rows = await this.prisma.scene.findMany({ where: { homeId: user.homeId }, orderBy: { name: 'asc' }, include: { createdBy: { select: { name: true } } } });
    const names = await this.deviceNames(user.homeId);
    const waiting = await this.waitingDevices(user.homeId);
    const levels = await this.access.roomLevels(user);
    const rooms = await this.deviceRooms(user.homeId);
    // a scene is usable by someone who may control every device in it
    return rows.map((s) => {
      const actions = s.actions as unknown as Action[];
      const canRun = actions.every((a) => {
        const level = this.access.levelFor(levels, rooms.get(a.deviceId) ?? null);
        return level === Access.CONTROL || level === Access.MANAGE;
      });
      return { id: s.id, name: s.name, icon: s.icon, createdBy: s.createdBy.name, canRun, actions: this.actionsDto(actions, names, waiting) };
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
    let sunEvent: SunEvent | null = null;
    let offsetMin = 0;
    let nextRunAt: Date | null;
    if (input.kind === 'SUN') {
      if (input.sunEvent !== 'SUNRISE' && input.sunEvent !== 'SUNSET') throw new BadRequestException('Say sunrise or sunset.');
      sunEvent = input.sunEvent;
      offsetMin = Math.max(-180, Math.min(180, Math.round(input.offsetMin ?? 0)));
      days = [...new Set((input.days ?? []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
      nextRunAt = await this.nextSunFor(user.homeId, home.timezone, sunEvent, offsetMin, days, new Date());
    } else if (input.kind === 'ONCE') {
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
        homeId: user.homeId, name, kind: input.kind as ScheduleKind, runAt, time, days, sceneId, sunEvent, offsetMin,
        actions: actions as unknown as Prisma.InputJsonValue, createdById: user.id, nextRunAt, ifMissed: input.ifMissed ?? 'auto',
      },
      include: { createdBy: { select: { name: true } }, scene: { select: { name: true } } },
    });
    await this.audit.record(user.homeId, user.id, 'schedule.create', created.id, { name, kind: input.kind, channel: user.channel });
    this.realtime.schedulesChanged(user.homeId);
    return this.scheduleDto(created, await this.deviceNames(user.homeId), await this.waitingDevices(user.homeId));
  }

  /** Pause or resume it, and what to do when the server was down at its time. */
  async update(user: AuthUser, id: string, input: { enabled?: boolean; ifMissed?: IfMissed }) {
    const s = await this.own(user, id);
    const data: Prisma.ScheduleUpdateInput = {};
    if (input.ifMissed) data.ifMissed = input.ifMissed;
    if (input.enabled !== undefined) {
      const enabled = input.enabled;
      const home = await this.prisma.home.findUniqueOrThrow({ where: { id: user.homeId } });
      let nextRunAt = s.nextRunAt;
      if (enabled) {
        if (s.kind === 'DAILY') nextRunAt = nextDaily(s.time!, s.days, home.timezone, new Date());
        else if (s.kind === 'SUN') nextRunAt = await this.nextSunFor(s.homeId, home.timezone, s.sunEvent as SunEvent, s.offsetMin, s.days, new Date());
        else if (!s.runAt || s.runAt.getTime() < Date.now()) throw new BadRequestException('This timer has already run.');
      }
      // paused (or started again): a try still waiting from the last run is dropped
      Object.assign(data, { enabled, nextRunAt, ...(s.retryAt ? { retryAt: null, retryState: Prisma.DbNull } : {}) });
    }
    await this.prisma.schedule.update({ where: { id }, data });
    this.realtime.schedulesChanged(user.homeId);
  }

  setEnabled(user: AuthUser, id: string, enabled: boolean) {
    return this.update(user, id, { enabled });
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
    const r = await this.runActions(user, scene.actions as unknown as Action[]);
    await this.audit.record(user.homeId, user.id, 'scene.run', id, { name: scene.name, channel: user.channel, result: r.summary });
    // run by a person, now: no retries, they see what didn't work
    return { ok: r.ok, done: r.done, failed: [...r.failed, ...r.retry.map((x) => x.line)], summary: r.summary };
  }

  // ---------------------------------------------------------------- the clock
  /** Runs what is due: schedules at their time, and devices waiting for another try. */
  async tick(now = new Date()) {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const include = { scene: true, createdBy: true, home: true } as const;
      const due = await this.prisma.schedule.findMany({ where: { enabled: true, nextRunAt: { lte: now } }, include, orderBy: { nextRunAt: 'asc' }, take: 50 });
      for (const s of due) await this.fire(s).catch((e) => this.log.error(`Schedule "${s.name}" failed: ${(e as Error).message}`));
      const retries = await this.prisma.schedule.findMany({ where: { retryAt: { lte: now } }, include, orderBy: { retryAt: 'asc' }, take: 50 });
      for (const s of retries) await this.retry(s).catch((e) => this.log.error(`Schedule "${s.name}" retry failed: ${(e as Error).message}`));
    } catch (err) {
      this.log.error(`Scheduler tick failed: ${(err as Error).message}`);
    } finally {
      this.ticking = false;
    }
  }

  private async fire(s: DueSchedule) {
    const dueAt = s.nextRunAt!;
    const now = new Date();
    // The next time is counted from now, not from the missed one: after downtime a daily schedule runs
    // (or is skipped) once and then waits for its next time; it never catches up on every missed day.
    const next = s.kind === 'DAILY' ? nextDaily(s.time!, s.days, s.home.timezone, now)
      : s.kind === 'SUN' ? await this.nextSunFor(s.homeId, s.home.timezone, s.sunEvent as SunEvent, s.offsetMin, s.days, new Date(now.getTime() + 60_000))
        : null;
    // Claim this run before doing anything: only the API that moves nextRunAt on from the value it read
    // runs it. A second API (or a restart in the middle of a tick) finds it already moved and leaves it.
    const claimed = await this.prisma.schedule.updateMany({
      where: { id: s.id, enabled: true, nextRunAt: dueAt },
      data: { nextRunAt: next, enabled: s.kind !== 'ONCE', retryAt: null, retryState: Prisma.DbNull },
    });
    if (claimed.count === 0) return;

    const actions = (s.scene ? s.scene.actions : s.actions) as unknown as Action[];
    if (missedDecision(s, actions, now.getTime() - dueAt.getTime(), this.settings.missedCutoffMinutes) === 'skip') {
      return this.finish(s, skippedText(dueAt, s.home.timezone, now), 'skipped', false, { lastRunAt: now });
    }
    const late = lateNote(dueAt, s.home.timezone, now);
    const actor = await this.actorOf(s);
    if (typeof actor === 'string') return this.finish(s, actor, 'skipped', !s.createdBy.disabled, { lastRunAt: now });
    const result = await this.runActions(actor, actions);
    await this.afterRun(s, 1, result, [], [], late, now);
  }

  /** Another try for the devices whose board was offline or didn't answer. */
  private async retry(s: DueSchedule) {
    const state = s.retryState as unknown as RetryState | null;
    const at = s.retryAt!;
    // the same claim as a run: move the try on (a lease, in case this API stops in the middle of it)
    const claimed = await this.prisma.schedule.updateMany({ where: { id: s.id, retryAt: at }, data: { retryAt: new Date(Date.now() + 5 * 60_000) } });
    if (claimed.count === 0) return;
    if (!state?.actions?.length) {
      await this.prisma.schedule.update({ where: { id: s.id }, data: { retryAt: null, retryState: Prisma.DbNull } });
      return;
    }
    const actor = await this.actorOf(s);
    if (typeof actor === 'string') return this.finish(s, actor, 'skipped', !s.createdBy.disabled, { retryAt: null, retryState: Prisma.DbNull });
    const result = await this.runActions(actor, state.actions);
    await this.afterRun(s, state.attempt + 1, result, state.done, state.failed, state.late, new Date());
  }

  /** The person the schedule runs as, or why it can't run. */
  private async actorOf(s: DueSchedule): Promise<AuthUser | string> {
    if (s.createdBy.disabled) return 'Skipped: its creator’s account is disabled.';
    const actor = await this.auth.actorFor(s.createdById, s.homeId, 'automation');
    if (!actor || actor.readOnly) return 'Skipped: its creator no longer has access to this home.';
    return actor;
  }

  /**
   * After a run or a try: devices that failed because their board was offline or didn't answer get
   * another try later (only those); when there are no tries left the run is recorded as failed and its
   * creator is told, once.
   */
  private async afterRun(s: DueSchedule, attempt: number, r: RunResult, doneBefore: string[], failedBefore: string[], late: string, now: Date) {
    const done = [...doneBefore, ...r.done];
    const failed = [...failedBefore, ...r.failed];
    const delay = r.retry.length ? retryDelayMin(attempt, this.settings.scheduleRetryMinutes) : null;
    if (delay !== null) {
      const retryAt = new Date(now.getTime() + delay * 60_000);
      const state: RetryState = { attempt, actions: r.retry.map((x) => x.action), done, failed, late };
      const waiting = r.retry.map((x) => x.line.replace(/\.$/, '')).join('; ');
      const summary = `${late}${done.length ? `Done: ${done.join(', ')}. ` : ''}${failed.length ? `Failed: ${failed.join('; ')} ` : ''}`
        + `Not yet: ${waiting}. Trying again at ${clockText(retryAt, s.home.timezone, now)}.`;
      this.log.log(`Schedule "${s.name}": ${summary}`);
      await this.prisma.schedule.update({
        where: { id: s.id },
        data: { lastResult: summary, lastStatus: 'retrying', retryAt, retryState: state as unknown as Prisma.InputJsonValue, ...(attempt === 1 ? { lastRunAt: now } : {}) },
      });
      this.realtime.schedulesChanged(s.homeId);
      return;
    }
    const finalFailed = [...failed, ...r.retry.map((x) => x.line)];
    const tries = attempt > 1 && r.retry.length ? ` (tried ${attempt} times)` : '';
    const summary = `${late}${runSummary(done, finalFailed)}${tries}`;
    const ok = finalFailed.length === 0;
    await this.finish(s, summary, ok ? 'ok' : 'failed', !ok, { retryAt: null, retryState: Prisma.DbNull, ...(attempt === 1 ? { lastRunAt: now } : {}) });
  }

  private async finish(s: DueSchedule, summary: string, status: RunStatus, tell: boolean, data: Prisma.ScheduleUpdateInput) {
    this.log.log(`Schedule "${s.name}": ${summary}`);
    await this.prisma.schedule.update({ where: { id: s.id }, data: { ...data, lastResult: summary, lastStatus: status } });
    if (tell) await this.monitoring.scheduleFailed(s, summary).catch(() => undefined);
    this.realtime.scheduleRan(s.homeId, { id: s.id, name: s.name, result: summary, createdById: s.createdById });
    this.realtime.schedulesChanged(s.homeId);
  }

  private async runActions(actor: AuthUser, actions: Action[]): Promise<RunResult> {
    const names = await this.deviceNames(actor.homeId);
    const done: string[] = [];
    const failed: string[] = [];
    const retry: RunResult['retry'] = [];
    for (const a of actions) {
      const label = names.get(a.deviceId) ?? 'a removed device';
      try {
        await this.devices.command(actor, a.deviceId, { on: a.on });
        done.push(`${label} ${a.on ? 'on' : 'off'}`);
      } catch (err) {
        const line = failureLine(label, (err as Error).message);
        // worth another try: the board is offline (503) or didn't answer in time (504)
        const status = err instanceof HttpException ? err.getStatus() : 0;
        if (status === 503 || status === 504) retry.push({ action: a, line });
        else failed.push(line);
      }
    }
    const all = [...failed, ...retry.map((x) => x.line)];
    return { ok: all.length === 0, done, failed, retry, summary: runSummary(done, all) };
  }

  // ---------------------------------------------------------------- helpers
  /** The home moved (its location was set): sunrise and sunset timers get new times. */
  async resyncSun(homeId: string) {
    const home = await this.prisma.home.findUniqueOrThrow({ where: { id: homeId }, select: { timezone: true } });
    const rows = await this.prisma.schedule.findMany({ where: { homeId, kind: 'SUN', enabled: true } });
    for (const s of rows) {
      const nextRunAt = await this.nextSunFor(homeId, home.timezone, s.sunEvent as SunEvent, s.offsetMin, s.days, new Date());
      await this.prisma.schedule.update({ where: { id: s.id }, data: { nextRunAt } });
    }
    if (rows.length) this.realtime.schedulesChanged(homeId);
  }

  private async nextSunFor(homeId: string, timeZone: string, event: SunEvent, offsetMin: number, days: number[], after: Date) {
    const p = await this.place.of(homeId);
    return nextSun(event, offsetMin, days, timeZone, p.lat, p.lon, after);
  }

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

  /** Devices of this home whose board is out of service, waiting for a replacement. */
  private async waitingDevices(homeId: string) {
    const rows = await this.prisma.device.findMany({ where: { node: { homeId, status: NodeStatus.FAULTY } }, select: { id: true } });
    return new Set(rows.map((r) => r.id));
  }

  /** Each action with its device's name; "Lamp: waiting for a replacement board" while its board is out. */
  private actionsDto(actions: Action[], names: Map<string, string>, waiting = new Set<string>()) {
    return actions.map((a) => ({
      ...a, deviceName: names.get(a.deviceId) ?? 'Removed device', waiting: waiting.has(a.deviceId),
      ...(waiting.has(a.deviceId) ? { problem: `${names.get(a.deviceId)}: waiting for a replacement board` } : {}),
    }));
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

  private scheduleDto(s: Schedule & { createdBy: { name: string }; scene: { name: string } | null }, names: Map<string, string>, waiting: Set<string>) {
    const actions = this.actionsDto(s.actions as unknown as Action[], names, waiting);
    return {
      id: s.id, name: s.name, kind: s.kind, runAt: s.runAt, time: s.time, days: s.days, enabled: s.enabled, sunEvent: s.sunEvent, offsetMin: s.offsetMin,
      nextRunAt: s.nextRunAt, lastRunAt: s.lastRunAt, lastResult: s.lastResult, lastStatus: s.lastStatus as RunStatus | null,
      retryAt: s.retryAt, ifMissed: s.ifMissed as IfMissed,
      // what can't run now: "Lamp: waiting for a replacement board"
      problems: actions.flatMap((a) => (a.problem ? [a.problem] : [])),
      sceneId: s.sceneId, sceneName: s.scene?.name ?? null, actions, createdBy: s.createdBy.name, createdById: s.createdById,
    };
  }
}

interface RunResult {
  ok: boolean;
  done: string[];
  /** failed for good (no rights, a sensor, disabled, refused by the board) */
  failed: string[];
  /** the board was offline or didn't answer: worth another try */
  retry: { action: Action; line: string }[];
  summary: string;
}

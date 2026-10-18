import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthService } from '../auth/auth.service';
import { MonitoringService } from '../monitoring/monitoring.service';
import { PrismaService } from '../prisma/prisma.service';
import { DevicesService } from './devices.service';

interface TankSettings {
  motorDeviceId?: string;
  fillBelowPct?: number;
  stopAtPct?: number;
  dryRunMin?: number;
  maxRunMin?: number;
}
interface TankState { level?: number; cm?: number; alarm?: string }

/** A run of the motor watched by the server (when the motor is on another board than the tank). */
interface Run { since: number; startLevel: number | null }

const MINUTE = 60_000;
/** don't start the motor again within this long of the last automatic start (a sensor bouncing around the line) */
const RESTART_GAP_MS = 10 * MINUTE;

export type TankDecision =
  | { action: 'none' }
  | { action: 'start' }
  | { action: 'stop'; alarm: '' | 'dry' | 'long' | 'sensor'; why: string };

/**
 * What to do with the motor, given the tank's level and how long the motor has been running.
 * `boardWatches`: the motor is on the tank's board, which stops it by itself (full, dry, too long), so
 * the server only starts it. Pure, for tests.
 */
export function decideTank(input: {
  settings: TankSettings; level: number | null; alarm: string; motorOn: boolean; boardWatches: boolean;
  run: Run | null; blocked: boolean; now: number; lastStart: number;
}): TankDecision {
  const s = input.settings;
  const stopAt = s.stopAtPct ?? 95;
  if (input.motorOn) {
    if (input.boardWatches || !input.run) return { action: 'none' };
    const minutes = (input.now - input.run.since) / MINUTE;
    if (input.level !== null && input.level >= stopAt) return { action: 'stop', alarm: '', why: 'the tank is full' };
    if (minutes >= (s.dryRunMin ?? 10)) {
      if (input.level === null || input.run.startLevel === null) return { action: 'stop', alarm: 'sensor', why: "the tank sensor isn't giving readings" };
      if (input.level < input.run.startLevel + 2) return { action: 'stop', alarm: 'dry', why: "the water level isn't rising" };
    }
    if (minutes >= (s.maxRunMin ?? 60)) return { action: 'stop', alarm: 'long', why: 'it ran for too long' };
    return { action: 'none' };
  }
  const fillBelow = s.fillBelowPct ?? 0;
  if (fillBelow > 0 && input.level !== null && input.level < fillBelow && !input.alarm && !input.blocked
      && input.now - input.lastStart >= RESTART_GAP_MS) {
    return { action: 'start' };
  }
  return { action: 'none' };
}

const ALARM_TEXT: Record<string, string> = {
  dry: "the water level wasn't rising. Check the main line or the well, and the valve.",
  long: 'it ran for longer than it should. Check for a leak or an overflow.',
  sensor: "the tank sensor stopped giving readings. Check its wiring, or wipe it if water or foam is on it.",
};

/**
 * Water tanks (JSN-SR04T level sensor) and their motor: fills the tank when it is low (if the owner set
 * a level), stops the motor when it is full or something is wrong, and tells people. When the motor is
 * on the tank's own board, the board does the stopping (it works without internet) and reports an
 * alarm in the tank's state; the server only starts the motor and tells people.
 */
@Injectable()
export class TankService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Tanks');
  private readonly runs = new Map<string, Run>();         // by tank id, server-watched runs
  private readonly lastStart = new Map<string, number>(); // by tank id
  /** tanks whose motor the server stopped with an alarm: no automatic start until a person runs the motor */
  private readonly blocked = new Set<string>();
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly devices: DevicesService,
    private readonly monitoring: MonitoringService,
    private readonly auth: AuthService,
  ) {}

  onModuleInit() {
    this.devices.onStateChange((device, before, now) => {
      if (device.type === 'tank') return this.onTank(device.id, before as TankState | null, now as TankState);
      if (DEVICES_WITH_ON.has(device.type)) return this.onMotor(device.id, before, now);
      return undefined;
    });
    // runs are watched once a minute too, so a sensor that stops reporting can't leave the motor running
    this.timer = setInterval(() => void this.tick().catch((e) => this.log.warn(`tick failed: ${e}`)), MINUTE);
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  private async tanksWithMotor(motorId: string) {
    const tanks = await this.prisma.device.findMany({ where: { type: 'tank', enabled: true }, select: { id: true, settings: true } });
    return tanks.filter((t) => (t.settings as TankSettings).motorDeviceId === motorId).map((t) => t.id);
  }

  /** The motor changed: start or end a watched run; a person starting it clears an alarm's block. */
  private async onMotor(motorId: string, before: Record<string, unknown> | null, now: Record<string, unknown>) {
    if (now.on === before?.on) return;
    for (const tankId of await this.tanksWithMotor(motorId)) {
      if (now.on === true) {
        const tank = await this.prisma.device.findUnique({ where: { id: tankId }, include: { state: true } });
        const level = (tank?.state?.state as TankState | undefined)?.level;
        this.runs.set(tankId, { since: Date.now(), startLevel: typeof level === 'number' ? level : null });
        const last = await this.prisma.stateEvent.findFirst({ where: { deviceId: motorId }, orderBy: { at: 'desc' }, select: { channel: true, source: true } });
        if (last && last.channel !== 'automation' && last.source !== 'automation') this.blocked.delete(tankId);
      } else {
        this.runs.delete(tankId);
      }
    }
  }

  private async onTank(tankId: string, before: TankState | null, now: TankState) {
    const tank = await this.prisma.device.findUnique({ where: { id: tankId }, include: { node: true } });
    if (!tank?.node.homeId) return;
    const homeId = tank.node.homeId;
    const settings = (tank.settings ?? {}) as TankSettings;
    const link = `/devices/${tank.id}?home=${homeId}`;

    // the board stopped the motor by itself with an alarm
    if (now.alarm && now.alarm !== before?.alarm) {
      await this.alarm(homeId, tank.roomId, tank.id, tank.name, now.alarm, link);
    }
    // full / low, for people who want to know (off by default)
    const level = typeof now.level === 'number' ? now.level : null;
    const prev = typeof before?.level === 'number' ? before.level : null;
    if (level !== null && prev !== null) {
      const stopAt = settings.stopAtPct ?? 95;
      if (level >= stopAt && prev < stopAt) {
        await this.monitoring.notifyRoom(homeId, tank.roomId, { kind: 'tankLevel', severity: 'INFO', title: `${tank.name} is full`, body: `The water is at ${level}%.`, link }, `tankfull:${tank.id}`, 30 * MINUTE);
      } else if (level <= 20 && prev > 20) {
        await this.monitoring.notifyRoom(homeId, tank.roomId, { kind: 'tankLevel', severity: 'WARN', title: `${tank.name} is running low`, body: `The water is down to ${level}%.`, link }, `tanklow:${tank.id}`, 2 * 60 * MINUTE);
      }
    }
    await this.check(tank.id);
  }

  private async tick() {
    for (const tankId of this.runs.keys()) await this.check(tankId);
  }

  /** Decides and acts for one tank. */
  private async check(tankId: string) {
    const tank = await this.prisma.device.findUnique({ where: { id: tankId }, include: { node: true, state: true } });
    if (!tank?.node.homeId || !tank.enabled) return;
    const settings = (tank.settings ?? {}) as TankSettings;
    if (!settings.motorDeviceId) return;
    const motor = await this.prisma.device.findUnique({ where: { id: settings.motorDeviceId }, include: { node: true, state: true } });
    if (!motor || !motor.enabled || motor.node.homeId !== tank.node.homeId) return;
    const state = (tank.state?.state ?? {}) as TankState;
    const motorOn = (motor.state?.state as { on?: boolean } | null)?.on === true;
    // a run the server didn't see start (after a restart): watch it from now
    if (motorOn && !this.runs.has(tankId)) this.runs.set(tankId, { since: Date.now(), startLevel: typeof state.level === 'number' ? state.level : null });

    const decision = decideTank({
      settings, level: typeof state.level === 'number' ? state.level : null, alarm: state.alarm ?? '', motorOn,
      boardWatches: motor.nodeId === tank.nodeId, run: this.runs.get(tankId) ?? null, blocked: this.blocked.has(tankId),
      now: Date.now(), lastStart: this.lastStart.get(tankId) ?? 0,
    });
    if (decision.action === 'none') return;
    if (!motor.node.online) return;
    const homeId = tank.node.homeId;
    const owner = await this.prisma.membership.findFirst({ where: { homeId, role: Role.OWNER }, select: { userId: true } });
    const actor = owner ? await this.auth.actorFor(owner.userId, homeId, 'automation') : null;
    if (!actor) return;
    try {
      if (decision.action === 'start') {
        this.lastStart.set(tankId, Date.now());
        await this.devices.command(actor, motor.id, { on: true });
        this.log.log(`${tank.name} at ${state.level}%: ${motor.name} on`);
      } else {
        await this.devices.command(actor, motor.id, { on: false });
        this.runs.delete(tankId);
        this.log.log(`${tank.name}: ${motor.name} off (${decision.why})`);
        if (decision.alarm) {
          this.blocked.add(tankId);
          await this.alarm(homeId, tank.roomId, tank.id, tank.name, decision.alarm, `/devices/${tank.id}?home=${homeId}`, motor.name);
        }
      }
    } catch (err) {
      this.log.warn(`${tank.name}: could not switch ${motor.name}: ${(err as Error).message}`);
    }
  }

  private async alarm(homeId: string, roomId: string | null, tankId: string, tankName: string, alarm: string, link: string, motorName = 'the motor') {
    const why = ALARM_TEXT[alarm];
    if (!why) return;
    await this.monitoring.notifyRoom(homeId, roomId, {
      kind: 'tank', severity: alarm === 'dry' ? 'ALERT' : 'WARN',
      title: `${tankName}: water motor stopped`,
      body: `${motorName[0]!.toUpperCase()}${motorName.slice(1)} was switched off because ${why} It won't start by itself until someone switches it on.`, link,
    }, `tankalarm:${tankId}:${alarm}`, 30 * MINUTE);
  }
}

const DEVICES_WITH_ON = new Set(['switch', 'fan']);

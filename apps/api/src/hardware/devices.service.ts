import {
  BadRequestException, ConflictException, ForbiddenException, GatewayTimeoutException, Inject, Injectable, Logger, NotFoundException,
  OnModuleInit, ServiceUnavailableException, UnprocessableEntityException,
} from '@nestjs/common';
import {
  DEVICE_TYPES, deviceStatePayload, pinLabel, stateFields, switchCommand, topics,
} from '@home/contracts';
import { Access, CommandStatus, Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { AccessService } from '../access/access.service';
import { AuthUser, canSetup, isAdmin } from '../auth/auth.types';
import { AuditService } from '../common/audit.service';
import { MonitoringService } from '../monitoring/monitoring.service';
import { slugKey } from '../common/zod';
import { SETTINGS, Settings } from '../config';
import { MqttService } from '../mqtt/mqtt.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { LogsService } from './logs.service';
import { LocalService } from './local.service';
import { NodesService } from './nodes.service';

export interface DeviceInput {
  name: string;
  type: string;
  pin: number;
  key?: string;
  activeLow?: boolean;
  roomId?: string | null;
  aliases?: string[];
  settings?: unknown;
}

export interface DeviceUpdate {
  name?: string;
  roomId?: string | null;
  aliases?: string[];
  pin?: number;
  activeLow?: boolean;
  settings?: unknown;
  enabled?: boolean;
  /** only the owner and admins can switch it */
  childLock?: boolean;
  /** it switches itself off this long after going on (null = never) */
  autoOffMinutes?: number | null;
  /** power when on, for electricity estimates (null: guessed from its name) */
  watts?: number | null;
}

export type StateListener = (
  device: { id: string; name: string; type: string; roomId: string | null; settings: unknown; autoOffMinutes: number | null; node: { homeId: string | null; online: boolean } },
  before: Record<string, unknown> | null, now: Record<string, unknown>,
) => unknown;

interface Pending {
  resolve: (state: Record<string, unknown>) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

const deviceInclude = { node: true, room: true, state: true } as const;
type DeviceRow = Prisma.DeviceGetPayload<{ include: typeof deviceInclude }>;

/**
 * Devices: their configuration (validated against board pin rules and type settings),
 * commands with acknowledgement, and state coming back from the boards.
 */
@Injectable()
export class DevicesService implements OnModuleInit {
  private readonly log = new Logger('Devices');
  private readonly pending = new Map<string, Pending>();
  private readonly listeners: StateListener[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly mqtt: MqttService,
    private readonly nodes: NodesService,
    private readonly access: AccessService,
    private readonly realtime: RealtimeService,
    private readonly audit: AuditService,
    @Inject(SETTINGS) private readonly settings: Settings,
    private readonly logs: LogsService,
    private readonly monitoring: MonitoringService,
    private readonly local: LocalService,
  ) {}

  onModuleInit() {
    this.mqtt.on('deviceState', (t, p) => (t.kind === 'deviceState' ? this.onState(t.nodeId, t.key, p) : undefined));
  }

  /** Rules and safety timers listen here (they depend on this service, so they can't be injected into it). */
  onStateChange(fn: StateListener) {
    this.listeners.push(fn);
  }

  // ---------------------------------------------------------------- reading
  private toDto(d: DeviceRow, level: Access) {
    const def = DEVICE_TYPES[d.type];
    return {
      id: d.id, key: d.key, name: d.name, aliases: d.aliases, type: d.type,
      typeLabel: def?.label ?? d.type, controllable: def?.controllable ?? false,
      stateFields: def?.stateFields ?? [],
      // a board marked faulty is out of service: its devices are kept, waiting for a replacement board
      nodeId: d.nodeId, nodeName: d.node.name, online: d.node.online && d.node.status !== 'FAULTY', waiting: d.node.status === 'FAULTY',
      roomId: d.roomId, roomName: d.room?.name ?? null,
      pin: d.pin, pinLabel: pinLabel(d.node.board, d.pin), activeLow: d.activeLow, settings: d.settings, enabled: d.enabled,
      childLock: d.childLock, autoOffMinutes: d.autoOffMinutes, autoOffAt: d.autoOffAt, watts: d.watts,
      state: (d.state?.state as Record<string, unknown> | undefined) ?? null,
      source: d.state?.source ?? null, updatedAt: d.state?.updatedAt ?? null,
      access: level,
    };
  }

  async list(user: AuthUser) {
    const levels = await this.access.roomLevels(user);
    const devices = await this.prisma.device.findMany({
      where: { node: { homeId: user.homeId, status: { in: ['ADOPTED', 'FAULTY'] } } },
      include: deviceInclude,
      orderBy: [{ room: { order: 'asc' } }, { name: 'asc' }],
    });
    return devices.flatMap((d) => {
      const level = this.access.levelFor(levels, d.roomId);
      return level ? [this.toDto(d, level)] : [];
    });
  }

  private async load(user: AuthUser, id: string, needed: Access) {
    const device = await this.prisma.device.findFirst({ where: { id, node: { homeId: user.homeId } }, include: deviceInclude });
    if (!device) throw new NotFoundException('Not found.');
    const level = await this.access.require(user, device.roomId, needed);
    return { device, level };
  }

  async get(user: AuthUser, id: string) {
    const { device, level } = await this.load(user, id, Access.VIEW);
    return this.toDto(device, level);
  }

  async history(user: AuthUser, id: string, limit: number) {
    await this.load(user, id, Access.VIEW);
    const events = await this.prisma.stateEvent.findMany({
      where: { deviceId: id }, orderBy: { at: 'desc' }, take: Math.min(Math.max(limit, 1), 1000),
    });
    const names = await this.userNames(events.map((e) => e.userId));
    return events.map((e) => ({
      state: e.state, source: e.source, at: e.at, via: eventVia(e.source, e.channel), by: e.userId ? names.get(e.userId) ?? null : null,
    }));
  }

  /**
   * What happened to the devices this person can see, newest first: who switched what, and how
   * (app, voice, wall switch, schedule). Switches and contact sensors only — temperature readings
   * would drown everything else. `before` pages back through older events.
   */
  async events(user: AuthUser, opts: { limit: number; deviceId?: string; roomId?: string; before?: Date }) {
    const levels = await this.access.roomLevels(user);
    const devices = await this.prisma.device.findMany({
      where: {
        node: { homeId: user.homeId, status: { in: ['ADOPTED', 'FAULTY'] } },
        ...(opts.deviceId ? { id: opts.deviceId } : {}), ...(opts.roomId ? { roomId: opts.roomId } : {}),
      },
      include: { room: true },
    });
    const visible = devices.filter((d) => (DEVICE_TYPES[d.type]?.controllable || d.type === 'contact') && this.access.levelFor(levels, d.roomId));
    if (!visible.length) return [];
    const byId = new Map(visible.map((d) => [d.id, d]));
    const events = await this.prisma.stateEvent.findMany({
      where: { deviceId: { in: [...byId.keys()] }, ...(opts.before ? { at: { lt: opts.before } } : {}) },
      orderBy: { at: 'desc' }, take: Math.min(Math.max(opts.limit, 1), 200),
    });
    const names = await this.userNames(events.map((e) => e.userId));
    return events.map((e) => {
      const d = byId.get(e.deviceId)!;
      return {
        id: e.id.toString(), at: e.at, deviceId: d.id, deviceName: d.name, deviceType: d.type,
        roomId: d.roomId, roomName: d.room?.name ?? null, state: e.state,
        via: eventVia(e.source, e.channel), by: e.userId ? names.get(e.userId) ?? null : null,
      };
    });
  }

  private async userNames(ids: (string | null)[]) {
    const unique = [...new Set(ids.filter((x): x is string => !!x))];
    if (!unique.length) return new Map<string, string>();
    const users = await this.prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
    return new Map(users.map((u) => [u.id, u.name]));
  }

  // ---------------------------------------------------------------- configuration (admins)
  private settingsFor(type: string, settings: unknown) {
    const def = DEVICE_TYPES[type];
    if (!def) throw new BadRequestException(`Unknown device type "${type}". Known: ${Object.keys(DEVICE_TYPES).join(', ')}.`);
    const parsed = def.settings.safeParse(settings ?? {});
    if (!parsed.success) throw new BadRequestException(`Settings: ${parsed.error.issues[0].message}`);
    return { def, settings: parsed.data as Prisma.InputJsonValue };
  }

  private async assertRoom(homeId: string, roomId: string | null | undefined) {
    if (!roomId) return;
    if (!(await this.prisma.room.findFirst({ where: { id: roomId, homeId } }))) throw new BadRequestException('Unknown room.');
  }

  async create(actor: AuthUser, nodeId: string, input: DeviceInput) {
    const node = await this.prisma.node.findFirst({ where: { id: nodeId, homeId: actor.homeId } });
    if (!node) throw new NotFoundException('No such board.');
    if (node.status !== 'ADOPTED') throw new BadRequestException('Adopt the board before adding devices to it.');
    const { def, settings } = this.settingsFor(input.type, input.settings);
    await this.nodes.assertPinUsable(nodeId, node.board, input.pin, def.pinUse);
    await this.assertRoom(actor.homeId, input.roomId);

    let key = slugKey(input.key || input.name);
    for (let n = 2; await this.prisma.device.findUnique({ where: { nodeId_key: { nodeId, key } } }); n++) {
      if (input.key) throw new ConflictException(`This board already has a device with key "${key}".`);
      key = `${slugKey(input.name)}_${n}`;
    }
    const device = await this.prisma.device.create({
      data: {
        nodeId, key, name: input.name, type: def.type, pin: input.pin, settings,
        activeLow: def.hasActiveLow ? input.activeLow ?? false : false,
        roomId: input.roomId ?? null, aliases: input.aliases ?? [],
      },
    });
    await this.nodes.bumpConfig(nodeId);
    await this.audit.record(actor.homeId, actor.id, 'device.create', device.id, { nodeId, key, name: input.name, type: def.type, pin: input.pin, pinLabel: pinLabel(node.board, input.pin) });
    this.realtime.devicesChanged(actor.homeId);
    this.realtime.nodesChanged(actor.homeId, nodeId);
    return this.get(actor, device.id);
  }

  /** Name, room and aliases need MANAGE in the room; wiring (pin, polarity, settings) needs an admin. */
  async update(actor: AuthUser, id: string, input: DeviceUpdate) {
    const { device } = await this.load(actor, id, Access.MANAGE);
    if (input.roomId !== undefined && input.roomId !== device.roomId) {
      await this.assertRoom(actor.homeId, input.roomId);
      await this.access.require(actor, input.roomId, Access.MANAGE);
    }
    const wiring = input.pin !== undefined || input.activeLow !== undefined || input.settings !== undefined || input.enabled !== undefined;
    if (wiring && !canSetup(actor)) {
      throw new ForbiddenException('Pins and wiring are managed by the installer.');
    }
    const safety = input.childLock !== undefined || input.autoOffMinutes !== undefined;
    if (safety && !isAdmin(actor.role)) throw new ForbiddenException('Only the owner or an admin can change child lock and auto-off.');
    if (safety && DEVICE_TYPES[device.type]?.controllable !== true) throw new BadRequestException(`${device.name} is a sensor; child lock and auto-off are for switches.`);
    const data: Prisma.DeviceUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.aliases !== undefined) data.aliases = input.aliases;
    if (input.roomId !== undefined) data.room = input.roomId ? { connect: { id: input.roomId } } : { disconnect: true };
    if (input.enabled !== undefined) data.enabled = input.enabled;
    if (input.childLock !== undefined) data.childLock = input.childLock;
    if (input.watts !== undefined) data.watts = input.watts || null;
    if (input.autoOffMinutes !== undefined) {
      const m = input.autoOffMinutes ? Math.max(1, Math.min(24 * 60, Math.round(input.autoOffMinutes))) : null;
      data.autoOffMinutes = m;
      if (!m) data.autoOffAt = null;
      else if ((device.state?.state as { on?: boolean } | null)?.on === true) data.autoOffAt = new Date(Date.now() + m * 60_000);
    }
    if (input.activeLow !== undefined) data.activeLow = DEVICE_TYPES[device.type]?.hasActiveLow ? input.activeLow : false;
    if (input.settings !== undefined) data.settings = this.settingsFor(device.type, input.settings).settings;
    if (input.pin !== undefined && input.pin !== device.pin) {
      await this.nodes.assertPinUsable(device.nodeId, device.node.board, input.pin, DEVICE_TYPES[device.type].pinUse, { deviceId: id });
      data.pin = input.pin;
    }
    await this.prisma.device.update({ where: { id }, data });
    if (wiring) await this.nodes.bumpConfig(device.nodeId);
    // fewer people may switch it now: retire the phones' passes for switching over Wi-Fi
    if ((input.roomId !== undefined && input.roomId !== device.roomId) || (input.childLock === true && !device.childLock)) {
      await this.local.revoke(actor.homeId);
    }
    const renamed = input.name !== undefined && input.name !== device.name;
    await this.audit.record(actor.homeId, actor.id, wiring || !renamed ? 'device.update' : 'device.rename', id,
      renamed ? { ...input, from: device.name, to: input.name, board: device.nodeId } : { ...input, name: device.name, board: device.nodeId });
    this.realtime.devicesChanged(actor.homeId);
    this.realtime.nodesChanged(actor.homeId, device.nodeId);
    return this.get(actor, id);
  }

  async remove(actor: AuthUser, id: string) {
    const { device } = await this.load(actor, id, Access.MANAGE);
    if (!canSetup(actor)) throw new ForbiddenException('Devices are added and removed by the installer.');
    await this.prisma.device.delete({ where: { id } });
    await this.mqtt.publish(topics.deviceState(device.nodeId, device.key), null, { qos: 1, retain: true }); // clear retained state
    await this.nodes.bumpConfig(device.nodeId);
    await this.audit.record(actor.homeId, actor.id, 'device.remove', id, { key: device.key, name: device.name, nodeId: device.nodeId });
    this.realtime.devicesChanged(actor.homeId);
    this.realtime.nodesChanged(actor.homeId, device.nodeId);
  }

  // ---------------------------------------------------------------- commands
  /** Sends a command and waits for the board to confirm it (or says why not). */
  async command(user: AuthUser, id: string, body: unknown) {
    const { device, level } = await this.load(user, id, Access.CONTROL);
    const def = DEVICE_TYPES[device.type];
    if (!def?.controllable) throw new BadRequestException(`${device.name} is a sensor; it cannot be switched.`);
    const parsed = switchCommand.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Send {"on": true}, {"on": false} or {"toggle": true}.');
    if (!device.enabled) throw new BadRequestException(`${device.name} is disabled.`);
    if (device.node.status === 'FAULTY') throw new ConflictException(`${device.name}: waiting for a replacement board.`);
    if (device.childLock && !isAdmin(user.role) && user.channel !== 'automation') {
      throw new ForbiddenException(`${device.name} has child lock on: only the owner or an admin can switch it.`);
    }
    if (!device.node.online) throw new ServiceUnavailableException(`${device.name} is offline: its board is not connected.`);

    const cid = `c_${randomBytes(6).toString('hex')}`;
    await this.prisma.command.create({
      data: { id: cid, deviceId: id, payload: parsed.data, userId: user.id, channel: user.channel },
    });
    const ack = new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(cid);
        reject(new GatewayTimeoutException(`${device.name} did not respond. Check that its board is powered and online.`));
      }, this.settings.commandTimeoutMs);
      this.pending.set(cid, { resolve, reject, timer });
    });
    await this.mqtt.publish(topics.deviceSet(device.nodeId, device.key), { cid, ...parsed.data }, { qos: 1, retain: false });
    this.logs.server(device.nodeId, 'info', `${device.name} <- ${JSON.stringify(parsed.data)} from ${user.name} (${user.channel})`);

    try {
      const state = await ack;
      await this.prisma.command.update({ where: { id: cid }, data: { status: CommandStatus.ACKED, ackedAt: new Date() } });
      this.log.log(`${device.name} -> ${JSON.stringify(state)} (${user.name}, ${user.channel})`);
      this.logs.server(device.nodeId, 'info', `${device.name} confirmed ${JSON.stringify(state)}`);
      return { ...this.toDto(await this.prisma.device.findUniqueOrThrow({ where: { id }, include: deviceInclude }), level) };
    } catch (err) {
      const timedOut = err instanceof GatewayTimeoutException;
      this.logs.server(device.nodeId, 'error', `${device.name}: ${(err as Error).message}`);
      await this.prisma.command.update({
        where: { id: cid },
        data: { status: timedOut ? CommandStatus.TIMEOUT : CommandStatus.FAILED, error: (err as Error).message },
      });
      throw err;
    }
  }

  // ---------------------------------------------------------------- state from the boards
  private async onState(nodeId: string, key: string, payload: Record<string, unknown> | null) {
    if (!payload) return;
    const parsed = deviceStatePayload.safeParse(payload);
    if (!parsed.success) return;
    const { cid, src, error } = parsed.data;
    const pending = cid ? this.pending.get(cid) : undefined;
    if (pending && error) {
      clearTimeout(pending.timer);
      this.pending.delete(cid!);
      pending.reject(new UnprocessableEntityException(`The board refused: ${error}`));
      return;
    }

    const device = await this.prisma.device.findUnique({
      where: { nodeId_key: { nodeId, key } }, include: { node: true, state: true },
    });
    if (!device) return;
    const homeId = device.node.homeId;
    if (!homeId) return; // a board taken out of its home
    if (device.node.status === 'FAULTY') return; // out of service: its devices keep their last state until it is replaced
    const fields = stateFields(payload);
    // a change the server asked for: remember who asked, and how (app, voice, automation)
    const cmd = cid ? await this.prisma.command.findUnique({ where: { id: cid }, select: { userId: true, channel: true } }) : null;
    const by = cmd?.userId ? await this.prisma.user.findUnique({ where: { id: cmd.userId }, select: { name: true } }) : null;
    const via = eventVia(src, cmd?.channel ?? null);
    if (Object.keys(fields).length > 0) {
      const changed = JSON.stringify(device.state?.state ?? null) !== JSON.stringify(fields);
      const saved = await this.prisma.deviceState.upsert({
        where: { deviceId: device.id },
        create: { deviceId: device.id, state: fields as Prisma.InputJsonValue, source: src },
        update: { state: fields as Prisma.InputJsonValue, source: src },
      });
      if (changed || DEVICE_TYPES[device.type]?.controllable === false) {
        await this.prisma.stateEvent.create({
          data: { deviceId: device.id, state: fields as Prisma.InputJsonValue, source: src, userId: cmd?.userId ?? null, channel: cmd?.channel ?? null },
        });
      }
      this.realtime.deviceState(homeId, device.roomId, {
        id: device.id, state: fields, source: src, updatedAt: saved.updatedAt, via, by: by?.name ?? null,
      });
      void this.monitoring.deviceState({ ...device, node: { homeId } }, (device.state?.state ?? null) as Record<string, unknown> | null, fields)
        .catch((e) => this.log.warn(`notice failed: ${e}`));
      const before = (device.state?.state ?? null) as Record<string, unknown> | null;
      for (const fn of this.listeners) {
        void Promise.resolve().then(() => fn({ ...device, node: { homeId, online: device.node.online } }, before, fields))
          .catch((e) => this.log.warn(`state listener failed: ${e}`));
      }
    }
    if (pending) {
      clearTimeout(pending.timer);
      this.pending.delete(cid!);
      pending.resolve(fields);
    }
  }
}

/** How a change happened, in the words the apps show: app, voice, schedule, wall (switch), board (power-up) or sensor. */
export type EventVia = 'app' | 'voice' | 'schedule' | 'wall' | 'board' | 'sensor';
export function eventVia(source: string, channel: string | null): EventVia {
  if (source === 'button') return 'wall';
  if (source === 'boot') return 'board';
  if (source === 'sensor') return 'sensor';
  if (source === 'automation' || channel === 'automation') return 'schedule';
  if (channel === 'voice') return 'voice';
  return 'app';
}

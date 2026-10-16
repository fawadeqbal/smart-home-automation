import { BadRequestException, forwardRef, Inject, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import {
  announcePayload, BOARDS, checkPin, configAppliedPayload, INPUT_TYPES, NodeConfigPayload, nodeStatusPayload,
  PinUse, telemetryPayload, networkPayload, NetworkPayload, topics, DEVICE_TYPES, isSafeId,
} from '@home/contracts';
import { NodeStatus, Prisma } from '@prisma/client';
import { AuthUser } from '../auth/auth.types';
import { AuditService } from '../common/audit.service';
import { FirmwareService } from '../firmware/firmware.service';
import { MonitoringService } from '../monitoring/monitoring.service';
import { OutagesService } from '../monitoring/outages.service';
import { MqttService } from '../mqtt/mqtt.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { LogsService } from './logs.service';
import { PLANS } from '../platform/plans';

const TELEMETRY_SEC = 60;

/**
 * Boards: discovers them (announce), tracks online/offline (status + Last Will), adopts them, and
 * publishes each board's configuration (its devices and pins) as a retained MQTT message.
 */
@Injectable()
export class NodesService implements OnModuleInit {
  private readonly log = new Logger('Nodes');
  /** Last status of boards not in the database yet: status and announce can arrive in either order. */
  private readonly unknownStatus = new Map<string, boolean>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly mqtt: MqttService,
    private readonly realtime: RealtimeService,
    private readonly audit: AuditService,
    private readonly monitoring: MonitoringService,
    private readonly outages: OutagesService,
    @Inject(forwardRef(() => FirmwareService)) private readonly firmware: FirmwareService,
    private readonly logs: LogsService,
  ) {}

  onModuleInit() {
    this.mqtt.on('announce', (t, p) => this.onAnnounce(t.nodeId, p));
    this.mqtt.on('status', (t, p) => this.onStatus(t.nodeId, p));
    this.mqtt.on('configApplied', (t, p) => this.onConfigApplied(t.nodeId, p));
    this.mqtt.on('telemetry', (t, p) => this.onTelemetry(t.nodeId, p));
    this.mqtt.on('network', (t, p) => this.onNetwork(t.nodeId, p));
  }

  /**
   * Where a board nobody added goes: only on a self-hosted install (one organization, made by the
   * first-run setup) and within its plan. On a shared platform it waits, unclaimed, until staff add its ID.
   */
  private async autoClaimOrg(): Promise<string | null> {
    const orgs = await this.prisma.organization.findMany({ select: { id: true, selfHosted: true, plan: true }, take: 2 });
    const org = orgs.length === 1 && orgs[0]!.selfHosted ? orgs[0]! : null;
    if (!org) return null;
    const limit = PLANS[org.plan].boards;
    if (limit !== null && (await this.prisma.node.count({ where: { orgId: org.id, status: { not: NodeStatus.FAULTY } } })) >= limit) return null;
    return org.id;
  }

  // ---------------------------------------------------------------- from the boards
  private async onAnnounce(nodeId: string, payload: Record<string, unknown> | null) {
    const parsed = announcePayload.safeParse(payload);
    if (!parsed.success || !isSafeId(nodeId)) return;
    const info = parsed.data;
    const board = BOARDS[info.board] ? info.board : 'NODEMCU_V2';
    const existing = await this.prisma.node.findUnique({ where: { id: nodeId } });
    // A board nobody added yet: with a single organization (a self-hosted install) it goes straight
    // into that organization's stock; on a shared platform it waits, unclaimed, until staff add its ID.
    // (also a board that first announced itself before the setup had made the organization)
    let orgId = existing?.orgId ?? null;
    if (!orgId) orgId = await this.autoClaimOrg();
    const node = await this.prisma.node.upsert({
      where: { id: nodeId },
      create: {
        id: nodeId, orgId, name: nodeId, board, firmware: info.fw, ip: info.ip, mac: info.mac,
        online: this.unknownStatus.get(nodeId) ?? false, lastSeenAt: new Date(),
      },
      update: { firmware: info.fw, ip: info.ip, mac: info.mac, lastSeenAt: new Date(), ...(existing?.orgId ? {} : { orgId }) },
    });
    this.unknownStatus.delete(nodeId);
    this.log.log(`Board ${nodeId} announced (${node.status.toLowerCase()}${node.orgId ? '' : ', unclaimed'}, firmware ${info.fw})`);
    this.logs.server(nodeId, 'info', `Board connected (firmware ${info.fw}, IP ${info.ip ?? '?'})`);
    await this.publishConfig(nodeId); // make sure it has its current config after a reboot
    if (node.homeId) {
      this.firmware.announced(nodeId, node.homeId, info.fw);
      this.realtime.nodesChanged(node.homeId, nodeId);
    }
    if (node.orgId) this.realtime.inventoryChanged(node.orgId);
  }

  private async onStatus(nodeId: string, payload: Record<string, unknown> | null) {
    const parsed = nodeStatusPayload.safeParse(payload);
    if (!parsed.success) return;
    const node = await this.prisma.node.findUnique({ where: { id: nodeId } });
    const { online, fw, ip } = parsed.data;
    if (!node) {
      this.unknownStatus.set(nodeId, online);
      return;
    }
    await this.prisma.node.update({
      where: { id: nodeId },
      data: { online, lastSeenAt: new Date(), ...(fw ? { firmware: fw } : {}), ...(ip ? { ip } : {}) },
    });
    if (online !== node.online) {
      this.log.log(`Board ${nodeId} is ${online ? 'online' : 'OFFLINE'}`);
      this.logs.server(nodeId, online ? 'info' : 'warn', online ? 'Online' : 'Offline: the broker lost the connection to the board');
      if (node.homeId && node.status === NodeStatus.ADOPTED) {
        void (online ? this.outages.online(nodeId) : this.outages.offline(nodeId, node.lastSeenAt)).catch((e) => this.log.warn(`outage tracking failed: ${e}`));
        void this.audit.record(node.homeId, null, online ? 'board.online' : 'board.offline', nodeId, { name: node.name });
      }
    }
    if (node.orgId) this.realtime.inventoryChanged(node.orgId);
    if (!node.homeId) return;
    this.realtime.nodeStatus(node.homeId, { nodeId, online, name: node.name, changed: online !== node.online, at: new Date().toISOString() });
    this.realtime.nodesChanged(node.homeId, nodeId);
  }

  private async onConfigApplied(nodeId: string, payload: Record<string, unknown> | null) {
    const parsed = configAppliedPayload.safeParse(payload);
    if (!parsed.success) return;
    const node = await this.prisma.node.findUnique({ where: { id: nodeId } });
    if (!node) return;
    const { rev, ok, error } = parsed.data;
    await this.prisma.node.update({
      where: { id: nodeId },
      data: ok ? { appliedRev: rev, configError: null } : { configError: error ?? 'The board rejected the configuration' },
    });
    if (!ok) this.log.warn(`Board ${nodeId} rejected config rev ${rev}: ${error}`);
    this.logs.server(nodeId, ok ? 'info' : 'error', ok ? `Configuration rev ${rev} applied by the board` : `Configuration rev ${rev} rejected: ${error}`);
    if (node.homeId) this.realtime.nodesChanged(node.homeId, nodeId);
  }

  // ---------------------------------------------------------------- Wi-Fi (network tab)
  private readonly network = new Map<string, { scan?: NetworkPayload['scan']; scanAt?: string; result?: NetworkPayload['result']; resultAt?: string }>();

  private async onNetwork(nodeId: string, payload: Record<string, unknown> | null) {
    const parsed = networkPayload.safeParse(payload);
    if (!parsed.success) return;
    const now = new Date().toISOString();
    const entry = { ...this.network.get(nodeId) };
    if (parsed.data.scan) Object.assign(entry, { scan: parsed.data.scan, scanAt: now });
    if (parsed.data.result) {
      Object.assign(entry, { result: parsed.data.result, resultAt: now });
      const r = parsed.data.result;
      this.logs.server(nodeId, r.ok ? 'info' : 'warn', r.ok ? `Wi-Fi changed to "${r.ssid}"` : `Wi-Fi change to "${r.ssid}" failed: ${r.message}`);
    }
    this.network.set(nodeId, entry);
    const node = await this.prisma.node.findUnique({ where: { id: nodeId }, select: { homeId: true } });
    if (!node?.homeId) return;
    if (parsed.data.ota) this.firmware.outcome(nodeId, node.homeId, parsed.data.ota.ok, parsed.data.ota.message, parsed.data.ota.version);
    this.realtime.nodeNetwork(node.homeId, { nodeId, ...entry, ota: parsed.data.ota });
  }

  async networkInfo(actor: AuthUser, nodeId: string) {
    await this.nodeIn(actor.homeId, nodeId);
    return this.network.get(nodeId) ?? {};
  }

  async scanWifi(actor: AuthUser, nodeId: string) {
    const node = await this.nodeIn(actor.homeId, nodeId);
    if (!node.online) throw new BadRequestException('The board is offline.');
    await this.mqtt.publish(topics.cmd(nodeId), { action: 'scan' }, { qos: 1 });
  }

  /** Moves the board to another Wi-Fi. The board falls back to the old one if it cannot join within 30 s. */
  async changeWifi(actor: AuthUser, nodeId: string, input: { ssid: string; password: string }) {
    const node = await this.nodeIn(actor.homeId, nodeId);
    if (!node.online) throw new BadRequestException('The board is offline.');
    await this.mqtt.publish(topics.cmd(nodeId), { action: 'wifi', ssid: input.ssid, password: input.password }, { qos: 1 });
    await this.audit.record(actor.homeId, actor.id, 'node.wifi', nodeId, { ssid: input.ssid }); // never the password
    this.logs.server(nodeId, 'info', `Asked the board to switch to Wi-Fi "${input.ssid}"`);
  }

  /** Forgets the Wi-Fi and restarts into the HomeNode-xxxxxx setup hotspot. */
  async resetWifi(actor: AuthUser, nodeId: string) {
    const node = await this.nodeIn(actor.homeId, nodeId);
    if (!node.online) throw new BadRequestException('The board is offline.');
    await this.mqtt.publish(topics.cmd(nodeId), { action: 'wifi-reset' }, { qos: 1 });
    await this.audit.record(actor.homeId, actor.id, 'node.wifi_reset', nodeId, {});
    this.logs.server(nodeId, 'warn', 'Asked the board to forget its Wi-Fi and open its setup hotspot');
  }

  /** Latest health report of each board (memory only: boards send one every minute). */
  private readonly health = new Map<string, Record<string, unknown>>();

  healthOf(nodeId: string): Record<string, unknown> | null {
    return this.health.get(nodeId) ?? null;
  }

  private async onTelemetry(nodeId: string, payload: Record<string, unknown> | null) {
    const parsed = telemetryPayload.safeParse(payload);
    if (!parsed.success) return;
    const at = new Date();
    const health = { ...parsed.data, at: at.toISOString() };
    this.health.set(nodeId, health);
    // before the sample below is saved: the last sample before a restart is when the board was last alive
    await this.outages.telemetry(nodeId, parsed.data, at).catch((e) => this.log.warn(`outage tracking failed: ${e}`));
    await this.prisma.node.updateMany({
      where: { id: nodeId },
      data: { rssi: parsed.data.rssi ?? undefined, lastSeenAt: at },
    });
    const node = await this.prisma.node.findUnique({ where: { id: nodeId }, select: { id: true, name: true, homeId: true, status: true } });
    if (node?.status === 'ADOPTED' && node.homeId) {
      this.realtime.nodeHealth(node.homeId, { nodeId, health, lastSeenAt: health.at });
      await this.monitoring.boardHealth({ ...node, homeId: node.homeId }, parsed.data);
    }
  }

  // ---------------------------------------------------------------- configuration
  async buildConfig(nodeId: string): Promise<NodeConfigPayload> {
    const node = await this.prisma.node.findUniqueOrThrow({
      where: { id: nodeId },
      include: { devices: { where: { enabled: true }, orderBy: { createdAt: 'asc' } }, inputs: { include: { target: true } } },
    });
    const adopted = node.status === NodeStatus.ADOPTED;
    return {
      rev: node.configRev,
      adopted,
      devices: adopted
        ? node.devices.map((d) => ({
            key: d.key, type: d.type, pin: d.pin, activeLow: d.activeLow, settings: d.settings as Record<string, unknown>,
          }))
        : [],
      inputs: adopted
        ? node.inputs
            .filter((i) => i.target.enabled)
            .map((i) => ({ type: i.type, pin: i.pin, target: i.target.key, settings: i.settings as Record<string, unknown> }))
        : [],
      telemetrySec: TELEMETRY_SEC,
    };
  }

  async publishConfig(nodeId: string) {
    const config = await this.buildConfig(nodeId);
    await this.mqtt.publish(topics.config(nodeId), config, { qos: 1, retain: true });
  }

  /** Call after any change to a board's devices or inputs. */
  async bumpConfig(nodeId: string) {
    const node = await this.prisma.node.update({ where: { id: nodeId }, data: { configRev: { increment: 1 } } });
    await this.publishConfig(nodeId);
    this.logs.server(nodeId, 'info', `Sent configuration rev ${node.configRev}`);
  }

  // ---------------------------------------------------------------- pins
  /** Throws a clear 400 unless the pin may be used this way and is free on this board. */
  async assertPinUsable(nodeId: string, board: string, pin: number, use: PinUse,
                        except: { deviceId?: string; inputId?: string } = {}) {
    const problem = checkPin(board, pin, use);
    if (problem) throw new BadRequestException(problem);
    const [device, input] = await Promise.all([
      this.prisma.device.findFirst({ where: { nodeId, pin, NOT: except.deviceId ? { id: except.deviceId } : undefined } }),
      this.prisma.input.findFirst({ where: { nodeId, pin, NOT: except.inputId ? { id: except.inputId } : undefined } }),
    ]);
    if (device) throw new BadRequestException(`That pin is already used by "${device.name}".`);
    if (input) throw new BadRequestException('That pin is already used by a button on this board.');
  }

  // ---------------------------------------------------------------- admin actions
  async nodeIn(homeId: string, nodeId: string) {
    const node = await this.prisma.node.findFirst({ where: { id: nodeId, homeId } });
    if (!node) throw new NotFoundException('No such board.');
    return node;
  }

  async recentLogs(actor: AuthUser, nodeId: string) {
    await this.nodeIn(actor.homeId, nodeId);
    return this.logs.list(nodeId);
  }

  async list(homeId: string) {
    const nodes = await this.prisma.node.findMany({
      where: { homeId },
      include: { devices: { include: { state: true }, orderBy: { createdAt: 'asc' } }, inputs: { include: { target: true } } },
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
    });
    // after a restart the live health is empty until the next report: use the last saved sample
    const missing = nodes.filter((n) => !this.health.has(n.id)).map((n) => n.id);
    const saved = missing.length
      ? await this.prisma.$queryRaw<{ nodeId: string; at: Date; rssi: number | null; vcc: number | null; heap: number | null }[]>`
          SELECT DISTINCT ON ("nodeId") "nodeId", at, rssi, vcc, heap FROM "HealthSample" WHERE "nodeId" = ANY(${missing}) ORDER BY "nodeId", at DESC`
      : [];
    const fallback = new Map(saved.map((r) => [r.nodeId, {
      at: r.at.toISOString(), ...(r.rssi !== null ? { rssi: r.rssi } : {}), ...(r.vcc !== null ? { vcc: r.vcc } : {}), ...(r.heap !== null ? { heap: r.heap } : {}), saved: true,
    }]));
    return nodes.map((n) => ({
      id: n.id, name: n.name, board: n.board, boardName: BOARDS[n.board]?.name ?? n.board, status: n.status, online: n.online, firmware: n.firmware, ip: n.ip, mac: n.mac,
      rssi: n.rssi, lastSeenAt: n.lastSeenAt, configRev: n.configRev, appliedRev: n.appliedRev, configError: n.configError,
      publicIp: n.publicIp, publicPlace: n.publicPlace, publicIsp: n.publicIsp,
      health: this.health.get(n.id) ?? fallback.get(n.id) ?? null,
      devices: n.devices.map((d) => ({
        id: d.id, key: d.key, name: d.name, type: d.type, pin: d.pin, activeLow: d.activeLow, roomId: d.roomId,
        settings: d.settings, enabled: d.enabled, aliases: d.aliases, state: d.state?.state ?? null,
      })),
      inputs: n.inputs.map((i) => ({ id: i.id, type: i.type, pin: i.pin, targetId: i.targetId, targetName: i.target.name, settings: i.settings })),
    }));
  }

  /** The installer, on site: the assigned board is powered and online — name it after where it is. */
  async adopt(actor: AuthUser, nodeId: string, input: { name: string; board: string }) {
    const node = await this.nodeIn(actor.homeId, nodeId);
    if (!BOARDS[input.board]) throw new BadRequestException('Unknown board type.');
    if (node.status === NodeStatus.ADOPTED) throw new BadRequestException('This board is already installed.');
    await this.prisma.node.update({
      where: { id: node.id },
      data: { name: input.name, board: input.board, status: NodeStatus.ADOPTED, configRev: { increment: 1 }, installerId: node.installerId ?? (actor.viaStaff ? actor.id : null) },
    });
    await this.publishConfig(node.id);
    await this.audit.record(actor.homeId, actor.id, 'board.install', node.id, { ...input, from: node.status });
    this.realtime.nodesChanged(actor.homeId, node.id);
    if (node.orgId) this.realtime.inventoryChanged(node.orgId);
  }

  async update(actor: AuthUser, nodeId: string, input: { name?: string; board?: string }) {
    const node = await this.nodeIn(actor.homeId, nodeId);
    if (input.board && input.board !== node.board) {
      if (!BOARDS[input.board]) throw new BadRequestException('Unknown board type.');
      const devices = await this.prisma.device.findMany({ where: { nodeId } });
      for (const d of devices) {
        const problem = checkPin(input.board, d.pin, DEVICE_TYPES[d.type]?.pinUse ?? 'output');
        if (problem) throw new BadRequestException(`${d.name}: ${problem}`);
      }
    }
    await this.prisma.node.update({ where: { id: nodeId }, data: input });
    await this.audit.record(actor.homeId, actor.id, 'node.update', nodeId, input);
    this.realtime.nodesChanged(actor.homeId, nodeId);
    this.realtime.devicesChanged(actor.homeId);
  }

  /**
   * Takes the board out of the home: its devices and buttons are deleted, it stops running them,
   * and it goes back to the organization's stock (ready to be assigned again).
   */
  async forget(actor: AuthUser, nodeId: string) {
    const node = await this.prisma.node.findFirst({ where: { id: nodeId, homeId: actor.homeId }, include: { devices: true } });
    if (!node) throw new NotFoundException('No such board.');
    await this.release(node.id, node.devices.map((d) => d.key));
    await this.audit.record(actor.homeId, actor.id, 'board.remove', nodeId, { name: node.name });
    this.realtime.nodesChanged(actor.homeId, nodeId);
    this.realtime.devicesChanged(actor.homeId);
    if (node.orgId) this.realtime.inventoryChanged(node.orgId);
  }

  /** Back to stock: no home, no devices, an empty configuration on the board. Used by inventory too. */
  async release(nodeId: string, deviceKeys?: string[], status: NodeStatus = NodeStatus.STOCK, note?: string | null) {
    const keys = deviceKeys ?? (await this.prisma.device.findMany({ where: { nodeId }, select: { key: true } })).map((d) => d.key);
    const node = await this.prisma.$transaction(async (tx) => {
      await tx.input.deleteMany({ where: { nodeId } });
      await tx.device.deleteMany({ where: { nodeId } });
      // the next customer must not see where the last one lives
      await tx.nodeConnection.deleteMany({ where: { nodeId } });
      return tx.node.update({
        where: { id: nodeId },
        data: {
          homeId: null, installerId: null, assignedAt: null, status, name: nodeId, configRev: { increment: 1 }, configError: null,
          publicIp: null, publicPlace: null, publicIsp: null, publicIpAt: null, ...(note !== undefined ? { note } : {}),
        },
      });
    });
    this.logs.moved(nodeId);
    const empty: NodeConfigPayload = { rev: node.configRev, adopted: false, devices: [], inputs: [], telemetrySec: TELEMETRY_SEC };
    await this.mqtt.publish(topics.config(nodeId), empty, { qos: 1, retain: true });
    for (const key of keys) await this.mqtt.publish(topics.deviceState(nodeId, key), null, { qos: 1, retain: true });
  }

  async reboot(actor: AuthUser, nodeId: string) {
    await this.nodeIn(actor.homeId, nodeId);
    await this.mqtt.publish(topics.cmd(nodeId), { action: 'reboot' }, { qos: 1 });
    this.logs.server(nodeId, 'info', `Restart requested by ${actor.name}`);
  }

  // ---------------------------------------------------------------- inputs (wall buttons)
  async addInput(actor: AuthUser, nodeId: string, input: { type: string; pin: number; targetId: string; settings: unknown }) {
    const node = await this.nodeIn(actor.homeId, nodeId);
    const def = INPUT_TYPES[input.type];
    if (!def) throw new BadRequestException(`Unknown input type ${input.type}.`);
    const settings = def.settings.safeParse(input.settings ?? {});
    if (!settings.success) throw new BadRequestException(`Settings: ${settings.error.issues[0].message}`);
    const target = await this.prisma.device.findFirst({ where: { id: input.targetId, nodeId } });
    if (!target) throw new BadRequestException('The button must control a device on the same board.');
    if (!DEVICE_TYPES[target.type]?.controllable) throw new BadRequestException(`${target.name} cannot be switched.`);
    await this.assertPinUsable(nodeId, node.board, input.pin, def.pinUse);
    const created = await this.prisma.input.create({
      data: { nodeId, type: input.type, pin: input.pin, targetId: target.id, settings: settings.data as Prisma.InputJsonValue },
    });
    await this.bumpConfig(nodeId);
    await this.audit.record(actor.homeId, actor.id, 'input.create', created.id, { nodeId, pin: input.pin, target: target.key });
    this.realtime.nodesChanged(actor.homeId, nodeId);
    return created;
  }

  async removeInput(actor: AuthUser, inputId: string) {
    const input = await this.prisma.input.findFirst({ where: { id: inputId, node: { homeId: actor.homeId } } });
    if (!input) throw new NotFoundException('No such button.');
    await this.prisma.input.delete({ where: { id: inputId } });
    await this.bumpConfig(input.nodeId);
    await this.audit.record(actor.homeId, actor.id, 'input.remove', inputId);
    this.realtime.nodesChanged(actor.homeId, input.nodeId);
  }
}

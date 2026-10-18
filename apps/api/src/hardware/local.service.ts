import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DEVICE_TYPES, LOCAL_MIN_FIRMWARE, telemetryPayload, topics } from '@home/contracts';
import { NodeStatus } from '@prisma/client';
import { AccessService, RANK } from '../access/access.service';
import { AuthUser, isAdmin } from '../auth/auth.types';
import { compareVersions } from '../common/version';
import { MqttService } from '../mqtt/mqtt.service';
import { PrismaService } from '../prisma/prisma.service';
import { localTag, makePass, newBoardKey, passKey } from './local-pass';

const RESEND_MS = 30_000;

export interface LocalBoard {
  nodeId: string;
  name: string;
  ip: string | null;
  firmware: string | null;
  /** the board holds this home's current key: the phone can switch it over Wi-Fi */
  ready: boolean;
  /** why not, in plain words (null when ready) */
  problem: string | null;
  pass: string;
  passKey: string;
  devices: { id: string; key: string; name: string; type: string; roomId: string | null; roomName: string | null; control: boolean }[];
}

export const supportsLocal = (firmware: string | null | undefined) => !!firmware && compareVersions(firmware, LOCAL_MIN_FIRMWARE) >= 0;

/**
 * Local control without internet. Each board gets a secret key (sent over its private command topic,
 * never retained) and each person a pass per board, which the phone app keeps for when the internet
 * is down. See local-pass.ts for the scheme.
 */
@Injectable()
export class LocalService implements OnModuleInit {
  private readonly log = new Logger('Local');
  private readonly sentAt = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly mqtt: MqttService,
    private readonly access: AccessService,
  ) {}

  onModuleInit() {
    this.mqtt.on('telemetry', async (t, p) => {
      if (t.kind !== 'telemetry') return;
      const parsed = telemetryPayload.safeParse(p);
      if (parsed.success && parsed.data.local !== undefined) await this.reported(t.nodeId, parsed.data.local);
    });
  }

  /** The board's key for the home it is in now (a new one when it moved to another home). */
  private async keyFor(node: { id: string; homeId: string | null; localKey: string | null; localKeyHome: string | null }) {
    if (!node.homeId) return null;
    if (node.localKey && node.localKeyHome === node.homeId) return node.localKey;
    const key = newBoardKey();
    await this.prisma.node.update({ where: { id: node.id }, data: { localKey: key, localKeyHome: node.homeId, localReported: null } });
    return key;
  }

  private async reported(nodeId: string, tag: string) {
    const node = await this.prisma.node.findUnique({ where: { id: nodeId }, select: { localReported: true } });
    if (!node) return;
    if (node.localReported !== tag) await this.prisma.node.update({ where: { id: nodeId }, data: { localReported: tag } });
    await this.sync(nodeId);
  }

  /** Sends the board its key and the home's epoch when what it holds is not current. */
  async sync(nodeId: string, force = false) {
    const node = await this.prisma.node.findUnique({ where: { id: nodeId }, include: { home: { select: { localEpoch: true } } } });
    if (!node || node.status !== NodeStatus.ADOPTED || !node.home || !node.online || !supportsLocal(node.firmware)) return;
    const key = await this.keyFor(node);
    if (!key) return;
    const tag = localTag(key, node.home.localEpoch);
    if (!force && node.localReported === tag) return;
    const last = this.sentAt.get(nodeId) ?? 0;
    if (!force && Date.now() - last < RESEND_MS) return;
    this.sentAt.set(nodeId, Date.now());
    await this.mqtt.publish(topics.cmd(nodeId), { action: 'local', key, epoch: node.home.localEpoch }, { qos: 1 });
  }

  /** Someone lost rights in this home: older passes stop working once the boards hear the new epoch. */
  async revoke(homeId: string) {
    if (!homeId) return;
    await this.prisma.home.update({ where: { id: homeId }, data: { localEpoch: { increment: 1 } } });
    await this.pushEpoch(homeId);
  }

  /** Sends every board of the home its key and the home's current epoch (after the epoch was raised elsewhere). */
  async pushEpoch(homeId: string) {
    const nodes = await this.prisma.node.findMany({ where: { homeId, status: NodeStatus.ADOPTED, online: true }, select: { id: true } });
    for (const n of nodes) await this.sync(n.id, true).catch((e) => this.log.warn(`local key for ${n.id}: ${e}`));
  }

  /** A board left the home: it forgets the key (the empty configuration it gets says so too). */
  async forget(nodeId: string) {
    this.sentAt.delete(nodeId);
    await this.mqtt.publish(topics.cmd(nodeId), { action: 'local-off' }, { qos: 1 });
  }

  /** The passes the phone keeps for this person: one per board, for what they may see and switch. */
  async passes(user: AuthUser): Promise<{ homeId: string; epoch: number; boards: LocalBoard[] }> {
    const home = await this.prisma.home.findUniqueOrThrow({ where: { id: user.homeId }, select: { id: true, localEpoch: true } });
    // only people who belong to the home (staff who don't live there work through the internet)
    const member = await this.prisma.membership.findUnique({ where: { userId_homeId: { userId: user.id, homeId: user.homeId } }, select: { role: true } });
    if (!member) return { homeId: home.id, epoch: home.localEpoch, boards: [] };
    const levels = await this.access.roomLevels(user);
    const nodes = await this.prisma.node.findMany({
      where: { homeId: user.homeId, status: NodeStatus.ADOPTED },
      include: { devices: { where: { enabled: true }, include: { room: { select: { id: true, name: true } } }, orderBy: { createdAt: 'asc' } } },
      orderBy: { name: 'asc' },
    });
    const boards: LocalBoard[] = [];
    for (const node of nodes) {
      const devices = node.devices.flatMap((d) => {
        const level = this.access.levelFor(levels, d.roomId);
        if (!level) return [];
        const switchable = !!DEVICE_TYPES[d.type]?.controllable;
        const control = switchable && RANK[level] >= RANK.CONTROL && (!d.childLock || isAdmin(user.role));
        return [{ id: d.id, key: d.key, name: d.name, type: d.type, roomId: d.room?.id ?? null, roomName: d.room?.name ?? null, control }];
      });
      if (!devices.length) continue;
      const key = await this.keyFor(node);
      if (!key) continue;
      // always the exact keys (never "all"): a device added later is not in an older pass
      const pass = makePass({
        n: node.id, e: home.localEpoch, u: user.id,
        v: devices.map((d) => d.key), c: devices.filter((d) => d.control).map((d) => d.key),
      });
      const supported = supportsLocal(node.firmware);
      const ready = supported && node.localReported === localTag(key, home.localEpoch);
      boards.push({
        nodeId: node.id, name: node.name, ip: node.ip, firmware: node.firmware, ready,
        problem: ready ? null : !supported ? `needs firmware ${LOCAL_MIN_FIRMWARE} or newer` : 'waiting for the board to come online',
        pass, passKey: passKey(key, pass), devices,
      });
    }
    return { homeId: home.id, epoch: home.localEpoch, boards };
  }

  /** For the web app's board pages: can the phone switch this board over Wi-Fi? */
  async status(homeId: string) {
    const home = await this.prisma.home.findUnique({ where: { id: homeId }, select: { localEpoch: true } });
    const nodes = await this.prisma.node.findMany({
      where: { homeId, status: NodeStatus.ADOPTED }, select: { id: true, name: true, firmware: true, localKey: true, localKeyHome: true, localReported: true },
    });
    return nodes.map((n) => ({
      nodeId: n.id, name: n.name, supported: supportsLocal(n.firmware),
      ready: !!home && !!n.localKey && n.localKeyHome === homeId && n.localReported === localTag(n.localKey, home.localEpoch),
    }));
  }
}

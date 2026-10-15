import { Inject, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { open, stat } from 'node:fs/promises';
import { Settings, SETTINGS } from '../config';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { BrokerEvent, END_TEXT, EndReason, parseBrokerLine } from './broker-log';
import { GeoService } from './geo.service';
import { LogsService } from './logs.service';

const POLL_MS = 2000;
const KEEP_PER_NODE = 300;
/** Events older than this when read (e.g. the whole file at start-up) are stored quietly: no live log lines. */
const FRESH_MS = 2 * 60_000;
const MAX_READ = 4 * 1024 * 1024;

/**
 * Follows the broker's log (BROKER_LOG, read-only) and keeps, per board, every connection: the
 * public IP it came from (the home's internet address), where that is and which provider, how long
 * it lasted and how it ended. Reading is idempotent (each connection is unique by board, time and
 * port), so re-reading the file after a restart or a trim changes nothing.
 */
@Injectable()
export class ConnectionsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Connections');
  private timer?: NodeJS.Timeout;
  private offset = 0;
  private partial = '';
  private busy = false;
  private readonly known = new Map<string, { homeId: string | null; at: number }>();
  /** Events of boards the server doesn't know yet: a new board connects a moment before it announces itself. */
  private pending: BrokerEvent[] = [];
  private created = 0;

  constructor(
    @Inject(SETTINGS) private readonly settings: Settings,
    private readonly prisma: PrismaService,
    private readonly geo: GeoService,
    private readonly logs: LogsService,
    private readonly realtime: RealtimeService,
  ) {}

  get tracking() {
    return !!this.settings.brokerLog;
  }

  onModuleInit() {
    if (!this.settings.brokerLog) {
      this.log.log('BROKER_LOG not set: board public IPs and connection history are not tracked');
      return;
    }
    this.timer = setInterval(() => void this.poll(), POLL_MS);
    void this.poll();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  /** Reads what the broker added since last time (from the start after a trim or on start-up). */
  async poll() {
    if (this.busy || !this.settings.brokerLog) return;
    this.busy = true;
    try {
      const file = this.settings.brokerLog;
      const size = await stat(file).then((s) => s.size).catch(() => -1);
      if (size < 0) return;
      await this.retryPending();
      if (size < this.offset) { this.offset = 0; this.partial = ''; } // trimmed or replaced
      if (size === this.offset) return;
      const length = Math.min(size - this.offset, MAX_READ);
      const fh = await open(file, 'r');
      const buf = Buffer.alloc(length);
      try {
        await fh.read(buf, 0, length, this.offset);
      } finally {
        await fh.close();
      }
      this.offset += length;
      const text = this.partial + buf.toString('utf8');
      const lines = text.split('\n');
      this.partial = lines.pop() ?? '';
      for (const line of lines) {
        const ev = parseBrokerLine(line);
        if (ev) await this.apply(ev).catch((e) => this.log.warn(`${line}: ${(e as Error).message}`));
      }
    } finally {
      this.busy = false;
    }
  }

  private async retryPending() {
    if (!this.pending.length) return;
    const waiting = this.pending.filter((e) => Date.now() - e.at.getTime() < 5 * 60_000);
    this.pending = [];
    for (const ev of waiting) await this.apply(ev).catch(() => undefined); // still unknown: queued again
  }

  /** Records one event. */
  private async apply(ev: BrokerEvent) {
    const node = await this.nodeOf(ev.clientId);
    if (node === null) {
      // not a board (the API itself, a test client…), or a new board that hasn't announced itself yet
      if (/^esp-/i.test(ev.clientId) && Date.now() - ev.at.getTime() < 5 * 60_000 && this.pending.length < 200) this.pending.push(ev);
      return;
    }
    const fresh = Date.now() - ev.at.getTime() < FRESH_MS;
    if (ev.kind === 'connected') {
      const { place, isp } = await this.geo.lookup(ev.ip);
      try {
        await this.prisma.nodeConnection.create({
          data: { nodeId: ev.clientId, ip: ev.ip, port: ev.port, connectedAt: ev.at, place, isp },
        });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return; // already recorded
        throw e;
      }
      // an earlier connection still marked open never got its end line (log trimmed, broker restarted)
      await this.prisma.nodeConnection.updateMany({
        where: { nodeId: ev.clientId, endedAt: null, connectedAt: { lt: ev.at } },
        data: { endedAt: ev.at, endReason: 'replaced' },
      });
      const current = await this.prisma.node.findUnique({ where: { id: ev.clientId }, select: { publicIp: true, publicIpAt: true } });
      if (!current?.publicIpAt || current.publicIpAt <= ev.at) {
        await this.prisma.node.update({
          where: { id: ev.clientId },
          data: {
            publicIp: ev.ip, publicPlace: place, publicIsp: isp,
            ...(current?.publicIp !== ev.ip || !current?.publicIpAt ? { publicIpAt: ev.at } : {}),
          },
        });
      }
      if (fresh) {
        this.logs.server(ev.clientId, 'info', `Connected from ${[ev.ip, place, isp].filter(Boolean).join(' · ')}`);
        if (node.homeId) this.realtime.nodesChanged(node.homeId, ev.clientId);
      }
      if (++this.created % 50 === 0) await this.prune(ev.clientId);
      return;
    }
    // ended: the open connection on that port (or the newest open one when the log doesn't say)
    const open = await this.prisma.nodeConnection.findFirst({
      where: { nodeId: ev.clientId, endedAt: null, connectedAt: { lte: ev.at }, ...(ev.port ? { port: ev.port } : {}) },
      orderBy: { connectedAt: 'desc' },
    });
    if (!open) return;
    await this.prisma.nodeConnection.update({
      where: { id: open.id },
      data: { endedAt: ev.at, endReason: ev.reason, endNote: ev.note ?? null },
    });
    if (fresh) {
      const t = END_TEXT[ev.reason];
      const lasted = duration(ev.at.getTime() - open.connectedAt.getTime());
      this.logs.server(ev.clientId, ev.reason === 'timeout' || ev.reason === 'error' ? 'warn' : 'info',
        `Connection ended: ${t.title.toLowerCase()} — ${ev.note ?? t.why} (connected ${lasted})`);
      if (node.homeId) this.realtime.nodesChanged(node.homeId, ev.clientId);
    }
  }

  /** null = not a board (yet). Boards are remembered for a minute; other clients are asked about again. */
  private async nodeOf(id: string): Promise<{ homeId: string | null } | null> {
    const hit = this.known.get(id);
    if (hit && Date.now() - hit.at < 60_000) return { homeId: hit.homeId };
    const node = await this.prisma.node.findUnique({ where: { id }, select: { homeId: true } });
    if (!node) return null;
    if (this.known.size > 5000) this.known.clear();
    this.known.set(id, { homeId: node.homeId, at: Date.now() });
    return { homeId: node.homeId };
  }

  private async prune(nodeId: string) {
    const old = await this.prisma.nodeConnection.findMany({
      where: { nodeId }, orderBy: { connectedAt: 'desc' }, skip: KEEP_PER_NODE, select: { id: true },
    });
    if (old.length) await this.prisma.nodeConnection.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
  }

  /** A board's internet connection: where it is now, how steady it has been, and its recent connections. */
  /** All boards the caller's scope covers (see staffScope), with how their connection has been. */
  fleet(where: Prisma.NodeWhereInput) {
    return fleetOf(this.prisma, where, this.tracking);
  }

    async forNode(homeId: string, nodeId: string) {
    return this.forBoard({ id: nodeId, homeId });
  }

  /**
   * One board's connection, for whoever may see it: `where` carries the caller's scope (the home they are
   * in, or the homes their staff role covers), so a board outside it is simply "not found".
   */
  async forBoard(where: Prisma.NodeWhereInput) {
    const node = await this.prisma.node.findFirst({
      where,
      select: {
        id: true, name: true, online: true, lastSeenAt: true, publicIp: true, publicPlace: true, publicIsp: true, publicIpAt: true,
        home: { select: { id: true, name: true, city: true } },
      },
    });
    if (!node) throw new NotFoundException('No such board.');
    const nodeId = node.id;
    const rows = await this.prisma.nodeConnection.findMany({ where: { nodeId }, orderBy: { connectedAt: 'desc' }, take: 60 });
    const now = Date.now();
    const since = (ms: number) => rows.filter((r) => now - r.connectedAt.getTime() < ms);
    const week = since(7 * 86400_000);
    const ends = (list: typeof rows) => {
      const out: Record<EndReason, number> = { timeout: 0, closed: 0, clean: 0, replaced: 0, error: 0 };
      for (const r of list) if (r.endReason) out[r.endReason as EndReason] = (out[r.endReason as EndReason] ?? 0) + 1;
      return out;
    };
    const openRow = rows.find((r) => !r.endedAt);
    const ips = new Set(week.map((r) => r.ip));
    return {
      tracking: this.tracking,
      board: { id: node.id, name: node.name, online: node.online, lastSeenAt: node.lastSeenAt, home: node.home },
      current: node.publicIp
        ? {
            ip: node.publicIp, place: node.publicPlace, isp: node.publicIsp, ipSince: node.publicIpAt,
            connectedSince: node.online && openRow ? openRow.connectedAt : null,
          }
        : null,
      stats: {
        connects24h: since(86400_000).length,
        connects7d: week.length,
        ends7d: ends(week),
        addresses7d: ips.size,
      },
      history: rows.map((r, i) => ({
        id: r.id, ip: r.ip, place: r.place, isp: r.isp,
        connectedAt: r.connectedAt, endedAt: r.endedAt, endReason: r.endReason, endNote: r.endNote,
        seconds: Math.round(((r.endedAt?.getTime() ?? now) - r.connectedAt.getTime()) / 1000),
        /** a different address from the connection before it */
        newAddress: i < rows.length - 1 && rows[i + 1].ip !== r.ip,
      })),
    };
  }
}

/** Every board in scope with how its connection has been: the console's "how are all my boards doing". */
export async function fleetOf(prisma: PrismaService, where: Prisma.NodeWhereInput, tracking: boolean) {
  const nodes = await prisma.node.findMany({
    where,
    select: {
      id: true, name: true, status: true, online: true, lastSeenAt: true, rssi: true, firmware: true,
      publicIp: true, publicPlace: true, publicIsp: true, publicIpAt: true,
      home: { select: { id: true, name: true, city: true, installer: { select: { name: true } } } },
    },
    orderBy: [{ home: { name: 'asc' } }, { name: 'asc' }],
  });
  const weekAgo = new Date(Date.now() - 7 * 86400_000);
  const rows = nodes.length
    ? await prisma.nodeConnection.findMany({
        where: { nodeId: { in: nodes.map((n) => n.id) }, OR: [{ connectedAt: { gte: weekAgo } }, { endedAt: null }] },
        orderBy: { connectedAt: 'desc' },
        select: { nodeId: true, connectedAt: true, endedAt: true, endReason: true, endNote: true },
      })
    : [];
  const dayAgo = Date.now() - 86400_000;
  return {
    tracking,
    boards: nodes.map((n) => {
      const mine = rows.filter((r) => r.nodeId === n.id);
      const week = mine.filter((r) => r.connectedAt >= weekAgo);
      const open = mine.find((r) => !r.endedAt);
      const lastEnded = mine.find((r) => r.endedAt);
      return {
        id: n.id, name: n.name, status: n.status, online: n.online, lastSeenAt: n.lastSeenAt, rssi: n.rssi, firmware: n.firmware,
        home: n.home ? { id: n.home.id, name: n.home.name, city: n.home.city, installer: n.home.installer?.name ?? null } : null,
        publicIp: n.publicIp, publicPlace: n.publicPlace, publicIsp: n.publicIsp, publicIpAt: n.publicIpAt,
        connectedSince: n.online && open ? open.connectedAt : null,
        connects24h: week.filter((r) => r.connectedAt.getTime() >= dayAgo).length,
        connects7d: week.length,
        ends7d: countEnds(week),
        lastEnd: lastEnded ? { at: lastEnded.endedAt, reason: lastEnded.endReason, note: lastEnded.endNote } : null,
      };
    }),
  };
}

export function duration(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ${m % 60} min`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? '' : 's'}${h % 24 ? ` ${h % 24} h` : ''}`;
}

/** Ends by reason, counted. */
function countEnds(rows: { endReason: string | null }[]) {
  const out: Record<EndReason, number> = { timeout: 0, closed: 0, clean: 0, replaced: 0, error: 0 };
  for (const r of rows) if (r.endReason && r.endReason in out) out[r.endReason as EndReason] += 1;
  return out;
}

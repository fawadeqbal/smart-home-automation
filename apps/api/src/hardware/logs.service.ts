import { Injectable, OnModuleInit } from '@nestjs/common';
import { LogLevel, logPayload } from '@home/contracts';
import { MqttService } from '../mqtt/mqtt.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';

export interface LogEntry {
  at: string;              // ISO time on the server
  level: LogLevel;
  msg: string;
  source: 'board' | 'server';
  uptime?: number;         // board uptime in seconds, for board lines
}

const KEEP_PER_NODE = 300;

/**
 * Live logs per board: lines the board publishes on its `log` topic, plus what the server did with it
 * (commands sent and confirmed, configuration applied, online/offline). Kept in memory (the last 300 per
 * board) and pushed to owners and admins as they happen; nothing is written to the database.
 */
@Injectable()
export class LogsService implements OnModuleInit {
  private readonly lines = new Map<string, LogEntry[]>();
  private readonly homeOf = new Map<string, string>();

  constructor(
    private readonly mqtt: MqttService,
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  onModuleInit() {
    this.mqtt.on('log', async (t, payload) => {
      const parsed = logPayload.safeParse(payload);
      if (!parsed.success) return;
      await this.add(t.nodeId, { ...parsed.data, source: 'board' });
    });
  }

  /** Something the server did for this board, shown in the same live log. */
  server(nodeId: string, level: LogLevel, msg: string) {
    void this.add(nodeId, { level, msg, source: 'server' });
  }

  list(nodeId: string): LogEntry[] {
    return this.lines.get(nodeId) ?? [];
  }

  clear(nodeId: string) {
    this.lines.delete(nodeId);
  }

  /** The board moved to another home (or back to stock): forget the cached home and its log. */
  moved(nodeId: string) {
    this.homeOf.delete(nodeId);
    this.lines.delete(nodeId);
  }

  private async add(nodeId: string, entry: Omit<LogEntry, 'at'>) {
    let homeId = this.homeOf.get(nodeId);
    if (!homeId) {
      const node = await this.prisma.node.findUnique({ where: { id: nodeId }, select: { homeId: true } });
      if (!node?.homeId) return; // not in a home (yet)
      homeId = node.homeId;
      this.homeOf.set(nodeId, homeId);
    }
    const full: LogEntry = { at: new Date().toISOString(), ...entry };
    const list = this.lines.get(nodeId) ?? [];
    list.push(full);
    if (list.length > KEEP_PER_NODE) list.splice(0, list.length - KEEP_PER_NODE);
    this.lines.set(nodeId, list);
    this.realtime.nodeLog(homeId, nodeId, full);
  }
}

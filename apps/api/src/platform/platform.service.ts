import {
  BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException,
} from '@nestjs/common';
import { BOARDS, isSafeId } from '@home/contracts';
import { NodeStatus, OrgStatus, Plan, Prisma, Role, StaffRole, VisitStatus } from '@prisma/client';
import { randomToken, sha256 } from '../auth/auth.service';
import { AuthUser, ROLE_LABEL, STAFF_LABEL } from '../auth/auth.types';
import { AuditService, auditCategory } from '../common/audit.service';
import { normalisePhone } from '../common/phone';
import { compareVersions, highestVersion } from '../common/version';
import { StockService } from './stock.service';
import { VISIT_STATUS_LABEL } from '../visits/visits.service';
import { Settings, SETTINGS } from '../config';
import { NodesService } from '../hardware/nodes.service';
import { MqttService } from '../mqtt/mqtt.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { PLAN_ORDER, PLANS } from './plans';

const STARTED = Date.now();
const DAY = 86400000;
const INVITE_TTL_MS = 7 * DAY;
/** The newest firmware we know of; boards on older builds are highlighted. */
const CURRENT_FW_FALLBACK = null as string | null;

export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'mute';

interface NodeLike {
  id: string; status: NodeStatus; online: boolean; lastSeenAt: Date | null; rssi: number | null;
  configError: string | null; firmware: string | null;
}
interface Health { vcc?: number | null; heap?: number | null; rssi?: number | null; uptime?: number | null }

export function ago(d: Date | string | null | undefined): string {
  if (!d) return 'never';
  const sec = Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / 1000));
  if (sec < 60) return 'just now';
  if (sec < 3600) return `${Math.round(sec / 60)} min ago`;
  if (sec < DAY / 1000) return `${Math.round(sec / 3600)} h ago`;
  if (sec < 2 * DAY / 1000) return 'Yesterday';
  if (sec < 30 * DAY / 1000) return `${Math.round(sec / 86400)} d ago`;
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/** How a board is doing, in words, with a colour. */
export function condition(n: NodeLike, h: Health | null): { cond: Tone; text: string } {
  if (n.status === NodeStatus.STOCK) return { cond: 'mute', text: 'In stock' };
  if (n.status === NodeStatus.FAULTY) return { cond: 'bad', text: 'Faulty' };
  if (n.status === NodeStatus.ASSIGNED) return n.online ? { cond: 'info', text: 'Online · ready to install' } : { cond: 'mute', text: 'Awaiting install' };
  if (!n.online) {
    const since = n.lastSeenAt ? ago(n.lastSeenAt).replace(' ago', '') : 'never seen';
    return { cond: 'bad', text: `Offline · ${since}` };
  }
  if (n.configError) return { cond: 'bad', text: 'Settings rejected' };
  const vcc = h?.vcc ?? null;
  const rssi = h?.rssi ?? n.rssi;
  if (vcc !== null && vcc > 0 && vcc < 3000) return { cond: 'warn', text: 'Low voltage' };
  if (rssi !== null && rssi !== undefined && rssi < -75) return { cond: 'warn', text: 'Weak Wi‑Fi' };
  if (h?.heap != null && h.heap < 6000) return { cond: 'warn', text: 'Low memory' };
  return { cond: 'ok', text: 'Healthy' };
}

const STEP_TITLES: [string, string, string][] = [
  ['Home created', 'Owner, address and time zone', ''],
  ['Boards assigned', 'Picked from inventory', 'Assign boards'],
  ['Boards installed and online', 'The installer powers them on site', 'Install boards'],
  ['Devices and pins configured', 'Lights, sensors, wall buttons', 'Configure pins'],
  ['Rooms and access', 'Group devices, decide who sees what', 'Set up rooms'],
  ['Handed over to owner', 'The owner accepts the invite', 'Send owner invite'],
];

@Injectable()
export class PlatformService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly nodes: NodesService,
    private readonly mqtt: MqttService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
    private readonly stock: StockService,
    @Inject(SETTINGS) private readonly settings: Settings,
  ) {}

  // ================================================================ shared helpers
  private org(user: AuthUser) {
    if (!user.orgId) throw new ForbiddenException('This is for platform staff only.');
    return user.orgId;
  }

  /** Latest health per board: live telemetry, else the last saved sample. */
  private async healthMap(nodeIds: string[]) {
    const map = new Map<string, Health>();
    if (!nodeIds.length) return map;
    const rows = await this.prisma.$queryRaw<{ nodeId: string; vcc: number | null; heap: number | null; rssi: number | null }[]>`
      SELECT DISTINCT ON ("nodeId") "nodeId", vcc, heap, rssi FROM "HealthSample"
      WHERE "nodeId" = ANY(${nodeIds}) ORDER BY "nodeId", at DESC`;
    for (const r of rows) map.set(r.nodeId, { vcc: r.vcc, heap: r.heap, rssi: r.rssi });
    for (const id of nodeIds) {
      const live = this.nodes.healthOf(id) as Health | null;
      if (live) map.set(id, { ...map.get(id), ...live });
    }
    return map;
  }

  /** The newest firmware: the highest version uploaded (the same rule as the board's Firmware tab). */
  private async currentFirmware(orgId: string) {
    const imgs = await this.prisma.firmwareImage.findMany({ where: { OR: [{ orgId }, { orgId: null }] }, select: { version: true } });
    if (imgs.length) return highestVersion(imgs.map((i) => i.version));
    const top = await this.prisma.node.groupBy({ by: ['firmware'], where: { orgId, firmware: { not: null } }, _count: true, orderBy: { _count: { firmware: 'desc' } }, take: 1 });
    return top[0]?.firmware ?? CURRENT_FW_FALLBACK;
  }

  /** Setup progress of homes, from what actually exists. */
  private async homeFacts(homeIds: string[]) {
    if (!homeIds.length) return new Map<string, { boards: number; installed: number; online: number; devices: number; roomed: number; owner: boolean; people: number; ownerInvite: boolean; lastAt: Date | null }>();
    const [nodes, devices, roomed, members, invites, last] = await Promise.all([
      this.prisma.node.findMany({ where: { homeId: { in: homeIds } }, select: { id: true, homeId: true, status: true, online: true, lastSeenAt: true } }),
      this.prisma.device.groupBy({ by: ['nodeId'], where: { node: { homeId: { in: homeIds } } }, _count: true }),
      this.prisma.device.groupBy({ by: ['nodeId'], where: { node: { homeId: { in: homeIds } }, roomId: { not: null } }, _count: true }),
      this.prisma.membership.groupBy({ by: ['homeId', 'role'], where: { homeId: { in: homeIds } }, _count: true }),
      this.prisma.invite.findMany({ where: { homeId: { in: homeIds }, role: Role.OWNER, usedAt: null, expiresAt: { gt: new Date() } }, select: { homeId: true } }),
      this.prisma.auditLog.groupBy({ by: ['homeId'], where: { homeId: { in: homeIds } }, _max: { at: true } }),
    ]);
    const nodeHome = new Map(nodes.map((n) => [n.id, n.homeId!]));
    const facts = new Map(homeIds.map((id) => [id, { boards: 0, installed: 0, online: 0, devices: 0, roomed: 0, owner: false, people: 0, ownerInvite: false, lastAt: null as Date | null }]));
    for (const n of nodes) {
      const f = facts.get(n.homeId!)!;
      f.boards++;
      if (n.status === NodeStatus.ADOPTED) { f.installed++; if (n.online) f.online++; }
      if (n.lastSeenAt && (!f.lastAt || n.lastSeenAt > f.lastAt)) f.lastAt = n.lastSeenAt;
    }
    for (const d of devices) facts.get(nodeHome.get(d.nodeId)!)!.devices += d._count;
    for (const d of roomed) facts.get(nodeHome.get(d.nodeId)!)!.roomed += d._count;
    for (const m of members) {
      const f = facts.get(m.homeId)!;
      f.people += m._count;
      if (m.role === Role.OWNER) f.owner = true;
    }
    for (const i of invites) facts.get(i.homeId!)!.ownerInvite = true;
    for (const l of last) {
      const f = facts.get(l.homeId!);
      if (f && l._max.at && (!f.lastAt || l._max.at > f.lastAt)) f.lastAt = l._max.at;
    }
    return facts;
  }

  /** Which of the six setup steps are done (each from what exists, so they can finish in any order). */
  private stepFlags(f: { boards: number; installed: number; devices: number; roomed: number; owner: boolean }) {
    return [true, f.boards > 0, f.installed > 0, f.devices > 0, f.roomed > 0, f.owner];
  }

  private stepsDone(f: { boards: number; installed: number; devices: number; roomed: number; owner: boolean }) {
    return this.stepFlags(f).filter(Boolean).length;
  }

  // ================================================================ overview
  async overview(user: AuthUser) {
    const orgId = this.org(user);
    const since = new Date(Date.now() - DAY);
    const [homes, nodes, staff, dbSize, assistant, schedules, nextSchedule] = await Promise.all([
      this.prisma.home.findMany({ where: { orgId, archivedAt: null }, select: { id: true, name: true, installerId: true, installer: { select: { name: true } }, createdAt: true } }),
      this.prisma.node.findMany({ where: { orgId }, include: { home: { select: { id: true, name: true } } } }),
      this.prisma.user.count({ where: { orgId, staffRole: { not: null } } }),
      this.timed(async () => (await this.prisma.$queryRaw<{ size: string }[]>`SELECT pg_size_pretty(pg_database_size(current_database())) AS size`)[0]?.size),
      this.timed(async () => {
        const res = await fetch(`${this.settings.assistantUrl}/health`, { signal: AbortSignal.timeout(2500) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as { llm?: string };
      }),
      this.prisma.schedule.count({ where: { enabled: true, home: { orgId } } }),
      this.prisma.schedule.findFirst({ where: { enabled: true, home: { orgId } }, orderBy: { nextRunAt: 'asc' }, select: { name: true, nextRunAt: true } }),
    ]);
    const homeIds = homes.map((h) => h.id);
    const [facts, people, health, commands, hourly, fw] = await Promise.all([
      this.homeFacts(homeIds),
      this.prisma.membership.findMany({ where: { homeId: { in: homeIds } }, distinct: ['userId'], select: { userId: true } }),
      this.healthMap(nodes.map((n) => n.id)),
      this.prisma.$queryRaw<{ channel: string; status: string; n: bigint }[]>`
        SELECT c.channel, c.status::text AS status, COUNT(*) AS n FROM "Command" c
        JOIN "Device" d ON d.id = c."deviceId" JOIN "Node" n ON n.id = d."nodeId" JOIN "Home" h ON h.id = n."homeId"
        WHERE h."orgId" = ${orgId} AND c."createdAt" >= ${since} GROUP BY 1, 2`,
      this.prisma.$queryRaw<{ hour: Date; ok: bigint; bad: bigint }[]>`
        SELECT date_trunc('hour', c."createdAt") AS hour,
               COUNT(*) FILTER (WHERE c.status = 'ACKED') AS ok,
               COUNT(*) FILTER (WHERE c.status IN ('FAILED', 'TIMEOUT')) AS bad
        FROM "Command" c JOIN "Device" d ON d.id = c."deviceId" JOIN "Node" n ON n.id = d."nodeId" JOIN "Home" h ON h.id = n."homeId"
        WHERE h."orgId" = ${orgId} AND c."createdAt" >= ${since} GROUP BY 1 ORDER BY 1`,
      this.currentFirmware(orgId),
    ]);

    const installed = nodes.filter((n) => n.status === NodeStatus.ADOPTED && n.homeId);
    const online = installed.filter((n) => n.online);
    const settingUp = homes.filter((h) => this.stepsDone(facts.get(h.id)!) < 6).length;
    const cmd = { total: 0, acked: 0, failed: 0, byChannel: {} as Record<string, number> };
    for (const r of commands) {
      const n = Number(r.n);
      cmd.total += n;
      if (r.status === 'ACKED') cmd.acked += n;
      if (r.status === 'FAILED' || r.status === 'TIMEOUT') cmd.failed += n;
      cmd.byChannel[r.channel] = (cmd.byChannel[r.channel] ?? 0) + n;
    }
    const bars = Array.from({ length: 24 }, (_, i) => {
      const start = new Date(Math.floor(Date.now() / 3600000) * 3600000 - (23 - i) * 3600000);
      const row = hourly.find((h) => new Date(h.hour).getTime() === start.getTime());
      return { hour: start.toISOString(), ok: Number(row?.ok ?? 0), bad: Number(row?.bad ?? 0) };
    });

    // Things that need someone: broken boards first, then setup that is stuck.
    const attention: { tone: Tone; title: string; homeId: string; home: string; detail: string; at: string | null; tab: string; nodeId?: string; href?: string }[] = [];
    for (const n of installed) {
      const c = condition(n, health.get(n.id) ?? null);
      const h = health.get(n.id);
      if (c.cond === 'bad') {
        attention.push({ tone: 'bad', title: `${n.name} board ${n.online ? 'needs attention' : 'offline'}`, homeId: n.homeId!, home: n.home!.name,
          detail: `${n.id} · ${n.online ? c.text : `last seen ${ago(n.lastSeenAt)}`}`, at: n.lastSeenAt?.toISOString() ?? null, tab: 'diagnostics', nodeId: n.id });
      } else if (c.cond === 'warn') {
        const why = c.text === 'Low voltage' ? `${((h?.vcc ?? 0) / 1000).toFixed(2)} V, boards need 3.0 V or more`
          : c.text === 'Weak Wi‑Fi' ? `${h?.rssi ?? n.rssi} dBm at the ${n.name.toLowerCase()} switchboard` : c.text;
        attention.push({ tone: 'warn', title: c.text, homeId: n.homeId!, home: n.home!.name, detail: `${n.id} · ${why}`, at: n.lastSeenAt?.toISOString() ?? null, tab: 'diagnostics', nodeId: n.id });
      }
    }
    for (const h of homes) {
      const f = facts.get(h.id)!;
      const waiting = nodes.filter((n) => n.homeId === h.id && n.status === NodeStatus.ASSIGNED);
      if (waiting.length) {
        attention.push({ tone: 'info', title: waiting.some((n) => n.online) ? 'Boards ready to install' : 'Boards waiting for install', homeId: h.id, home: h.name,
          detail: `${waiting.length} board${waiting.length > 1 ? 's' : ''} assigned${h.installer ? ` to ${h.installer.name}` : ' · no installer yet'}`, at: null, tab: 'boards' });
      }
      if (!f.owner && f.ownerInvite) {
        attention.push({ tone: 'info', title: 'Owner hasn’t joined', homeId: h.id, home: h.name, detail: 'The owner invite is waiting to be accepted', at: null, tab: 'people' });
      }
    }
    // people who booked a free visit on the website and wait for a call
    const visitsWaiting = await this.prisma.visitRequest.count({ where: { orgId, status: 'NEW' } });
    if (visitsWaiting) {
      const oldest = await this.prisma.visitRequest.findFirst({ where: { orgId, status: 'NEW' }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } });
      attention.push({ tone: 'info', title: `${visitsWaiting} visit request${visitsWaiting === 1 ? '' : 's'} waiting for a call`, homeId: '', home: 'Website',
        detail: 'People who booked a free home visit on the website', at: oldest?.createdAt.toISOString() ?? null, tab: '', href: '/console/requests' });
    }
    const rank: Record<Tone, number> = { bad: 0, warn: 1, info: 2, ok: 3, mute: 4 };
    attention.sort((a, b) => rank[a.tone] - rank[b.tone]);

    const mem = process.memoryUsage();
    const services = [
      { key: 'api', name: 'API server', ok: true, line: `Up ${this.uptime((Date.now() - STARTED) / 1000)} · ${Math.round(mem.rss / 1048576)} MB memory`, metric: '' },
      { key: 'database', name: 'Database', ok: dbSize.ok, line: dbSize.ok ? String(dbSize.value) : dbSize.error ?? 'Not answering', metric: `${dbSize.ms} ms` },
      { key: 'broker', name: 'MQTT broker', ok: this.mqtt.connected, line: this.mqtt.connected ? `${online.length} boards connected` : 'Not connected', metric: '' },
      { key: 'assistant', name: 'Voice assistant', ok: assistant.ok, line: assistant.ok ? assistant.value?.llm ?? 'Running' : 'Not running', metric: assistant.ok ? `${assistant.ms} ms` : '' },
      { key: 'scheduler', name: 'Scheduler', ok: true, line: `${schedules} active${nextSchedule?.nextRunAt ? ` · next “${nextSchedule.name}” ${this.inTime(nextSchedule.nextRunAt)}` : ''}`, metric: '' },
    ];

    return {
      generatedAt: new Date().toISOString(),
      kpis: {
        homes: homes.length, settingUp,
        people: people.length, staff,
        boardsInstalled: installed.length, boardsOnline: online.length,
        inStock: nodes.filter((n) => n.status === NodeStatus.STOCK).length,
        assigned: nodes.filter((n) => n.status === NodeStatus.ASSIGNED).length,
        commands: cmd.total, confirmed: cmd.total ? cmd.acked / cmd.total : 1, failed: cmd.failed, byChannel: cmd.byChannel,
      },
      attention: attention.slice(0, 12),
      attentionCount: attention.filter((a) => a.tone === 'bad' || a.tone === 'warn').length + attention.filter((a) => a.tone === 'info').length,
      services, allOk: services.every((s) => s.ok || s.key === 'assistant'),
      bars, currentFirmware: fw, visitsWaiting,
    };
  }

  private inTime(d: Date) {
    const min = Math.round((d.getTime() - Date.now()) / 60000);
    if (min <= 0) return 'now';
    if (min < 60) return `in ${min} min`;
    if (min < 1440) return `in ${Math.round(min / 60)} h`;
    return `in ${Math.round(min / 1440)} d`;
  }

  private uptime(sec: number) {
    const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
    return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
  }

  private async timed<T>(fn: () => Promise<T>): Promise<{ ok: boolean; ms: number; value?: T; error?: string }> {
    const t = Date.now();
    try {
      const value = await fn();
      return { ok: true, ms: Date.now() - t, value };
    } catch (err) {
      return { ok: false, ms: Date.now() - t, error: (err as Error).message };
    }
  }

  // ================================================================ homes
  homeWhere(user: AuthUser): Prisma.HomeWhereInput {
    const orgId = this.org(user);
    return user.staffRole === StaffRole.INSTALLER ? { orgId, installerId: user.id } : { orgId };
  }

  async homes(user: AuthUser) {
    const homes = await this.prisma.home.findMany({
      where: this.homeWhere(user),
      include: {
        installer: { select: { id: true, name: true } },
        memberships: { where: { role: Role.OWNER }, include: { user: { select: { name: true, email: true } } } },
        nodes: { select: { id: true, status: true, online: true, lastSeenAt: true, rssi: true, configError: true, firmware: true, name: true } },
        invites: { where: { role: Role.OWNER, usedAt: null, expiresAt: { gt: new Date() } }, select: { email: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    const facts = await this.homeFacts(homes.map((h) => h.id));
    const health = await this.healthMap(homes.flatMap((h) => h.nodes.map((n) => n.id)));
    return homes.map((h) => {
      const f = facts.get(h.id)!;
      const steps = this.stepsDone(f);
      const conds = h.nodes.filter((n) => n.status === NodeStatus.ADOPTED).map((n) => condition(n as NodeLike, health.get(n.id) ?? null));
      const worst = conds.find((c) => c.cond === 'bad') ?? conds.find((c) => c.cond === 'warn');
      const status = h.archivedAt ? 'archived' : worst ? 'attention' : steps < 6 ? 'setup' : 'live';
      const owner = h.memberships[0]?.user;
      return {
        id: h.id, name: h.name, city: h.city, timezone: h.timezone,
        owner: owner?.name ?? (h.invites[0] ? h.invites[0].name || h.invites[0].email : null), ownerPending: !owner && !!h.invites[0],
        installer: h.installer?.name ?? null, installerId: h.installer?.id ?? null,
        status, tone: (status === 'live' ? 'ok' : status === 'setup' ? 'info' : status === 'archived' ? 'mute' : worst!.cond) as Tone,
        statusLabel: status === 'live' ? 'Live' : status === 'setup' ? 'Setting up' : status === 'archived' ? 'Archived' : worst!.text.startsWith('Offline') ? 'Board offline' : worst!.text,
        steps, stepFlags: this.stepFlags(f), boardsOnline: f.online, boardsTotal: f.boards, boardsInstalled: f.installed, people: f.people,
        lastActivity: f.lastAt?.toISOString() ?? h.createdAt.toISOString(), lastActivityLabel: ago(f.lastAt ?? h.createdAt),
      };
    });
  }

  private async planLimit(orgId: string, what: 'homes' | 'boards' | 'staff', adding = 1) {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
    if (org.selfHosted) return; // your own company on your own server: no plans, no limits
    if (org.status === OrgStatus.CANCELED) throw new ForbiddenException('This organization’s subscription is cancelled. Choose a plan in Settings.');
    const limit = PLANS[org.plan][what];
    if (limit === null) return;
    const used = what === 'homes' ? await this.prisma.home.count({ where: { orgId, archivedAt: null } })
      : what === 'boards' ? await this.prisma.node.count({ where: { orgId, status: { not: NodeStatus.FAULTY } } })
      : await this.prisma.user.count({ where: { orgId, staffRole: { not: null } } }) + await this.prisma.invite.count({ where: { orgId, staffRole: { not: null }, usedAt: null, expiresAt: { gt: new Date() } } });
    if (used + adding > limit) {
      throw new ForbiddenException(`The ${PLANS[org.plan].name} plan allows ${limit} ${what}. Upgrade in Settings → Plan & billing.`);
    }
  }

  async createHome(user: AuthUser, input: { name: string; city?: string; timezone?: string; installerId?: string | null; owner?: { name?: string; email: string } | null; rooms?: string[] }) {
    const orgId = this.org(user);
    await this.planLimit(orgId, 'homes');
    if (input.installerId) await this.assertStaff(orgId, input.installerId, [StaffRole.INSTALLER, StaffRole.SUPERADMIN]);
    const home = await this.prisma.home.create({
      data: { orgId, name: input.name, city: input.city ?? '', timezone: input.timezone || 'Asia/Karachi', installerId: input.installerId ?? null },
    });
    const rooms = [...new Set((input.rooms ?? []).map((r) => r.trim()).filter(Boolean))].slice(0, 30);
    if (rooms.length) await this.prisma.room.createMany({ data: rooms.map((name, order) => ({ homeId: home.id, name, order })) });
    await this.audit.record(home.id, user.id, 'home.create', home.id, { name: home.name, city: home.city, owner: input.owner?.email ?? null });
    let invite: { token: string; path: string } | null = null;
    if (input.owner?.email) invite = await this.ownerInvite(user, home.id, input.owner.email.toLowerCase(), input.owner.name);
    this.realtime.homesChanged(orgId);
    return { id: home.id, name: home.name, invite };
  }

  private async ownerInvite(user: AuthUser, homeId: string, email: string, name?: string) {
    await this.prisma.invite.deleteMany({ where: { homeId, role: Role.OWNER, usedAt: null } });
    const token = randomToken();
    await this.prisma.invite.create({
      data: { homeId, email, name: name || null, role: Role.OWNER, tokenHash: sha256(token), createdBy: user.id, expiresAt: new Date(Date.now() + INVITE_TTL_MS) },
    });
    await this.audit.record(homeId, user.id, 'user.invite', email, { role: Role.OWNER, name });
    return { token, path: `/invite/${token}` };
  }

  async updateHome(user: AuthUser, id: string, input: { name?: string; city?: string; timezone?: string; installerId?: string | null; archived?: boolean }) {
    const orgId = this.org(user);
    const home = await this.prisma.home.findFirst({ where: { id, orgId } });
    if (!home) throw new NotFoundException('No such home.');
    if (input.installerId) await this.assertStaff(orgId, input.installerId, [StaffRole.INSTALLER, StaffRole.SUPERADMIN]);
    if (input.archived === false && home.archivedAt) await this.planLimit(orgId, 'homes');
    const data: Prisma.HomeUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.city !== undefined) data.city = input.city;
    if (input.timezone !== undefined) data.timezone = input.timezone;
    if (input.installerId !== undefined) data.installer = input.installerId ? { connect: { id: input.installerId } } : { disconnect: true };
    if (input.archived !== undefined) data.archivedAt = input.archived ? new Date() : null;
    await this.prisma.home.update({ where: { id }, data });
    // the previous installer's open sockets must not keep receiving this home's live data
    if (home.installerId && (input.installerId !== undefined && input.installerId !== home.installerId || input.archived)) this.realtime.accessChanged(home.installerId);
    if (input.installerId !== undefined) {
      await this.prisma.node.updateMany({ where: { homeId: id, status: NodeStatus.ASSIGNED }, data: { installerId: input.installerId } });
    }
    await this.audit.record(id, user.id, input.archived !== undefined ? (input.archived ? 'home.archive' : 'home.restore') : 'home.update', id, input);
    this.realtime.homesChanged(orgId);
    return { ok: true };
  }

  /** Everything the home workspace shows on its overview, boards and rooms tabs. */
  async workspace(user: AuthUser, id: string) {
    const home = await this.prisma.home.findFirst({
      where: { ...this.homeWhere(user), id },
      include: {
        installer: { select: { id: true, name: true, email: true } },
        memberships: { include: { user: { select: { id: true, name: true, email: true, phone: true } } } },
        invites: { where: { usedAt: null, expiresAt: { gt: new Date() } }, select: { id: true, email: true, name: true, role: true, createdAt: true } },
        rooms: { orderBy: [{ order: 'asc' }, { name: 'asc' }], include: { devices: { include: { state: true, node: { select: { id: true, name: true, online: true } } } } } },
        nodes: { include: { _count: { select: { devices: true, inputs: true } } }, orderBy: [{ status: 'asc' }, { createdAt: 'asc' }] },
      },
    });
    if (!home) throw new NotFoundException('No such home.');
    const facts = (await this.homeFacts([home.id])).get(home.id)!;
    const health = await this.healthMap(home.nodes.map((n) => n.id));
    const fw = await this.currentFirmware(home.orgId);
    const stepsDone = this.stepsDone(facts);
    const owner = home.memberships.find((m) => m.role === Role.OWNER)?.user ?? null;
    const ownerInvite = home.invites.find((i) => i.role === Role.OWNER) ?? null;

    const boards = home.nodes.map((n) => {
      const c = condition(n, health.get(n.id) ?? null);
      const h = health.get(n.id);
      const pinsTotal = BOARDS[n.board]?.pins.length ?? 11;
      return {
        id: n.id, name: n.name, location: n.status === NodeStatus.ADOPTED ? n.name : null, board: n.board, model: BOARDS[n.board]?.name ?? n.board,
        status: n.status, online: n.online, cond: c.cond, condText: c.text, firmware: n.firmware, firmwareOld: !!(fw && n.firmware && compareVersions(n.firmware, fw) < 0),
        devices: n._count.devices, pinsUsed: n._count.devices + n._count.inputs, pinsTotal,
        rssi: h?.rssi ?? n.rssi, vcc: h?.vcc ?? null, lastSeenAt: n.lastSeenAt, lastSeen: ago(n.lastSeenAt),
      };
    });
    const rooms = home.rooms.map((r) => {
      const boardsInRoom = [...new Set(r.devices.map((d) => d.node.id))];
      return {
        id: r.id, name: r.name, devices: r.devices.length,
        on: r.devices.filter((d) => (d.state?.state as { on?: boolean } | null)?.on === true && d.node.online).length,
        offline: r.devices.some((d) => !d.node.online), boards: boardsInRoom,
      };
    });
    const unroomed = await this.prisma.device.count({ where: { node: { homeId: home.id }, roomId: null } });

    const flags = this.stepFlags(facts);
    const next = flags.indexOf(false);
    const steps = STEP_TITLES.map(([title, detail, action], i) => ({
      n: i + 1, title, detail, action, done: flags[i]!, current: i === next,
    }));
    // a more useful line under each finished step
    if (flags[1]) steps[1]!.detail = `${facts.boards} board${facts.boards === 1 ? '' : 's'} from inventory`;
    if (flags[2]) steps[2]!.detail = `${facts.online} of ${facts.installed} online`;
    if (flags[3]) steps[3]!.detail = `${facts.devices} devices`;
    if (flags[4]) steps[4]!.detail = `${rooms.length} rooms${unroomed ? ` · ${unroomed} devices without a room` : ''}`;
    if (owner) steps[5]!.detail = `${owner.name} joined`;
    else if (ownerInvite) steps[5]!.detail = `Invite sent to ${ownerInvite.name || ownerInvite.email} ${ago(ownerInvite.createdAt)}`;

    const worst = boards.find((b) => b.status === NodeStatus.ADOPTED && b.cond === 'bad') ?? boards.find((b) => b.status === NodeStatus.ADOPTED && b.cond === 'warn');
    const status = home.archivedAt ? 'archived' : worst ? 'attention' : stepsDone < 6 ? 'setup' : 'live';
    return {
      home: {
        id: home.id, name: home.name, city: home.city, timezone: home.timezone, archived: !!home.archivedAt, createdAt: home.createdAt,
        owner: owner ? { id: owner.id, name: owner.name, email: owner.email, phone: owner.phone ?? null } : null,
        ownerInvite: ownerInvite ? { email: ownerInvite.email, name: ownerInvite.name, sentAt: ownerInvite.createdAt } : null,
        installer: home.installer, status,
        statusLabel: status === 'live' ? 'Live' : status === 'setup' ? 'Setting up' : status === 'archived' ? 'Archived' : worst!.condText.startsWith('Offline') ? 'Board offline' : worst!.condText,
        tone: status === 'live' ? 'ok' : status === 'setup' ? 'info' : status === 'archived' ? 'mute' : worst!.cond,
      },
      steps, stepsDone,
      stats: { boardsOnline: facts.online, boardsTotal: facts.boards, devices: facts.devices, people: facts.people + (home.installer ? 1 : 0) },
      boards, rooms, unroomed, currentFirmware: fw,
    };
  }

  // ================================================================ inventory
  async inventory(user: AuthUser) {
    const orgId = this.org(user);
    const [nodes, homes, installers, fw] = await Promise.all([
      this.prisma.node.findMany({
        where: { orgId },
        include: { home: { select: { id: true, name: true } }, installer: { select: { id: true, name: true } }, _count: { select: { devices: true } } },
        orderBy: [{ createdAt: 'desc' }],
      }),
      this.prisma.home.findMany({ where: { orgId, archivedAt: null }, select: { id: true, name: true, installerId: true }, orderBy: { name: 'asc' } }),
      this.prisma.user.findMany({ where: { orgId, staffRole: { in: [StaffRole.INSTALLER, StaffRole.SUPERADMIN] }, disabled: false }, select: { id: true, name: true, staffRole: true }, orderBy: { name: 'asc' } }),
      this.currentFirmware(orgId),
    ]);
    const health = await this.healthMap(nodes.map((n) => n.id));
    return {
      boards: nodes.map((n) => {
        const c = condition(n, health.get(n.id) ?? null);
        return {
          id: n.id, board: n.board, model: BOARDS[n.board]?.name ?? n.board, status: n.status,
          homeId: n.homeId, homeName: n.home?.name ?? null, location: n.status === NodeStatus.ADOPTED ? n.name : null,
          installerId: n.installer?.id ?? null, installer: n.installer?.name ?? null,
          firmware: n.firmware, firmwareOld: !!(fw && n.firmware && compareVersions(n.firmware, fw) < 0), mac: n.mac, ip: n.ip,
          online: n.online, lastSeen: ago(n.lastSeenAt), cond: c.cond, condText: c.text, note: n.note,
          devices: n._count.devices, addedAt: n.createdAt, added: new Date(n.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
        };
      }),
      homes, installers, currentFirmware: fw,
      models: Object.values(BOARDS).map((b) => ({ type: b.type, name: b.name })),
      stock: await this.stock.level(orgId),
    };
  }

  private async nodeOf(orgId: string, id: string) {
    const node = await this.prisma.node.findFirst({ where: { id, orgId } });
    if (!node) throw new NotFoundException('No such board in your inventory.');
    return node;
  }

  /** Registers boards by the ID printed on them (or shown on their setup page). Boards that already announced are claimed. */
  async addStock(user: AuthUser, ids: string[], board: string, note?: string) {
    const orgId = this.org(user);
    if (!BOARDS[board]) throw new BadRequestException('Unknown board model.');
    const clean = [...new Set(ids.map((i) => i.trim()).filter(Boolean))];
    if (!clean.length) throw new BadRequestException('Enter at least one board ID.');
    const bad = clean.find((i) => !isSafeId(i));
    if (bad) throw new BadRequestException(`“${bad}” is not a valid board ID (letters, digits, - and _ only).`);
    const existing = await this.prisma.node.findMany({ where: { id: { in: clean } } });
    const theirs = existing.find((n) => n.orgId && n.orgId !== orgId);
    if (theirs) throw new ConflictException(`${theirs.id} is registered to another organization.`);
    const fresh = clean.filter((id) => !existing.some((n) => n.id === id && n.orgId === orgId));
    await this.planLimit(orgId, 'boards', fresh.length);
    for (const id of fresh) {
      const known = existing.find((n) => n.id === id);
      if (known) await this.prisma.node.update({ where: { id }, data: { orgId, board, note: note ?? known.note } });
      else await this.prisma.node.create({ data: { id, orgId, name: id, board, status: NodeStatus.STOCK, note: note ?? null } });
      await this.nodes.publishConfig(id);
    }
    if (fresh.length) await this.audit.record(null, user.id, 'board.stock', fresh.join(', '), { count: fresh.length, board }, orgId);
    await this.stock.check(orgId);
    this.realtime.inventoryChanged(orgId);
    return { added: fresh.length, skipped: clean.length - fresh.length };
  }

  async assign(user: AuthUser, id: string, homeId: string, installerId?: string | null) {
    const orgId = this.org(user);
    const node = await this.nodeOf(orgId, id);
    if (node.status !== NodeStatus.STOCK) throw new BadRequestException('Only boards in stock can be assigned. Send it back to stock first.');
    const home = await this.prisma.home.findFirst({ where: { id: homeId, orgId, archivedAt: null } });
    if (!home) throw new NotFoundException('No such home.');
    const installer = installerId ?? home.installerId;
    if (installer) await this.assertStaff(orgId, installer, [StaffRole.INSTALLER, StaffRole.SUPERADMIN]);
    await this.prisma.node.update({ where: { id }, data: { status: NodeStatus.ASSIGNED, homeId, installerId: installer ?? null, assignedAt: new Date(), name: id } });
    // The installer picked here does the job, so the home becomes theirs: it shows in their "My jobs" and
    // they may open it. (Before, only the board remembered them, and a home that already had an installer,
    // e.g. the super admin who created it, stayed invisible to them.) One installer per home.
    if (installer && installer !== home.installerId) {
      await this.prisma.home.update({ where: { id: homeId }, data: { installerId: installer } });
      await this.prisma.node.updateMany({ where: { homeId, status: NodeStatus.ASSIGNED }, data: { installerId: installer } });
      if (home.installerId) this.realtime.accessChanged(home.installerId);
    }
    await this.nodes.publishConfig(id);
    const who = installer ? (await this.prisma.user.findUnique({ where: { id: installer }, select: { name: true } }))?.name : null;
    await this.audit.record(homeId, user.id, 'board.assign', id, { home: home.name, installer: who });
    await this.stock.check(orgId);
    this.realtime.inventoryChanged(orgId);
    this.realtime.nodesChanged(homeId, id);
    this.realtime.homesChanged(orgId);
    return { ok: true };
  }

  async unassign(user: AuthUser, id: string) {
    const orgId = this.org(user);
    const node = await this.nodeOf(orgId, id);
    if (node.status !== NodeStatus.ASSIGNED) throw new BadRequestException('Only assigned boards can go back to stock here. Installed boards are removed from the home’s Boards tab.');
    await this.nodes.release(id);
    await this.audit.record(node.homeId, user.id, 'board.unassign', id, {}, orgId);
    await this.stock.check(orgId);
    this.realtime.inventoryChanged(orgId);
    if (node.homeId) this.realtime.nodesChanged(node.homeId, id);
    return { ok: true };
  }

  async markFaulty(user: AuthUser, id: string, note: string) {
    const orgId = this.org(user);
    const node = await this.nodeOf(orgId, id);
    const wasIn = node.homeId;
    await this.nodes.release(id, undefined, NodeStatus.FAULTY, note || 'Marked faulty');
    await this.audit.record(wasIn, user.id, 'board.faulty', id, { note }, orgId);
    await this.stock.check(orgId);
    this.realtime.inventoryChanged(orgId);
    if (wasIn) { this.realtime.nodesChanged(wasIn, id); this.realtime.devicesChanged(wasIn); }
    return { ok: true };
  }

  async restock(user: AuthUser, id: string) {
    const orgId = this.org(user);
    const node = await this.nodeOf(orgId, id);
    if (node.status !== NodeStatus.FAULTY) throw new BadRequestException('Only faulty boards can be put back in stock.');
    await this.prisma.node.update({ where: { id }, data: { status: NodeStatus.STOCK, note: null } });
    await this.audit.record(null, user.id, 'board.restock', id, {}, orgId);
    await this.stock.check(orgId);
    this.realtime.inventoryChanged(orgId);
    return { ok: true };
  }

  /** Returned to the supplier: it leaves the inventory. */
  async retire(user: AuthUser, id: string) {
    const orgId = this.org(user);
    const node = await this.nodeOf(orgId, id);
    if (node.status !== NodeStatus.FAULTY && node.status !== NodeStatus.STOCK) throw new BadRequestException('Only boards in stock or marked faulty can be returned.');
    await this.nodes.release(id);
    await this.prisma.node.delete({ where: { id } });
    await this.audit.record(null, user.id, 'board.retire', id, { note: node.note }, orgId);
    await this.stock.check(orgId);
    this.realtime.inventoryChanged(orgId);
  }

  // ================================================================ staff
  private async assertStaff(orgId: string, userId: string, roles: StaffRole[]) {
    const u = await this.prisma.user.findFirst({ where: { id: userId, orgId, staffRole: { in: roles }, disabled: false } });
    if (!u) throw new BadRequestException('Pick an installer from your team.');
    return u;
  }

  async staff(user: AuthUser) {
    const orgId = this.org(user);
    const [people, invites, homes] = await Promise.all([
      this.prisma.user.findMany({ where: { orgId, staffRole: { not: null } }, orderBy: [{ staffRole: 'asc' }, { name: 'asc' }] }),
      this.prisma.invite.findMany({ where: { orgId, staffRole: { not: null }, usedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } }),
      this.prisma.home.groupBy({ by: ['installerId'], where: { orgId, archivedAt: null, installerId: { not: null } }, _count: true }),
    ]);
    return {
      people: people.map((p) => ({
        id: p.id, name: p.name, email: p.email, staffRole: p.staffRole!, roleLabel: STAFF_LABEL[p.staffRole!], disabled: p.disabled,
        homes: homes.find((h) => h.installerId === p.id)?._count ?? 0, since: p.createdAt, me: p.id === user.id, twoFactor: !!p.totpEnabledAt,
      })),
      invites: invites.map((i) => ({ id: i.id, email: i.email, name: i.name, staffRole: i.staffRole!, sentAt: i.createdAt, expiresAt: i.expiresAt })),
    };
  }

  async inviteStaff(user: AuthUser, email: string, staffRole: StaffRole, name?: string) {
    const orgId = this.org(user);
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing?.orgId === orgId && existing.staffRole) throw new ConflictException('This person is already on your team.');
    if (existing?.staffRole && existing.orgId !== orgId) throw new ConflictException('This person works for another organization.');
    await this.prisma.invite.deleteMany({ where: { orgId, email, usedAt: null } });
    await this.planLimit(orgId, 'staff');
    const token = randomToken();
    await this.prisma.invite.create({
      data: { orgId, email, name: name || null, staffRole, tokenHash: sha256(token), createdBy: user.id, expiresAt: new Date(Date.now() + INVITE_TTL_MS) },
    });
    await this.audit.record(null, user.id, 'staff.invite', email, { staffRole, name }, orgId);
    return { token, path: `/invite/${token}`, expiresInDays: 7, existingAccount: !!existing };
  }

  async revokeStaffInvite(user: AuthUser, id: string) {
    const orgId = this.org(user);
    await this.prisma.invite.deleteMany({ where: { id, orgId } });
  }

  async updateStaff(user: AuthUser, id: string, input: { staffRole?: StaffRole; disabled?: boolean }) {
    const orgId = this.org(user);
    if (id === user.id) throw new BadRequestException('You cannot change your own role. Ask another super admin.');
    const target = await this.prisma.user.findFirst({ where: { id, orgId, staffRole: { not: null } } });
    if (!target) throw new NotFoundException('No such person on your team.');
    await this.prisma.user.update({ where: { id }, data: input });
    if (input.disabled) await this.prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    if (input.staffRole && input.staffRole !== StaffRole.INSTALLER && target.staffRole === StaffRole.INSTALLER && input.staffRole !== StaffRole.SUPERADMIN) {
      await this.prisma.home.updateMany({ where: { orgId, installerId: id }, data: { installerId: null } });
    }
    await this.audit.record(null, user.id, 'role.update', id, { name: target.name, from: target.staffRole, to: input.staffRole, disabled: input.disabled }, orgId);
    this.realtime.accessChanged(id);
    return { ok: true };
  }

  async removeStaff(user: AuthUser, id: string) {
    const orgId = this.org(user);
    if (id === user.id) throw new BadRequestException('You cannot remove yourself.');
    const target = await this.prisma.user.findFirst({ where: { id, orgId, staffRole: { not: null } }, include: { _count: { select: { memberships: true } } } });
    if (!target) throw new NotFoundException('No such person on your team.');
    await this.prisma.home.updateMany({ where: { orgId, installerId: id }, data: { installerId: null } });
    await this.prisma.node.updateMany({ where: { orgId, installerId: id }, data: { installerId: null } });
    if (target._count.memberships) await this.prisma.user.update({ where: { id }, data: { orgId: null, staffRole: null } });
    else await this.prisma.user.delete({ where: { id } });
    await this.audit.record(null, user.id, 'staff.remove', id, { name: target.name, email: target.email }, orgId);
    this.realtime.accessChanged(id);
  }

  // ================================================================ roles (people per role)
  async roleCounts(user: AuthUser) {
    const orgId = this.org(user);
    const [staff, members] = await Promise.all([
      this.prisma.user.groupBy({ by: ['staffRole'], where: { orgId, staffRole: { not: null } }, _count: true }),
      this.prisma.membership.groupBy({ by: ['role'], where: { home: { orgId } }, _count: true }),
    ]);
    const out: Record<string, number> = { SUPERADMIN: 0, INSTALLER: 0, SUPPORT: 0, OWNER: 0, ADMIN: 0, MEMBER: 0, GUEST: 0 };
    for (const s of staff) out[s.staffRole!] = s._count;
    for (const m of members) out[m.role] = m._count;
    return out;
  }

  // ================================================================ audit
  /** The organization's log (installers: only the homes they look after), optionally one home. */
  async auditFor(user: AuthUser, home: string | undefined, category: string | undefined, limit: number) {
    const orgId = this.org(user);
    let homeFilter: Prisma.AuditLogWhereInput = home ? { homeId: home } : {};
    if (user.staffRole === StaffRole.INSTALLER) {
      const mine = (await this.prisma.home.findMany({ where: { orgId, installerId: user.id }, select: { id: true } })).map((h) => h.id);
      homeFilter = { homeId: { in: home ? mine.filter((h) => h === home) : mine } };
    }
    return this.auditRows({ orgId, ...homeFilter }, category, limit);
  }

  async auditRows(where: Prisma.AuditLogWhereInput, category: string | undefined, limit: number) {
    const rows = await this.prisma.auditLog.findMany({ where, orderBy: { at: 'desc' }, take: Math.min(limit * (category && category !== 'all' ? 4 : 1), 2000) });
    const userIds = [...new Set(rows.map((r) => r.userId).filter((x): x is string => !!x))];
    const homeIds = [...new Set(rows.map((r) => r.homeId).filter((x): x is string => !!x))];
    const [users, homes, memberships] = await Promise.all([
      this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, staffRole: true } }),
      this.prisma.home.findMany({ where: { id: { in: homeIds } }, select: { id: true, name: true } }),
      this.prisma.membership.findMany({ where: { userId: { in: userIds }, homeId: { in: homeIds } }, select: { userId: true, homeId: true, role: true } }),
    ]);
    const deviceIds = rows.filter((r) => r.action.startsWith('device.') || r.action === 'user.update' || r.action === 'room.access' || r.action === 'user.remove').map((r) => r.target);
    const [devices, people] = await Promise.all([
      this.prisma.device.findMany({ where: { id: { in: deviceIds } }, select: { id: true, name: true, nodeId: true, pin: true, node: { select: { board: true } } } }),
      this.prisma.user.findMany({ where: { id: { in: deviceIds } }, select: { id: true, name: true } }),
    ]);
    const out = rows
      .map((r) => {
        const u = r.userId ? users.find((x) => x.id === r.userId) : null;
        const m = memberships.find((x) => x.userId === r.userId && x.homeId === r.homeId);
        const who = u?.name ?? (r.userId ? 'Deleted user' : 'System');
        const role = !r.userId ? 'Automatic' : m && !u?.staffRole ? ROLE_LABEL[m.role] : u?.staffRole ? STAFF_LABEL[u.staffRole] : m ? ROLE_LABEL[m.role] : '';
        return {
          id: String(r.id), at: r.at, when: ago(r.at), who, role, system: !r.userId, action: r.action, category: auditCategory(r.action),
          target: this.describe(r.action, r.target, r.details as Record<string, unknown>, { devices, people }),
          homeId: r.homeId, homeName: r.homeId ? homes.find((h) => h.id === r.homeId)?.name ?? 'Deleted home' : 'Platform',
        };
      })
      .filter((r) => !category || category === 'all' || r.category === category);
    return out.slice(0, limit);
  }

  /** One readable line for an audit entry. */
  private describe(action: string, target: string, d: Record<string, unknown>, ctx: { devices: { id: string; name: string; nodeId: string; pin: number }[]; people: { id: string; name: string }[] }) {
    const dev = ctx.devices.find((x) => x.id === target);
    const person = ctx.people.find((x) => x.id === target);
    const s = (k: string) => (d[k] === undefined || d[k] === null ? '' : String(d[k]));
    switch (action) {
      case 'device.create': return `${s('name') || dev?.name || target} → ${s('nodeId')} · ${s('pinLabel') || `GPIO ${s('pin')}`}`;
      case 'device.rename': return `“${s('from')}” → “${s('to')}”`;
      case 'device.update': return `${s('name') || dev?.name || target}${d.pin !== undefined ? ` · pin changed` : ''}${d.roomId !== undefined ? ' · moved room' : ''}`;
      case 'device.remove': return `${s('name') || target} · ${s('nodeId')}`;
      case 'board.offline': case 'board.online': return `${target} · ${s('name')}`;
      case 'board.assign': return `${target} → ${s('home')}${s('installer') ? ` · ${s('installer')}` : ''}`;
      case 'board.install': return `${target} · ${s('name')}`;
      case 'board.stock': return `${s('count')} board${Number(d.count) === 1 ? '' : 's'} · ${target}`;
      case 'board.faulty': return `${target}${s('note') ? ` · ${s('note')}` : ''}`;
      case 'home.create': return `${s('name')}${s('owner') ? ` · owner ${s('owner')}` : ''}`;
      case 'user.invite': return `${target} as ${d.role ? ROLE_LABEL[d.role as Role] : ''}${s('name') ? ` · ${s('name')}` : ''}`;
      case 'staff.invite': return `${target} as ${d.staffRole ? STAFF_LABEL[d.staffRole as StaffRole] : ''}`;
      case 'room.access': {
        const rooms = (d.rooms as { room: string; access: string }[] | undefined) ?? [];
        const lbl: Record<string, string> = { VIEW: 'Can see', CONTROL: 'Can switch', MANAGE: 'Switch & rename' };
        return `${s('name') || person?.name || target} · ${rooms.length ? rooms.map((r) => `${r.room} → ${lbl[r.access] ?? r.access}`).join(', ') : 'no rooms'}`;
      }
      case 'user.update': return `${s('name') || person?.name || target}${d.role ? ` → ${ROLE_LABEL[d.role as Role]}` : ''}${d.disabled !== undefined ? (d.disabled ? ' · disabled' : ' · enabled') : ''}`;
      case 'user.remove': case 'staff.remove': return `${s('name') || s('email') || target}`;
      case 'role.update': return `${s('name')} → ${d.to ? STAFF_LABEL[d.to as StaffRole] : d.disabled ? 'disabled' : 'enabled'}`;
      case 'invite.accept': case 'staff.join': return `${s('name')} joined${d.role ? ` as ${ROLE_LABEL[d.role as Role] ?? STAFF_LABEL[d.role as StaffRole] ?? d.role}` : ''}`;
      case 'room.create': return `${s('name')}`;
      case 'scene.create': case 'scene.run': case 'schedule.create': case 'schedule.remove': return `${s('name')}${s('result') ? ` · ${s('result')}` : ''}`;
      case 'plan.change': return `${s('from')} → ${s('to')}`;
      case 'support.request': return s('message').slice(0, 120);
      case 'visit.requested': return `${s('name')} · ${s('city')} · ${s('homeSize')}`;
      case 'visit.update': return `${s('name')} → ${VISIT_STATUS_LABEL[d.to as VisitStatus] ?? s('to')}`;
      default: {
        const name = s('name');
        return name ? `${target} · ${name}` : target;
      }
    }
  }

  // ================================================================ organization and billing
  async organization(user: AuthUser) {
    const orgId = this.org(user);
    const [org, homes, boards, staff] = await Promise.all([
      this.prisma.organization.findUniqueOrThrow({ where: { id: orgId } }),
      this.prisma.home.count({ where: { orgId, archivedAt: null } }),
      this.prisma.node.count({ where: { orgId, status: { not: NodeStatus.FAULTY } } }),
      this.prisma.user.count({ where: { orgId, staffRole: { not: null } } }),
    ]);
    return {
      id: org.id, name: org.name, plan: org.plan, status: org.status, trialEndsAt: org.trialEndsAt,
      billingEmail: org.billingEmail, billingName: org.billingName, taxId: org.taxId, country: org.country, createdAt: org.createdAt,
      logo: org.logo, cities: org.cities, teamSize: org.teamSize, onboarded: !!org.onboardedAt,
      bankAccount: org.bankAccount, jazzcashNumber: org.jazzcashNumber, easypaisaNumber: org.easypaisaNumber,
      baseLat: org.baseLat, baseLng: org.baseLng, stockMin: org.stockMin,
      usage: { homes, boards, staff },
      selfHosted: org.selfHosted,
      limits: org.selfHosted
        ? { homes: null, boards: null, staff: null }
        : { homes: PLANS[org.plan].homes, boards: PLANS[org.plan].boards, staff: PLANS[org.plan].staff },
      plans: PLAN_ORDER.map((p) => ({ id: p, ...PLANS[p] })),
      paymentsConnected: false,
    };
  }

  async updateOrganization(user: AuthUser, input: {
    name?: string; billingEmail?: string | null; billingName?: string | null; taxId?: string | null; country?: string | null;
    logo?: string | null; cities?: string[]; teamSize?: string | null; onboarded?: boolean;
    bankAccount?: string | null; jazzcashNumber?: string | null; easypaisaNumber?: string | null;
    baseLat?: number | null; baseLng?: number | null; stockMin?: number;
  }) {
    const orgId = this.org(user);
    const { onboarded, cities, ...rest } = input;
    if ((input.baseLat === undefined) !== (input.baseLng === undefined) || (input.baseLat === null) !== (input.baseLng === null)) {
      throw new BadRequestException('Give both the latitude and the longitude of your base.');
    }
    for (const k of ['jazzcashNumber', 'easypaisaNumber'] as const) {
      if (input[k] && !normalisePhone(input[k])) throw new BadRequestException(`That ${k === 'jazzcashNumber' ? 'JazzCash' : 'Easypaisa'} number doesn't look right. Write it like 0300 1234567.`);
    }
    await this.prisma.organization.update({
      where: { id: orgId },
      data: { ...rest, ...(cities ? { cities: [...new Set(cities)] } : {}), ...(onboarded !== undefined ? { onboardedAt: onboarded ? new Date() : null } : {}) },
    });
    // the logo itself is too big for the log: just say it changed
    const logged: Record<string, unknown> = { ...input };
    if ('logo' in logged) logged.logo = input.logo ? 'changed' : 'removed';
    await this.audit.record(null, user.id, 'org.update', orgId, logged, orgId);
    if (input.name !== undefined || input.logo !== undefined) this.realtime.homesChanged(orgId);
    if (input.stockMin !== undefined) await this.stock.check(orgId);
    return this.organization(user);
  }

  async changePlan(user: AuthUser, plan: Plan) {
    const orgId = this.org(user);
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
    if (org.selfHosted) throw new BadRequestException('Your own company has no plans: homes, boards and staff are unlimited.');
    const usage = (await this.organization(user)).usage;
    const limits = PLANS[plan];
    const over = (['homes', 'boards', 'staff'] as const).find((k) => limits[k] !== null && usage[k] > limits[k]!);
    if (over) throw new BadRequestException(`You have ${usage[over]} ${over}; the ${limits.name} plan allows ${limits[over]}. Remove some first.`);
    await this.prisma.organization.update({ where: { id: orgId }, data: { plan, status: OrgStatus.ACTIVE, trialEndsAt: org.status === OrgStatus.TRIAL ? org.trialEndsAt : null } });
    await this.audit.record(null, user.id, 'plan.change', orgId, { from: PLANS[org.plan].name, to: limits.name }, orgId);
    return this.organization(user);
  }

  // ================================================================ search (⌘K)
  async search(user: AuthUser, q: string) {
    const orgId = this.org(user);
    const term = q.trim();
    if (term.length < 2) return { homes: [], boards: [], people: [] };
    const mine = this.homeWhere(user);
    const [homes, boards, people] = await Promise.all([
      this.prisma.home.findMany({ where: { ...mine, OR: [{ name: { contains: term, mode: 'insensitive' } }, { city: { contains: term, mode: 'insensitive' } }] }, take: 6, select: { id: true, name: true, city: true } }),
      user.staffRole === StaffRole.INSTALLER
        ? this.prisma.node.findMany({ where: { orgId, home: { installerId: user.id }, OR: [{ id: { contains: term, mode: 'insensitive' } }, { name: { contains: term, mode: 'insensitive' } }] }, take: 6, select: { id: true, name: true, status: true, homeId: true, home: { select: { name: true } } } })
        : this.prisma.node.findMany({ where: { orgId, OR: [{ id: { contains: term, mode: 'insensitive' } }, { name: { contains: term, mode: 'insensitive' } }, { mac: { contains: term, mode: 'insensitive' } }] }, take: 6, select: { id: true, name: true, status: true, homeId: true, home: { select: { name: true } } } }),
      this.prisma.membership.findMany({
        where: { home: mine, user: { OR: [{ name: { contains: term, mode: 'insensitive' } }, { email: { contains: term, mode: 'insensitive' } }] } },
        take: 6, include: { user: { select: { id: true, name: true, email: true } }, home: { select: { id: true, name: true } } },
      }),
    ]);
    return {
      homes,
      boards: boards.map((b) => ({ id: b.id, name: b.name, status: b.status, homeId: b.homeId, homeName: b.home?.name ?? null })),
      people: people.map((p) => ({ id: p.user.id, name: p.user.name, email: p.user.email, role: ROLE_LABEL[p.role], homeId: p.home.id, homeName: p.home.name })),
    };
  }
}

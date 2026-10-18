import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { NodeStatus, Prisma, RolloutStatus, StaffRole, TargetStatus } from '@prisma/client';
import { AuthUser } from '../auth/auth.types';
import { zoneOffsetMinutes } from '../automation/time';
import { AuditService } from '../common/audit.service';
import { MonitoringService } from '../monitoring/monitoring.service';
import { PrismaService } from '../prisma/prisma.service';
import { FirmwareService } from './firmware.service';

const TICK_MS = Number(process.env.ROLLOUT_TICK_MS) || 20_000;
const ANSWER_MS = 10 * 60_000;
const WEAK_DBM = -80;
const DAY_FROM = 10;
const DAY_TO = 17;

export interface RolloutInput { firmwareId: string; waveSize?: number; waveGapMin?: number; maxFailures?: number; daytimeOnly?: boolean; skipWeak?: boolean }

/** Waves: the first is one board (the strongest signal, online), then `size` at a time. */
export function planWaves<T extends { id: string; online: boolean; rssi: number | null; homeId: string | null }>(nodes: T[], size: number): (T & { wave: number })[] {
  const order = [...nodes].sort((a, b) => Number(b.online) - Number(a.online) || (b.rssi ?? -200) - (a.rssi ?? -200));
  const [first, ...rest] = order;
  if (!first) return [];
  // the rest grouped by home, so a home's boards update together
  rest.sort((a, b) => (a.homeId ?? '').localeCompare(b.homeId ?? ''));
  return [{ ...first, wave: 0 }, ...rest.map((n, i) => ({ ...n, wave: 1 + Math.floor(i / Math.max(1, size)) }))];
}

/** Is it daytime at the home (10:00 to 17:00)? Updates restart boards; better when people are awake and around. */
export function daytime(timeZone: string, at = new Date()) {
  const h = new Date(at.getTime() + zoneOffsetMinutes(timeZone, at) * 60_000).getUTCHours();
  return h >= DAY_FROM && h < DAY_TO;
}

/**
 * Staged firmware rollouts: one board first, a pause to watch it, then waves of a few boards, with
 * a pause after each. Any failure (up to `maxFailures`) halts everything until a person looks.
 * Offline and weak-signal boards are skipped (they can be retried); updates go out in the daytime.
 */
@Injectable()
export class RolloutService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Rollout');
  private timer?: NodeJS.Timeout;
  private ticking = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly firmware: FirmwareService,
    private readonly monitoring: MonitoringService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit() {
    this.firmware.onResult((nodeId, ok, version, message) => this.result(nodeId, ok, version, message));
    this.timer = setInterval(() => void this.tick(), TICK_MS);
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  private org(staff: AuthUser) {
    if (!staff.orgId) throw new ForbiddenException('For platform staff.');
    return staff.orgId;
  }

  // ---------------------------------------------------------------- reading
  async list(staff: AuthUser) {
    const orgId = this.org(staff);
    const rows = await this.prisma.rollout.findMany({ where: { orgId }, include: { targets: true }, orderBy: { createdAt: 'desc' }, take: 20 });
    const nodeIds = [...new Set(rows.flatMap((r) => r.targets.map((t) => t.nodeId)))];
    const nodes = new Map((await this.prisma.node.findMany({
      where: { id: { in: nodeIds } }, select: { id: true, name: true, online: true, firmware: true, rssi: true, home: { select: { name: true } } },
    })).map((n) => [n.id, n]));
    const images = await this.prisma.firmwareImage.findMany({ where: { OR: [{ orgId }, { orgId: null }] }, select: { id: true, version: true, notes: true, createdAt: true }, orderBy: { createdAt: 'desc' } });
    return {
      images,
      canEdit: staff.staffRole === StaffRole.SUPERADMIN,
      rollouts: rows.map((r) => {
        const count = (s: TargetStatus) => r.targets.filter((t) => t.status === s).length;
        const waves = Math.max(0, ...r.targets.map((t) => t.wave)) + 1;
        return {
          id: r.id, version: r.version, status: r.status, wave: r.wave, waves, waveSize: r.waveSize, waveGapMin: r.waveGapMin, maxFailures: r.maxFailures,
          daytimeOnly: r.daytimeOnly, skipWeak: r.skipWeak, nextWaveAt: r.nextWaveAt, haltReason: r.haltReason, createdAt: r.createdAt, finishedAt: r.finishedAt,
          counts: { total: r.targets.length, pending: count('PENDING'), sent: count('SENT'), done: count('DONE'), failed: count('FAILED'), skipped: count('SKIPPED') },
          targets: r.targets.sort((a, b) => a.wave - b.wave).map((t) => {
            const n = nodes.get(t.nodeId);
            return { id: t.id, nodeId: t.nodeId, name: n?.name ?? t.nodeId, home: n?.home?.name ?? null, homeId: t.homeId, online: n?.online ?? false, rssi: n?.rssi ?? null,
              firmware: n?.firmware ?? null, wave: t.wave, status: t.status, fromVersion: t.fromVersion, sentAt: t.sentAt, doneAt: t.doneAt, note: t.note };
          }),
        };
      }),
    };
  }

  // ---------------------------------------------------------------- starting and steering
  async create(staff: AuthUser, input: RolloutInput) {
    const orgId = this.org(staff);
    if (staff.staffRole !== StaffRole.SUPERADMIN) throw new ForbiddenException('Only a super admin can roll out firmware.');
    const image = await this.prisma.firmwareImage.findFirst({ where: { id: input.firmwareId, OR: [{ orgId }, { orgId: null }] } });
    if (!image) throw new NotFoundException('No such firmware.');
    const busy = await this.prisma.rollout.findFirst({ where: { orgId, status: { in: [RolloutStatus.RUNNING, RolloutStatus.PAUSED, RolloutStatus.HALTED] } } });
    if (busy) throw new BadRequestException(`A rollout of ${busy.version} isn't finished. Finish or cancel it first.`);
    const nodes = await this.prisma.node.findMany({
      where: { status: NodeStatus.ADOPTED, home: { orgId, archivedAt: null }, OR: [{ firmware: null }, { firmware: { not: image.version } }] },
      select: { id: true, online: true, rssi: true, homeId: true, firmware: true },
    });
    if (!nodes.length) throw new BadRequestException(`Every board already runs ${image.version}.`);
    const waveSize = Math.max(1, Math.min(50, input.waveSize ?? 5));
    const plan = planWaves(nodes, waveSize);
    const r = await this.prisma.rollout.create({
      data: {
        orgId, firmwareId: image.id, version: image.version, waveSize, waveGapMin: Math.max(0, Math.min(24 * 60, input.waveGapMin ?? 30)),
        maxFailures: Math.max(1, Math.min(20, input.maxFailures ?? 1)), daytimeOnly: input.daytimeOnly ?? true, skipWeak: input.skipWeak ?? true,
        createdById: staff.id, targets: { create: plan.map((n) => ({ nodeId: n.id, homeId: n.homeId, wave: n.wave, fromVersion: n.firmware })) },
      },
    });
    await this.audit.record(null, staff.id, 'firmware.rollout', r.id, { version: image.version, boards: plan.length, waveSize }, orgId);
    void this.tick();
    return this.list(staff);
  }

  async control(staff: AuthUser, id: string, action: 'pause' | 'resume' | 'cancel' | 'retry') {
    const orgId = this.org(staff);
    if (staff.staffRole !== StaffRole.SUPERADMIN) throw new ForbiddenException('Only a super admin can steer a rollout.');
    const r = await this.prisma.rollout.findFirst({ where: { id, orgId }, include: { targets: true } });
    if (!r) throw new NotFoundException('No such rollout.');
    const finished = r.status === RolloutStatus.DONE || r.status === RolloutStatus.CANCELLED;
    if (action === 'pause') {
      if (r.status !== RolloutStatus.RUNNING) throw new BadRequestException('It isn’t running.');
      await this.prisma.rollout.update({ where: { id }, data: { status: RolloutStatus.PAUSED } });
    } else if (action === 'resume') {
      if (r.status !== RolloutStatus.PAUSED && r.status !== RolloutStatus.HALTED) throw new BadRequestException('Only a paused or stopped rollout can go on.');
      // going on after a halt: the failures were looked at; they don't count again
      await this.prisma.$transaction([
        ...(r.status === RolloutStatus.HALTED ? [this.prisma.rolloutTarget.updateMany({ where: { rolloutId: id, status: TargetStatus.FAILED }, data: { status: TargetStatus.SKIPPED } })] : []),
        this.prisma.rollout.update({ where: { id }, data: { status: RolloutStatus.RUNNING, haltReason: null } }),
      ]);
    } else if (action === 'cancel') {
      if (finished) throw new BadRequestException('It has already finished.');
      await this.prisma.$transaction([
        this.prisma.rolloutTarget.updateMany({ where: { rolloutId: id, status: TargetStatus.PENDING }, data: { status: TargetStatus.SKIPPED, note: 'cancelled' } }),
        this.prisma.rollout.update({ where: { id }, data: { status: RolloutStatus.CANCELLED, finishedAt: new Date() } }),
      ]);
    } else {
      // retry the boards that were skipped or failed, as one more wave
      const again = r.targets.filter((t) => t.status === TargetStatus.SKIPPED || t.status === TargetStatus.FAILED);
      if (!again.length) throw new BadRequestException('No boards to retry.');
      const wave = Math.max(...r.targets.map((t) => t.wave)) + 1;
      await this.prisma.$transaction([
        this.prisma.rolloutTarget.updateMany({ where: { id: { in: again.map((t) => t.id) } }, data: { status: TargetStatus.PENDING, wave, note: null, sentAt: null } }),
        this.prisma.rollout.update({ where: { id }, data: { status: RolloutStatus.RUNNING, wave, nextWaveAt: null, haltReason: null, finishedAt: null } }),
      ]);
    }
    await this.audit.record(null, staff.id, `firmware.rollout.${action}`, id, { version: r.version }, orgId);
    void this.tick();
    return this.list(staff);
  }

  // ---------------------------------------------------------------- the engine
  /** A board finished (or failed) an update. */
  async result(nodeId: string, ok: boolean, version: string, message: string) {
    const t = await this.prisma.rolloutTarget.findFirst({ where: { nodeId, status: TargetStatus.SENT, rollout: { version } } });
    if (!t) return;
    await this.prisma.rolloutTarget.update({ where: { id: t.id }, data: { status: ok ? TargetStatus.DONE : TargetStatus.FAILED, doneAt: new Date(), note: ok ? null : message.slice(0, 300) } });
    void this.tick();
  }

  async tick(now = new Date()) {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const running = await this.prisma.rollout.findMany({ where: { status: RolloutStatus.RUNNING }, include: { targets: true } });
      for (const r of running) await this.step(r, now);
    } catch (err) {
      this.log.warn(`tick failed: ${(err as Error).message}`);
    } finally {
      this.ticking = false;
    }
  }

  private async step(r: Prisma.RolloutGetPayload<{ include: { targets: true } }>, now: Date) {
    // boards that never answered
    const silent = r.targets.filter((t) => t.status === TargetStatus.SENT && t.sentAt && now.getTime() - t.sentAt.getTime() > ANSWER_MS);
    for (const t of silent) {
      await this.prisma.rolloutTarget.update({ where: { id: t.id }, data: { status: TargetStatus.FAILED, doneAt: now, note: 'No answer within 10 minutes' } });
      t.status = TargetStatus.FAILED;
    }
    const failed = r.targets.filter((t) => t.status === TargetStatus.FAILED);
    if (failed.length >= r.maxFailures) {
      const names = await this.prisma.node.findMany({ where: { id: { in: failed.map((t) => t.nodeId) } }, select: { name: true } });
      const reason = `${failed.length} board${failed.length === 1 ? '' : 's'} failed (${names.map((n) => n.name).join(', ')}): ${failed[0]!.note ?? 'update failed'}`;
      await this.prisma.rollout.update({ where: { id: r.id }, data: { status: RolloutStatus.HALTED, haltReason: reason } });
      await this.tellAdmins(r.orgId, `Firmware ${r.version} rollout stopped`, `${reason}. Look at the board's log, then go on or cancel.`, 'WARN');
      return;
    }

    const wave = r.targets.filter((t) => t.wave === r.wave);
    const pending = wave.filter((t) => t.status === TargetStatus.PENDING);
    if (pending.length) {
      const nodes = new Map((await this.prisma.node.findMany({
        where: { id: { in: pending.map((t) => t.nodeId) } }, select: { id: true, online: true, rssi: true, firmware: true, home: { select: { timezone: true } } },
      })).map((n) => [n.id, n]));
      const file = await this.prisma.firmwareImage.findUnique({ where: { id: r.firmwareId }, select: { size: true, md5: true } });
      if (!file) {
        for (const t of pending) await this.prisma.rolloutTarget.update({ where: { id: t.id }, data: { status: TargetStatus.FAILED, doneAt: now, note: 'the firmware file was deleted' } });
        return;
      }
      const image = { id: r.firmwareId, version: r.version, size: file.size, md5: file.md5 };
      for (const t of pending) {
        const n = nodes.get(t.nodeId);
        const skip = (note: string) => this.prisma.rolloutTarget.update({ where: { id: t.id }, data: { status: TargetStatus.SKIPPED, note } });
        if (!n) { await skip('board removed'); continue; }
        if (n.firmware === r.version) { await this.prisma.rolloutTarget.update({ where: { id: t.id }, data: { status: TargetStatus.DONE, doneAt: now, note: 'already running it' } }); continue; }
        if (!n.online) { await skip('offline'); continue; }
        if (r.skipWeak && n.rssi !== null && n.rssi < WEAK_DBM) { await skip(`weak Wi‑Fi (${n.rssi} dBm)`); continue; }
        if (r.daytimeOnly && !daytime(n.home?.timezone ?? 'Asia/Karachi', now)) continue; // waits for the morning
        try {
          await this.firmware.send(t.nodeId, image, `the ${r.version} rollout (wave ${r.wave + 1})`);
          await this.prisma.rolloutTarget.update({ where: { id: t.id }, data: { status: TargetStatus.SENT, sentAt: now } });
        } catch (err) {
          await this.prisma.rolloutTarget.update({ where: { id: t.id }, data: { status: TargetStatus.FAILED, doneAt: now, note: (err as Error).message.slice(0, 300) } });
        }
      }
      return;
    }
    if (wave.some((t) => t.status === TargetStatus.SENT)) return; // waiting for the boards

    // this wave is over: watch it a while, then the next
    const later = r.targets.filter((t) => t.wave > r.wave);
    if (!later.length) {
      const c = (s: TargetStatus) => r.targets.filter((t) => t.status === s).length;
      await this.prisma.rollout.update({ where: { id: r.id }, data: { status: RolloutStatus.DONE, finishedAt: now } });
      await this.tellAdmins(r.orgId, `Firmware ${r.version} is out`, `${c(TargetStatus.DONE)} boards updated${c(TargetStatus.SKIPPED) ? `, ${c(TargetStatus.SKIPPED)} skipped (offline or weak Wi‑Fi: retry them later)` : ''}.`, 'INFO');
      this.log.log(`Rollout ${r.version} done`);
      return;
    }
    if (!r.nextWaveAt) {
      await this.prisma.rollout.update({ where: { id: r.id }, data: { nextWaveAt: new Date(now.getTime() + r.waveGapMin * 60_000) } });
      return;
    }
    if (now >= r.nextWaveAt) {
      const next = Math.min(...later.map((t) => t.wave));
      await this.prisma.rollout.update({ where: { id: r.id }, data: { wave: next, nextWaveAt: null } });
      this.log.log(`Rollout ${r.version}: wave ${next + 1}`);
    }
  }

  private async tellAdmins(orgId: string, title: string, body: string, severity: 'INFO' | 'WARN') {
    const admins = await this.prisma.user.findMany({ where: { orgId, staffRole: StaffRole.SUPERADMIN, disabled: false }, select: { id: true } });
    const anyHome = await this.prisma.home.findFirst({ where: { orgId }, select: { id: true } });
    if (!anyHome) return;
    await this.monitoring.notify(anyHome.id, admins.map((a) => a.id), { kind: 'firmware', severity, title, body, link: '/console/firmware' });
  }
}

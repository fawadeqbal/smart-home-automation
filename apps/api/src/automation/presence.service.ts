import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DEVICE_TYPES } from '@home/contracts';
import { Access, Prisma, PresenceRule } from '@prisma/client';
import { AccessService } from '../access/access.service';
import { AuthService } from '../auth/auth.service';
import { AuthUser, isAdmin } from '../auth/auth.types';
import { AuditService } from '../common/audit.service';
import { DevicesService } from '../hardware/devices.service';
import { MonitoringService } from '../monitoring/monitoring.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { AutomationService } from './automation.service';
import { checkAccess } from '../access/access-window';
import { decide, homeLine, isLightOrFan, PersonState, personState, PresenceEvent } from './presence';

const TICK_MS = Number(process.env.PRESENCE_TICK_MS) || 30_000;

export interface PresenceRuleInput {
  enabled?: boolean;
  switchOff?: 'none' | 'lights' | 'chosen';
  offDevices?: string[];
  awayMode?: boolean;
  notify?: boolean;
  arriveSceneId?: string | null;
}

/**
 * "Share when I'm home" (per person, per home, off until they turn it on) and the home's "when the last
 * person leaves / the first comes home" rule. The rule runs with the rights of the person who set it up
 * (checked again each time), through the normal acknowledged command path.
 */
@Injectable()
export class PresenceService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Presence');
  private timer?: NodeJS.Timeout;
  private readonly busy = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly access: AccessService,
    private readonly devices: DevicesService,
    private readonly automation: AutomationService,
    private readonly monitoring: MonitoringService,
    private readonly realtime: RealtimeService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.tick(), TICK_MS);
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  // ---------------------------------------------------------------- my sharing
  /** Only people who belong to the home share (staff looking in don't live there). */
  private async member(user: AuthUser, homeId: string) {
    const m = await this.prisma.membership.findUnique({ where: { userId_homeId: { userId: user.id, homeId } }, select: { role: true } });
    if (!m) throw new BadRequestException('Only the people of a home can share when they’re home.');
    return m;
  }

  /**
   * My sharing in this home. While I share, also the home's boards (id and address on the Wi‑Fi): the
   * phone asks them `GET /local/hello` to know it's home, whatever rooms I may use.
   */
  async mine(user: AuthUser) {
    const row = await this.prisma.presence.findUnique({ where: { userId_homeId: { userId: user.id, homeId: user.homeId } } });
    const member = await this.prisma.membership.findUnique({ where: { userId_homeId: { userId: user.id, homeId: user.homeId } }, select: { role: true } });
    const boards = row
      ? (await this.prisma.node.findMany({ where: { homeId: user.homeId, status: 'ADOPTED' }, select: { id: true, ip: true }, orderBy: { name: 'asc' } }))
        .map((n) => ({ nodeId: n.id, ip: n.ip }))
      : [];
    return { sharing: !!row, canShare: !!member, boards, ...(row ? personState(row) : {}) };
  }

  async setSharing(user: AuthUser, sharing: boolean) {
    await this.member(user, user.homeId);
    if (sharing) {
      await this.prisma.presence.upsert({
        where: { userId_homeId: { userId: user.id, homeId: user.homeId } },
        create: { userId: user.id, homeId: user.homeId },
        update: {},
      });
    } else {
      await this.prisma.presence.deleteMany({ where: { userId: user.id, homeId: user.homeId } });
    }
    await this.audit.record(user.homeId, user.id, sharing ? 'presence.share' : 'presence.stop', user.id, { channel: user.channel });
    this.realtime.presenceChanged(user.homeId);
    void this.evaluate(user.homeId);
    return this.mine(user);
  }

  /**
   * The phone app: can I reach a board of this home on the Wi‑Fi? Kept only while the person shares;
   * otherwise it's ignored (and the app is told, so it stops asking).
   */
  async report(user: AuthUser, atHome: boolean) {
    await this.member(user, user.homeId);
    const row = await this.prisma.presence.findUnique({ where: { userId_homeId: { userId: user.id, homeId: user.homeId } } });
    if (!row) return { sharing: false };
    const now = new Date();
    const fresh = row.reportedAt && now.getTime() - row.reportedAt.getTime() < 3 * 3600_000;
    const changed = row.atHome !== atHome || !fresh;
    const updated = await this.prisma.presence.update({
      where: { userId_homeId: { userId: user.id, homeId: user.homeId } },
      data: { atHome, reportedAt: now, ...(changed ? { since: now } : {}) },
    });
    if (changed) {
      this.realtime.presenceChanged(user.homeId);
      void this.evaluate(user.homeId);
    }
    return { sharing: true, ...personState(updated, now) };
  }

  // ---------------------------------------------------------------- who's home
  /**
   * Owners and admins see everyone who shares; someone who shares sees the others who share (and
   * themselves); anyone else only learns whether they share.
   */
  async whoIsHome(user: AuthUser) {
    const rows = await this.prisma.presence.findMany({
      where: { homeId: user.homeId }, include: { user: { select: { id: true, name: true } } }, orderBy: [{ sharedAt: 'asc' }, { userId: 'asc' }],
    });
    const sharing = rows.some((r) => r.userId === user.id);
    const sees = isAdmin(user.role) || sharing;
    const now = new Date();
    const people = sees ? rows.map((r) => {
      const s = personState(r, now);
      return { id: r.user.id, name: r.user.name, status: s.status, since: s.status === 'home' ? r.since : s.outSince, reportedAt: r.reportedAt, me: r.userId === user.id };
    }) : [];
    const rule = isAdmin(user.role) ? await this.prisma.presenceRule.findUnique({ where: { homeId: user.homeId } }) : null;
    return {
      sharing, people, line: sees ? homeLine(people) : null,
      rule: rule ? { enabled: rule.enabled, out: rule.out, lastEvent: rule.lastEvent, lastEventAt: rule.lastEventAt, lastResult: rule.lastResult } : null,
    };
  }

  // ---------------------------------------------------------------- the home's rule
  async getRule(user: AuthUser) {
    const [rule, switches, scenes] = await Promise.all([
      this.prisma.presenceRule.findUnique({ where: { homeId: user.homeId } }),
      this.prisma.device.findMany({
        where: { node: { homeId: user.homeId, status: 'ADOPTED' }, enabled: true, type: { in: Object.values(DEVICE_TYPES).filter((t) => t.controllable).map((t) => t.type) } },
        select: { id: true, name: true, type: true, aliases: true, room: { select: { name: true } } }, orderBy: { name: 'asc' },
      }),
      this.prisma.scene.findMany({ where: { homeId: user.homeId }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    ]);
    const by = rule ? await this.prisma.user.findUnique({ where: { id: rule.createdById }, select: { name: true } }) : null;
    const sharers = await this.prisma.presence.count({ where: { homeId: user.homeId } });
    return {
      rule: rule ? this.ruleDto(rule, by?.name ?? null) : null,
      devices: switches.map((d) => ({ id: d.id, name: d.name, type: d.type, room: d.room?.name ?? null, lightOrFan: isLightOrFan(d) })),
      scenes, sharers,
    };
  }

  private ruleDto(r: PresenceRule, by: string | null) {
    return {
      enabled: r.enabled, switchOff: r.switchOff, offDevices: r.offDevices, awayMode: r.awayMode, notify: r.notify,
      arriveSceneId: r.arriveSceneId, createdBy: by, createdById: r.createdById, out: r.out,
      lastEvent: r.lastEvent, lastEventAt: r.lastEventAt, lastResult: r.lastResult,
    };
  }

  async setRule(user: AuthUser, input: PresenceRuleInput) {
    if (!isAdmin(user.role) || user.readOnly) throw new ForbiddenException('Only the owner or an admin sets what happens when everyone leaves.');
    const current = await this.prisma.presenceRule.findUnique({ where: { homeId: user.homeId } });
    const data: Prisma.PresenceRuleUncheckedCreateInput = {
      homeId: user.homeId, createdById: user.id,
      enabled: input.enabled ?? current?.enabled ?? true,
      switchOff: input.switchOff ?? current?.switchOff ?? 'lights',
      offDevices: input.offDevices ?? current?.offDevices ?? [],
      awayMode: input.awayMode ?? current?.awayMode ?? false,
      notify: input.notify ?? current?.notify ?? true,
      arriveSceneId: input.arriveSceneId !== undefined ? input.arriveSceneId : current?.arriveSceneId ?? null,
    };
    if (data.switchOff === 'chosen') {
      const ids = [...new Set(data.offDevices as string[])].slice(0, 40);
      const rows = await this.prisma.device.findMany({ where: { id: { in: ids }, node: { homeId: user.homeId } }, select: { id: true, roomId: true, type: true, name: true } });
      if (rows.length !== ids.length) throw new BadRequestException('One of the devices does not exist.');
      for (const d of rows) {
        if (!DEVICE_TYPES[d.type]?.controllable) throw new BadRequestException(`${d.name} can't be switched.`);
        await this.access.require(user, d.roomId, Access.CONTROL);
      }
      if (!ids.length) throw new BadRequestException('Pick the devices to switch off, or choose “lights and fans”.');
      data.offDevices = ids;
    } else {
      data.offDevices = [];
    }
    if (data.arriveSceneId) {
      const scene = await this.prisma.scene.findFirst({ where: { id: data.arriveSceneId, homeId: user.homeId } });
      if (!scene) throw new BadRequestException('No such scene.');
    }
    if (data.switchOff === 'none' && !data.awayMode && !data.notify && !data.arriveSceneId) {
      throw new BadRequestException('Say what to do: switch things off, turn on away mode, tell you, or run a scene when someone comes home.');
    }
    // a new rule starts from where things are now, so it doesn't fire at once for people already out
    const people = await this.states(user.homeId);
    const outNow = !!people.length && people.every((p) => p.out);
    await this.prisma.presenceRule.upsert({
      where: { homeId: user.homeId },
      create: { ...data, out: outNow, outSince: outNow ? new Date() : null },
      update: { ...data, ...(current ? {} : { out: outNow }) },
    });
    await this.audit.record(user.homeId, user.id, 'presence.rule', user.homeId, { ...input, channel: user.channel });
    this.realtime.schedulesChanged(user.homeId);
    return this.getRule(user);
  }

  async removeRule(user: AuthUser) {
    if (!isAdmin(user.role) || user.readOnly) throw new ForbiddenException('Only the owner or an admin can change this.');
    const { count } = await this.prisma.presenceRule.deleteMany({ where: { homeId: user.homeId } });
    if (!count) throw new NotFoundException('There is no such rule.');
    await this.audit.record(user.homeId, user.id, 'presence.rule.remove', user.homeId, {});
    this.realtime.schedulesChanged(user.homeId);
  }

  // ---------------------------------------------------------------- deciding and doing
  /** The people who share, as counted now. A guest outside their hours (or past their end) doesn't count. */
  private async states(homeId: string, now = new Date()): Promise<(PersonState & { userId: string; name: string })[]> {
    const [rows, home] = await Promise.all([
      this.prisma.presence.findMany({ where: { homeId }, include: { user: { select: { name: true, disabled: true, memberships: { where: { homeId } } } } } }),
      this.prisma.home.findUnique({ where: { id: homeId }, select: { timezone: true } }),
    ]);
    return rows
      .filter((r) => !r.user.disabled && r.user.memberships[0] && checkAccess(r.user.memberships[0], home?.timezone ?? 'UTC', now).ok)
      .map((r) => ({ ...personState(r, now), userId: r.userId, name: r.user.name }));
  }

  async tick() {
    try {
      const rules = await this.prisma.presenceRule.findMany({ where: { enabled: true }, select: { homeId: true } });
      for (const r of rules) await this.evaluate(r.homeId);
    } catch (err) {
      this.log.warn(`tick failed: ${(err as Error).message}`);
    }
  }

  /** Looks at the home's people and runs "left" or "arrived" when it's time (one run at a time per home). */
  async evaluate(homeId: string, now = new Date()) {
    if (this.busy.has(homeId)) return;
    this.busy.add(homeId);
    try {
      const rule = await this.prisma.presenceRule.findUnique({ where: { homeId } });
      if (!rule?.enabled) return;
      const people = await this.states(homeId, now);
      const event = decide(rule.out, people);
      if (!event) return;
      // mark it first, so a slow run never fires twice
      await this.prisma.presenceRule.update({
        where: { homeId }, data: { out: event === 'left', outSince: event === 'left' ? now : null, lastEvent: event, lastEventAt: now },
      });
      const result = await this.run(rule, event, people).catch((e: Error) => `Failed: ${e.message}`);
      await this.prisma.presenceRule.update({ where: { homeId }, data: { lastResult: result } });
      this.log.log(`${event === 'left' ? 'Everyone left' : 'Someone came home'} (${homeId}): ${result}`);
      this.realtime.presenceChanged(homeId);
    } catch (err) {
      this.log.warn(`presence in ${homeId}: ${(err as Error).message}`);
    } finally {
      this.busy.delete(homeId);
    }
  }

  private async run(rule: PresenceRule, event: PresenceEvent, people: { userId: string; name: string; status: string }[]): Promise<string> {
    const actor = await this.auth.actorFor(rule.createdById, rule.homeId, 'automation');
    if (!actor || actor.readOnly) return 'Skipped: the person who set it up no longer has access to this home.';
    const done: string[] = [];
    const failed: string[] = [];
    let title: string;
    if (event === 'left') {
      title = 'Everyone has left';
      if (rule.switchOff !== 'none') {
        const devices = await this.prisma.device.findMany({
          where: {
            node: { homeId: rule.homeId, status: 'ADOPTED' }, enabled: true,
            ...(rule.switchOff === 'chosen' ? { id: { in: rule.offDevices } } : {}),
          },
          include: { state: true, node: { select: { online: true } } },
        });
        const levels = await this.access.roomLevels(actor);
        for (const d of devices) {
          if (!DEVICE_TYPES[d.type]?.controllable) continue;
          if (rule.switchOff === 'lights' && !isLightOrFan(d)) continue;
          if ((d.state?.state as { on?: boolean } | null)?.on !== true) continue; // already off
          // like other automations: only what its maker may switch, and child lock for members
          if (!this.access.levelFor(levels, d.roomId) || (d.childLock && !isAdmin(actor.role))) continue;
          try {
            await this.devices.command(actor, d.id, { on: false });
            done.push(d.name);
          } catch (err) {
            failed.push(`${d.name}: ${(err as Error).message}`);
          }
        }
      }
      if (rule.awayMode) {
        const home = await this.prisma.home.findUniqueOrThrow({ where: { id: rule.homeId }, select: { awayMode: true } });
        if (!home.awayMode) {
          await this.prisma.home.update({ where: { id: rule.homeId }, data: { awayMode: true, awaySince: new Date(), awayById: rule.createdById } });
          await this.prisma.presenceRule.update({ where: { homeId: rule.homeId }, data: { awayByRule: true } });
          this.realtime.devicesChanged(rule.homeId);
          done.push('away mode on');
        }
      }
    } else {
      const who = people.filter((p) => p.status === 'home').map((p) => p.name.split(' ')[0]);
      title = `${who.join(' and ') || 'Someone'} came home`;
      if (rule.awayByRule) {
        const home = await this.prisma.home.findUniqueOrThrow({ where: { id: rule.homeId }, select: { awayMode: true } });
        if (home.awayMode) {
          await this.prisma.home.update({ where: { id: rule.homeId }, data: { awayMode: false, awaySince: null, awayById: null } });
          this.realtime.devicesChanged(rule.homeId);
          done.push('away mode off');
        }
        await this.prisma.presenceRule.update({ where: { homeId: rule.homeId }, data: { awayByRule: false } });
      }
      if (rule.arriveSceneId) {
        try {
          const r = await this.automation.runScene(actor, rule.arriveSceneId);
          const scene = await this.prisma.scene.findUnique({ where: { id: rule.arriveSceneId }, select: { name: true } });
          if (r.ok) done.push(`ran ${scene?.name ?? 'the scene'}`);
          else failed.push(`${scene?.name ?? 'the scene'}: ${r.failed.join('; ')}`);
        } catch (err) {
          failed.push((err as Error).message);
        }
      }
    }
    const summary = [
      event === 'left' && rule.switchOff !== 'none' ? (done.filter((d) => !d.startsWith('away')).length ? `Switched off ${done.filter((d) => !d.startsWith('away')).join(', ')}.` : 'Everything was already off.') : '',
      done.filter((d) => d.startsWith('away') || d.startsWith('ran')).map((d) => `${d[0]!.toUpperCase()}${d.slice(1)}.`).join(' '),
      failed.length ? `Failed: ${failed.join('; ')}` : '',
    ].filter(Boolean).join(' ') || 'Nothing to do.';
    await this.audit.record(rule.homeId, rule.createdById, `presence.${event}`, rule.homeId, { result: summary, channel: 'automation' });
    if (rule.notify) {
      await this.monitoring.notify(rule.homeId, [rule.createdById], {
        kind: 'presence', severity: failed.length ? 'WARN' : 'INFO', title, body: summary, link: `/automations?home=${rule.homeId}`,
      });
    }
    return summary;
  }
}

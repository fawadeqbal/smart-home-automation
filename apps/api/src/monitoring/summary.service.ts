import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { NodeStatus, Role } from '@prisma/client';
import { AuthService } from '../auth/auth.service';
import { AuthUser } from '../auth/auth.types';
import { localDate, zoneOffsetMinutes, zonedToUtc } from '../automation/time';
import { SETTINGS, Settings } from '../config';
import { EnergyService } from '../energy/energy.service';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { MonitoringService } from './monitoring.service';
import { duration, mergePower, summarize } from './outages.service';

export type Period = 'day' | 'week';

const ALERT_WORDS: Record<string, [string, string]> = {
  leak: ['water leak', 'water leaks'], doorAtNight: ['door opened at night', 'doors opened at night'],
  motionAtNight: ['movement at night', 'times movement at night'], awayAlert: ['away-mode alert', 'away-mode alerts'],
  temperature: ['very hot or cold room', 'very hot or cold rooms'],
};

const n = (count: number, [one, many]: [string, string]) => `${count} ${count === 1 ? one : many}`;
const rs = (x: number) => `Rs ${x.toLocaleString('en-PK')}`;

/** The text of a summary: a title and lines that read well in the app, an email and on WhatsApp. */
export function summaryText(s: { home: string; period: Period; range: string; lines: string[] }) {
  return `*${s.home} — ${s.period === 'day' ? 'today' : 'this week'}* (${s.range})\n` + s.lines.map((l) => `• ${l}`).join('\n');
}

/**
 * Daily and weekly summaries of a home: power cuts, electricity, what automations did, alerts and
 * boards. Shown in the app (to share on WhatsApp), and sent as a notice (and email) on Sunday
 * evenings — and every evening for people who switch the daily one on.
 */
@Injectable()
export class SummaryService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Summary');
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly energy: EnergyService,
    private readonly auth: AuthService,
    private readonly monitoring: MonitoringService,
    private readonly mail: MailService,
    @Inject(SETTINGS) private readonly settings: Settings,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.tick(), 10 * 60_000);
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  /** The summary for this person (their rooms' switches; the home's power and boards). */
  async build(user: AuthUser, period: Period, now = new Date()) {
    const home = await this.prisma.home.findUniqueOrThrow({ where: { id: user.homeId }, select: { name: true, timezone: true } });
    const tz = home.timezone;
    const days = period === 'day' ? 1 : 7;
    const today = localDate(tz, now);
    const from = zonedToUtc(tz, today.y, today.m, today.d - (days - 1), 0, 0);
    const fmt = (d: Date) => new Date(d.getTime() + zoneOffsetMinutes(tz, d) * 60000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
    const range = period === 'day' ? fmt(now) : `${fmt(from)} – ${fmt(now)}`;

    const [outages, energy, automated, notices, boards] = await Promise.all([
      this.prisma.outage.findMany({ where: { homeId: user.homeId, endedAt: { gte: from } }, select: { kind: true, seconds: true, startedAt: true, endedAt: true } }),
      this.energy.usage(user, days, now).catch(() => null),
      this.prisma.command.count({ where: { channel: 'automation', createdAt: { gte: from }, device: { node: { homeId: user.homeId } } } }),
      this.prisma.notification.groupBy({ by: ['kind'], where: { homeId: user.homeId, userId: user.id, createdAt: { gte: from }, kind: { in: Object.keys(ALERT_WORDS) } }, _count: true }),
      this.prisma.node.findMany({ where: { homeId: user.homeId, status: { in: [NodeStatus.ADOPTED, NodeStatus.FAULTY] } }, select: { name: true, online: true, status: true } }),
    ]);

    const lines: string[] = [];
    const sum = summarize(mergePower(outages));
    lines.push(sum.powerCuts
      ? `Power: ${n(sum.powerCuts, ['cut', 'cuts'])}, ${duration(sum.powerSeconds)} without power`
      : 'Power: no power cuts');
    if (sum.networkOuts) lines.push(`Internet: down ${n(sum.networkOuts, ['time', 'times'])}, ${duration(sum.networkSeconds)} in all`);
    if (energy && energy.total.kwh >= 0.05) {
      const top = energy.devices.find((d) => d.kwh > 0);
      lines.push(`Electricity: about ${energy.total.kwh < 10 ? energy.total.kwh.toFixed(1) : Math.round(energy.total.kwh)} units, ${rs(energy.total.cost)}${top ? ` (most from ${top.name})` : ''}`);
    }
    if (automated) lines.push(`Automations: ${n(automated, ['switch', 'switches'])} by timers, rules and away mode`);
    const alerts = notices.filter((x) => x._count).map((x) => n(x._count, ALERT_WORDS[x.kind]!));
    lines.push(alerts.length ? `Alerts: ${alerts.join(', ')}` : 'Alerts: none');
    const waiting = boards.filter((b) => b.status === NodeStatus.FAULTY);
    const off = boards.filter((b) => !b.online && b.status !== NodeStatus.FAULTY);
    if (waiting.length) lines.push(`Boards: ${waiting.map((b) => b.name).join(', ')} waiting for a replacement`);
    if (off.length) lines.push(`Boards: ${off.map((b) => b.name).join(', ')} offline now`);
    else if (boards.length && !waiting.length) lines.push(`Boards: all ${boards.length} online`);

    const s = { home: home.name, period, range, lines };
    return { ...s, text: summaryText(s), link: `${this.settings.publicUrl}/summary` };
  }

  // ---------------------------------------------------------------- sending it on a schedule
  async tick(now = new Date()) {
    try {
      const homes = await this.prisma.home.findMany({ select: { id: true, timezone: true, summaryDayAt: true, summaryWeekAt: true } });
      for (const h of homes) {
        const local = new Date(now.getTime() + zoneOffsetMinutes(h.timezone, now) * 60000);
        const hour = local.getUTCHours();
        const fresh = (at: Date | null, hours: number) => !at || now.getTime() - at.getTime() > hours * 3_600_000;
        if (local.getUTCDay() === 0 && hour >= 20 && hour < 23 && fresh(h.summaryWeekAt, 24)) {
          await this.prisma.home.update({ where: { id: h.id }, data: { summaryWeekAt: now } });
          await this.send(h.id, 'week', now);
        } else if (hour >= 21 && hour < 23 && fresh(h.summaryDayAt, 12)) {
          await this.prisma.home.update({ where: { id: h.id }, data: { summaryDayAt: now } });
          await this.send(h.id, 'day', now);
        }
      }
    } catch (err) {
      this.log.warn(`Summaries failed: ${(err as Error).message}`);
    }
  }

  /** To each owner and admin who wants it (each sees their own rooms' numbers), in the app and by email. */
  async send(homeId: string, period: Period, now = new Date()) {
    const kind = period === 'day' ? 'dailySummary' : 'weeklySummary';
    const people = await this.prisma.membership.findMany({
      where: { homeId, role: { in: [Role.OWNER, Role.ADMIN] }, user: { disabled: false } }, select: { user: { select: { id: true, email: true, notifyPrefs: true } } },
    });
    let sent = 0;
    for (const { user } of people) {
      const prefs = (user.notifyPrefs ?? {}) as Record<string, boolean>;
      if (!(prefs[kind] ?? (kind === 'weeklySummary'))) continue;
      const actor = await this.auth.actorFor(user.id, homeId, 'automation');
      if (!actor) continue;
      const s = await this.build(actor, period, now);
      await this.monitoring.notify(homeId, [user.id], {
        kind, severity: 'INFO', title: `${s.home}: ${period === 'day' ? 'today' : 'your week'}`, body: s.lines.join(' · '), link: `/summary?period=${period}&home=${homeId}`,
      });
      if (period === 'week' && this.mail.enabled && (prefs.summaryEmail ?? true)) {
        await this.mail.send({
          to: user.email, subject: `${s.home}: your week (${s.range})`,
          text: `Here is how ${s.home} did this week (${s.range}).\n\n${s.lines.map((l) => `• ${l}`).join('\n')}`,
          button: { label: 'Open the summary', url: `${s.link}?period=week&home=${homeId}` },
        });
      }
      sent++;
    }
    if (sent) this.log.log(`${period === 'day' ? 'Daily' : 'Weekly'} summary for ${homeId} -> ${sent} people`);
  }
}

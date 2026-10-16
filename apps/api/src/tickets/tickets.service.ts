import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, StaffRole, TicketPriority, TicketStatus } from '@prisma/client';
import { AuthUser, isAdmin } from '../auth/auth.types';
import { AuditService } from '../common/audit.service';
import { SETTINGS, Settings } from '../config';
import { MailService } from '../mail/mail.service';
import { MonitoringService } from '../monitoring/monitoring.service';
import { PlatformService } from '../platform/platform.service';
import { PrismaService } from '../prisma/prisma.service';

const HOUR = 3_600_000;
/** How soon each priority should be dealt with. */
export const DUE_HOURS: Record<TicketPriority, number> = { URGENT: 4, HIGH: 24, NORMAL: 72, LOW: 168 };
export const CATEGORIES = ['fault', 'installation', 'billing', 'question', 'other'] as const;
export const STATUS_TEXT: Record<TicketStatus, string> = {
  OPEN: 'Open', IN_PROGRESS: 'Being worked on', WAITING: 'Waiting for you', RESOLVED: 'Solved', CLOSED: 'Closed',
};
const OPEN_STATES: TicketStatus[] = [TicketStatus.OPEN, TicketStatus.IN_PROGRESS, TicketStatus.WAITING];

/** A first guess at the priority from the words (a leak or smoke is urgent; "not working" is high). */
export function guessPriority(text: string): TicketPriority {
  const t = text.toLowerCase();
  if (/\b(leak|water|smoke|fire|spark|shock|burn|current|pani|dhuan|aag)\b/.test(t)) return TicketPriority.URGENT;
  if (/\b(not working|doesn'?t work|dead|offline|nothing works|band hai|nahi chal|kharab)\b/.test(t)) return TicketPriority.HIGH;
  return TicketPriority.NORMAL;
}

type Row = Prisma.TicketGetPayload<{ include: { home: { select: { name: true; city: true } }; messages: true } }>;

/**
 * Service tickets: a home reports a problem or asks for something; staff answer, assign, set the
 * priority and status. People in the home see only their home's tickets and never staff-only notes.
 */
@Injectable()
export class TicketsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly platform: PlatformService,
    private readonly monitoring: MonitoringService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    @Inject(SETTINGS) private readonly settings: Settings,
  ) {}

  // ---------------------------------------------------------------- the home's side
  async open(user: AuthUser, input: { title?: string; body: string; category?: string; nodeId?: string }) {
    if (user.readOnly) throw new ForbiddenException('Support can look but not open tickets for a home here — use the console.');
    const home = await this.prisma.home.findUniqueOrThrow({ where: { id: user.homeId }, select: { id: true, name: true, orgId: true, installerId: true } });
    if (input.nodeId && !(await this.prisma.node.findFirst({ where: { id: input.nodeId, homeId: home.id } }))) throw new BadRequestException('Unknown board.');
    const body = input.body.trim();
    const title = (input.title?.trim() || body.split(/[.\n!?]/)[0]!.trim()).slice(0, 100) || 'Help needed';
    const priority = guessPriority(`${title} ${body}`);
    const category = CATEGORIES.includes(input.category as never) ? input.category! : 'fault';
    const ticket = await this.prisma.$transaction(async (tx) => {
      const { ticketSeq } = await tx.organization.update({ where: { id: home.orgId }, data: { ticketSeq: { increment: 1 } }, select: { ticketSeq: true } });
      return tx.ticket.create({
        data: {
          orgId: home.orgId, homeId: home.id, number: ticketSeq, title, category, priority, nodeId: input.nodeId ?? null,
          openedById: user.id, assigneeId: home.installerId, dueAt: new Date(Date.now() + DUE_HOURS[priority] * HOUR),
          messages: { create: { authorId: user.id, body } },
        },
      });
    });
    await this.audit.record(home.id, user.id, 'ticket.open', ticket.id, { number: ticket.number, title, priority, nodeId: input.nodeId ?? null });
    const staff = await this.staffFor(home.orgId, home.installerId);
    await this.monitoring.notify(home.id, staff.filter((id) => id !== user.id), {
      kind: 'supportRequest', severity: priority === 'URGENT' ? 'ALERT' : 'WARN', title: `#${ticket.number} · ${home.name}: ${title}`,
      body: `${user.name}: ${body.slice(0, 300)}`, link: `/console/tickets/${ticket.id}`,
    });
    return this.homeTicket(user, ticket.id);
  }

  async forHome(user: AuthUser) {
    const rows = await this.prisma.ticket.findMany({
      where: { homeId: user.homeId, ...(isAdmin(user.role) ? {} : { openedById: user.id }) },
      include: { home: { select: { name: true, city: true } }, messages: { where: { internal: false }, orderBy: { createdAt: 'asc' } } },
      orderBy: [{ updatedAt: 'desc' }],
    });
    const names = await this.names(rows.flatMap((r) => [r.openedById, r.assigneeId, ...r.messages.map((m) => m.authorId)]));
    return rows.map((r) => this.homeView(r, names));
  }

  async homeTicket(user: AuthUser, id: string) {
    const r = await this.prisma.ticket.findFirst({
      where: { id, homeId: user.homeId, ...(isAdmin(user.role) ? {} : { openedById: user.id }) },
      include: { home: { select: { name: true, city: true } }, messages: { where: { internal: false }, orderBy: { createdAt: 'asc' } } },
    });
    if (!r) throw new NotFoundException('No such ticket.');
    return this.homeView(r, await this.names([r.openedById, ...r.messages.map((m) => m.authorId)]));
  }

  async homeReply(user: AuthUser, id: string, body: string, solved?: boolean) {
    if (user.readOnly) throw new ForbiddenException('Support answers from the console.');
    const t = await this.homeTicket(user, id);
    const status = solved === true ? TicketStatus.RESOLVED : solved === false || t.status === 'WAITING' || t.status === 'RESOLVED' || t.status === 'CLOSED' ? TicketStatus.OPEN : undefined;
    await this.prisma.$transaction([
      ...(body.trim() ? [this.prisma.ticketMessage.create({ data: { ticketId: id, authorId: user.id, body: body.trim() } })] : []),
      ...(status && status !== t.status ? [
        this.prisma.ticket.update({ where: { id }, data: { status, resolvedAt: status === TicketStatus.RESOLVED ? new Date() : null } }),
        this.prisma.ticketMessage.create({ data: { ticketId: id, authorId: user.id, body: status === TicketStatus.RESOLVED ? 'Marked as solved' : 'Opened again', event: true } }),
      ] : [this.prisma.ticket.update({ where: { id }, data: { updatedAt: new Date() } })]),
    ]);
    const full = await this.prisma.ticket.findUniqueOrThrow({ where: { id }, select: { assigneeId: true, orgId: true, home: { select: { name: true, installerId: true } } } });
    const to = full.assigneeId ? [full.assigneeId] : await this.staffFor(full.orgId, full.home.installerId);
    await this.monitoring.notify(user.homeId, to.filter((x) => x !== user.id), {
      kind: 'supportRequest', severity: 'INFO', title: `#${t.number} · ${full.home.name}: ${status === TicketStatus.RESOLVED ? 'solved' : 'new reply'}`,
      body: `${user.name}: ${(body.trim() || (status === TicketStatus.RESOLVED ? 'Marked as solved.' : '')).slice(0, 300)}`, link: `/console/tickets/${id}`,
    });
    return this.homeTicket(user, id);
  }

  // ---------------------------------------------------------------- staff side (the console)
  async list(staff: AuthUser, filter: { status?: string; mine?: boolean; homeId?: string }) {
    const where: Prisma.TicketWhereInput = {
      home: this.platform.homeWhere(staff),
      ...(filter.status === 'open' ? { status: { in: OPEN_STATES } } : filter.status === 'done' ? { status: { notIn: OPEN_STATES } } : {}),
      ...(filter.mine ? { assigneeId: staff.id } : {}),
      ...(filter.homeId ? { homeId: filter.homeId } : {}),
    };
    const rows = await this.prisma.ticket.findMany({
      where, include: { home: { select: { name: true, city: true } }, messages: { orderBy: { createdAt: 'asc' } } }, orderBy: [{ updatedAt: 'desc' }], take: 300,
    });
    const names = await this.names(rows.flatMap((r) => [r.openedById, r.assigneeId, ...r.messages.map((m) => m.authorId)]));
    const now = Date.now();
    const list = rows.map((r) => ({ ...this.staffView(r, names), messages: undefined, last: this.lastLine(r, names) }));
    const counts = await this.prisma.ticket.groupBy({ by: ['status'], where: { home: this.platform.homeWhere(staff) }, _count: true });
    const open = counts.filter((c) => OPEN_STATES.includes(c.status)).reduce((a, c) => a + c._count, 0);
    const overdue = await this.prisma.ticket.count({ where: { home: this.platform.homeWhere(staff), status: { in: OPEN_STATES }, dueAt: { lt: new Date(now) } } });
    return { tickets: list, open, overdue };
  }

  async get(staff: AuthUser, id: string) {
    const r = await this.prisma.ticket.findFirst({ where: { id, home: this.platform.homeWhere(staff) }, include: { home: { select: { name: true, city: true } }, messages: { orderBy: { createdAt: 'asc' } } } });
    if (!r) throw new NotFoundException('No such ticket.');
    const names = await this.names([r.openedById, r.assigneeId, ...r.messages.map((m) => m.authorId)]);
    const staffList = await this.prisma.user.findMany({
      where: { orgId: r.orgId, disabled: false, staffRole: { not: null } }, select: { id: true, name: true, staffRole: true }, orderBy: { name: 'asc' },
    });
    const node = r.nodeId ? await this.prisma.node.findUnique({ where: { id: r.nodeId }, select: { id: true, name: true, online: true } }) : null;
    return { ...this.staffView(r, names), staff: staffList, node };
  }

  async staffReply(staff: AuthUser, id: string, input: { body: string; internal?: boolean; status?: TicketStatus }) {
    const t = await this.get(staff, id);
    const body = input.body.trim();
    if (!body && !input.status) throw new BadRequestException('Write a reply.');
    // answering the home moves it on: waiting for them, unless a status was picked
    const status = input.status ?? (body && !input.internal && t.status === 'OPEN' ? TicketStatus.IN_PROGRESS : undefined);
    await this.prisma.$transaction([
      ...(body ? [this.prisma.ticketMessage.create({ data: { ticketId: id, authorId: staff.id, body, internal: !!input.internal } })] : []),
      ...(status && status !== t.status ? [this.prisma.ticketMessage.create({ data: { ticketId: id, authorId: staff.id, body: `Status: ${STATUS_TEXT[status]}`, event: true } })] : []),
      this.prisma.ticket.update({
        where: { id }, data: {
          ...(status ? { status, resolvedAt: status === TicketStatus.RESOLVED || status === TicketStatus.CLOSED ? new Date() : null } : {}),
          updatedAt: new Date(),
        },
      }),
    ]);
    if (body && !input.internal) await this.tellHome(t, `${staff.name}: ${body}`, status);
    else if (status && status !== t.status && (status === TicketStatus.RESOLVED || status === TicketStatus.WAITING)) await this.tellHome(t, `Status: ${STATUS_TEXT[status]}`, status);
    return this.get(staff, id);
  }

  async update(staff: AuthUser, id: string, input: { priority?: TicketPriority; assigneeId?: string | null; title?: string; category?: string }) {
    const t = await this.get(staff, id);
    if (staff.staffRole === StaffRole.INSTALLER && input.assigneeId !== undefined && input.assigneeId !== staff.id && input.assigneeId !== null) {
      throw new ForbiddenException('Installers can take a ticket, not hand it to someone else.');
    }
    if (input.assigneeId && !t.staff.some((s) => s.id === input.assigneeId)) throw new BadRequestException('Pick someone from your team.');
    const data: Prisma.TicketUpdateInput = {};
    const events: string[] = [];
    if (input.priority && input.priority !== t.priority) {
      data.priority = input.priority;
      data.dueAt = new Date(new Date(t.createdAt).getTime() + DUE_HOURS[input.priority] * HOUR);
      events.push(`Priority: ${input.priority.toLowerCase()}`);
    }
    if (input.assigneeId !== undefined && input.assigneeId !== t.assigneeId) {
      data.assigneeId = input.assigneeId;
      events.push(input.assigneeId ? `Assigned to ${t.staff.find((s) => s.id === input.assigneeId)!.name}` : 'Unassigned');
    }
    if (input.title?.trim()) data.title = input.title.trim().slice(0, 100);
    if (input.category && CATEGORIES.includes(input.category as never)) data.category = input.category;
    await this.prisma.$transaction([
      this.prisma.ticket.update({ where: { id }, data }),
      ...events.map((e) => this.prisma.ticketMessage.create({ data: { ticketId: id, authorId: staff.id, body: e, event: true, internal: true } })),
    ]);
    if (input.assigneeId && input.assigneeId !== staff.id) {
      await this.monitoring.notify(t.homeId, [input.assigneeId], {
        kind: 'supportRequest', severity: 'INFO', title: `#${t.number} assigned to you`, body: `${t.home}: ${t.title}`, link: `/console/tickets/${id}`,
      });
    }
    return this.get(staff, id);
  }

  /** A ticket for a home, opened by staff (e.g. after a phone call). */
  async staffOpen(staff: AuthUser, input: { homeId: string; title: string; body: string; priority?: TicketPriority; category?: string }) {
    const home = await this.prisma.home.findFirst({ where: { ...this.platform.homeWhere(staff), id: input.homeId }, select: { id: true, orgId: true, installerId: true, name: true } });
    if (!home) throw new NotFoundException('No such home.');
    const priority = input.priority ?? guessPriority(`${input.title} ${input.body}`);
    const ticket = await this.prisma.$transaction(async (tx) => {
      const { ticketSeq } = await tx.organization.update({ where: { id: home.orgId }, data: { ticketSeq: { increment: 1 } }, select: { ticketSeq: true } });
      return tx.ticket.create({
        data: {
          orgId: home.orgId, homeId: home.id, number: ticketSeq, title: input.title.trim().slice(0, 100), priority,
          category: CATEGORIES.includes(input.category as never) ? input.category! : 'fault', openedById: staff.id,
          assigneeId: home.installerId, dueAt: new Date(Date.now() + DUE_HOURS[priority] * HOUR),
          messages: { create: { authorId: staff.id, body: input.body.trim() } },
        },
      });
    });
    await this.audit.record(home.id, staff.id, 'ticket.open', ticket.id, { number: ticket.number, title: ticket.title, priority }, home.orgId);
    return this.get(staff, ticket.id);
  }

  // ---------------------------------------------------------------- helpers
  private async tellHome(t: { id: string; homeId: string; number: number; title: string; openedById: string }, text: string, status?: TicketStatus) {
    const admins = await this.prisma.membership.findMany({ where: { homeId: t.homeId, role: { in: ['OWNER', 'ADMIN'] }, user: { disabled: false } }, select: { userId: true } });
    const opener = await this.prisma.membership.findFirst({ where: { homeId: t.homeId, userId: t.openedById } });
    const to = [...new Set([...admins.map((a) => a.userId), ...(opener ? [t.openedById] : [])])];
    await this.monitoring.notify(t.homeId, to, {
      kind: 'ticketReply', severity: status === TicketStatus.WAITING ? 'WARN' : 'INFO',
      title: `Your request #${t.number}${status === TicketStatus.RESOLVED ? ' is solved' : status === TicketStatus.WAITING ? ' needs your answer' : ''}`,
      body: text.slice(0, 300), link: `/support/${t.id}?home=${t.homeId}`,
    });
    if (this.mail.enabled && opener) {
      const u = await this.prisma.user.findUnique({ where: { id: t.openedById }, select: { email: true } });
      if (u) {
        await this.mail.send({
          to: u.email, subject: `Your request #${t.number}: ${t.title}`, text: text.slice(0, 2000),
          button: { label: 'Open the request', url: `${this.settings.publicUrl}/support/${t.id}?home=${t.homeId}` },
        });
      }
    }
  }

  private async staffFor(orgId: string, installerId: string | null) {
    const staff = await this.prisma.user.findMany({
      where: { orgId, disabled: false, OR: [{ staffRole: { in: [StaffRole.SUPPORT, StaffRole.SUPERADMIN] } }, { id: installerId ?? '' }] }, select: { id: true },
    });
    return staff.map((s) => s.id);
  }

  private async names(ids: (string | null)[]) {
    const unique = [...new Set(ids.filter((x): x is string => !!x))];
    const users = unique.length ? await this.prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true, staffRole: true } }) : [];
    return new Map(users.map((u) => [u.id, { name: u.name, staff: !!u.staffRole }]));
  }

  private lastLine(r: Row, names: Map<string, { name: string }>) {
    const m = [...r.messages].reverse().find((x) => !x.event);
    return m ? { by: m.authorId ? names.get(m.authorId)?.name ?? null : null, text: m.body.slice(0, 140), internal: m.internal, at: m.createdAt } : null;
  }

  private base(r: Row) {
    const open = OPEN_STATES.includes(r.status);
    return {
      id: r.id, number: r.number, title: r.title, category: r.category, status: r.status, statusText: STATUS_TEXT[r.status], priority: r.priority,
      homeId: r.homeId, home: r.home.name, city: r.home.city, nodeId: r.nodeId, openedById: r.openedById, assigneeId: r.assigneeId,
      dueAt: r.dueAt, overdue: open && !!r.dueAt && r.dueAt.getTime() < Date.now(), createdAt: r.createdAt, updatedAt: r.updatedAt, resolvedAt: r.resolvedAt,
    };
  }

  private staffView(r: Row, names: Map<string, { name: string; staff: boolean }>) {
    return {
      ...this.base(r), openedBy: names.get(r.openedById)?.name ?? null, assignee: r.assigneeId ? names.get(r.assigneeId)?.name ?? null : null,
      messages: r.messages.map((m) => ({ id: m.id, body: m.body, internal: m.internal, event: m.event, at: m.createdAt, by: m.authorId ? names.get(m.authorId)?.name ?? null : null, staff: m.authorId ? names.get(m.authorId)?.staff ?? false : false })),
    };
  }

  private homeView(r: Row, names?: Map<string, { name: string; staff: boolean }>) {
    const n = names ?? new Map<string, { name: string; staff: boolean }>();
    return {
      ...this.base(r), assignee: null, openedBy: n.get(r.openedById)?.name ?? null,
      messages: r.messages.filter((m) => !m.internal).map((m) => ({ id: m.id, body: m.body, event: m.event, at: m.createdAt, mine: m.authorId === r.openedById, by: m.authorId ? n.get(m.authorId)?.name ?? null : null, staff: m.authorId ? n.get(m.authorId)?.staff ?? false : false })),
    };
  }
}

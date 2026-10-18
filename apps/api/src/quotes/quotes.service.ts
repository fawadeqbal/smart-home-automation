import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, QuoteStatus, StaffRole, VisitStatus } from '@prisma/client';
import { randomToken } from '../auth/auth.service';
import { AuthUser } from '../auth/auth.types';
import { AuditService } from '../common/audit.service';
import { homeContact } from '../common/contacts';
import { normalisePhone } from '../common/phone';
import { StaffNoticesService } from '../common/staff-notices.service';
import { isoDay, todayIn } from '../billing/billing.service';
import { PlatformService } from '../platform/platform.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { VisitsService } from '../visits/visits.service';
import { acceptedItems, cleanLines, lineTotal, QuoteLine, quoteRef, quoteTotals } from './quote-math';

const DAY = 86_400_000;
const TZ = 'Asia/Karachi';
const DEFAULT_VALID_DAYS = 30;

/** A sensible first price list for a new company (rupees; every price can be changed in the console). */
export const STARTER_PRICES: { name: string; unit: string; price: number }[] = [
  { name: 'Smart switchboard, 4 switches', unit: 'board', price: 6500 },
  { name: 'Smart switchboard, 8 switches', unit: 'board', price: 9500 },
  { name: 'Door or window sensor', unit: 'each', price: 1800 },
  { name: 'Motion sensor', unit: 'each', price: 2200 },
  { name: 'Water leak sensor', unit: 'each', price: 1500 },
  { name: 'Temperature and humidity sensor', unit: 'each', price: 1600 },
  { name: 'Heavy-duty relay (motor, geyser, AC)', unit: 'each', price: 3500 },
  { name: 'Fan speed regulator', unit: 'each', price: 3000 },
  { name: 'Water tank level sensor', unit: 'each', price: 4500 },
  { name: 'Wiring and materials', unit: 'point', price: 600 },
  { name: 'Installation labour', unit: 'board', price: 2000 },
];

type Row = Prisma.QuoteGetPayload<object>;

/**
 * Quotes: staff price an installation from the company's price list (plus anything typed in), send
 * the customer a link, and the customer accepts or declines it on a public page (no sign-in).
 * An accepted quote becomes an installation job in one step: the home (made if there isn't one yet),
 * its installer, the visit request marked as a customer; the items show on the installation report.
 */
@Injectable()
export class QuotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly platform: PlatformService,
    private readonly visits: VisitsService,
    private readonly audit: AuditService,
    private readonly notices: StaffNoticesService,
    private readonly realtime: RealtimeService,
  ) {}

  private org(user: AuthUser) {
    if (!user.orgId) throw new ForbiddenException('This is for platform staff only.');
    return user.orgId;
  }

  // ---------------------------------------------------------------- the price list
  async priceItems(user: AuthUser) {
    const orgId = this.org(user);
    if ((await this.prisma.priceItem.count({ where: { orgId } })) === 0) {
      await this.prisma.priceItem.createMany({ data: STARTER_PRICES.map((p, order) => ({ orgId, ...p, order })) });
    }
    const rows = await this.prisma.priceItem.findMany({ where: { orgId, archivedAt: null }, orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] });
    return { items: rows.map((r) => ({ id: r.id, name: r.name, unit: r.unit, price: r.price })), canEdit: user.staffRole === StaffRole.SUPERADMIN };
  }

  /** The whole list as edited in the console: changed items saved, new ones added, missing ones put away. */
  async savePriceItems(user: AuthUser, items: { id?: string; name: string; unit?: string; price: number }[]) {
    const orgId = this.org(user);
    if (user.staffRole !== StaffRole.SUPERADMIN) throw new ForbiddenException('Only a super admin can change prices.');
    await this.priceItems(user); // makes the starter list first, so it isn't added again later
    const existing = await this.prisma.priceItem.findMany({ where: { orgId, archivedAt: null }, select: { id: true } });
    const keep = new Set(items.map((i) => i.id).filter(Boolean));
    await this.prisma.$transaction([
      ...existing.filter((e) => !keep.has(e.id)).map((e) => this.prisma.priceItem.update({ where: { id: e.id }, data: { archivedAt: new Date() } })),
      ...items.map((i, order) => {
        const data = { name: i.name.trim().slice(0, 120), unit: (i.unit ?? 'each').trim().slice(0, 20) || 'each', price: Math.max(0, Math.round(i.price)), order };
        return i.id && existing.some((e) => e.id === i.id)
          ? this.prisma.priceItem.update({ where: { id: i.id }, data })
          : this.prisma.priceItem.create({ data: { orgId, ...data } });
      }),
    ]);
    await this.audit.record(null, user.id, 'org.prices', orgId, { items: items.length }, orgId);
    return this.priceItems(user);
  }

  // ---------------------------------------------------------------- who may see and change which quote
  /** Super admins and support: every quote of the company; installers: quotes for the homes they look after. */
  private async scoped(user: AuthUser): Promise<Prisma.QuoteWhereInput> {
    const orgId = this.org(user);
    if (user.staffRole !== StaffRole.INSTALLER) return { orgId };
    const homes = (await this.prisma.home.findMany({ where: this.platform.homeWhere(user), select: { id: true } })).map((h) => h.id);
    return { orgId, homeId: { in: homes } };
  }

  private async find(user: AuthUser, id: string) {
    const q = await this.prisma.quote.findFirst({ where: { ...(await this.scoped(user)), id } });
    if (!q) throw new NotFoundException('No such quote.');
    return q;
  }

  private editor(user: AuthUser) {
    if (user.staffRole === StaffRole.SUPPORT) throw new ForbiddenException('Support can look at quotes but not change them.');
  }

  // ---------------------------------------------------------------- reading
  async list(user: AuthUser, filter: { visitRequestId?: string; homeId?: string; status?: string }) {
    const where: Prisma.QuoteWhereInput = {
      ...(await this.scoped(user)),
      ...(filter.visitRequestId ? { visitRequestId: filter.visitRequestId } : {}),
      ...(filter.homeId ? { homeId: filter.homeId } : {}),
      ...(filter.status && filter.status in QuoteStatus ? { status: filter.status as QuoteStatus } : {}),
    };
    const rows = await this.prisma.quote.findMany({ where, orderBy: { number: 'desc' }, take: 300 });
    return { quotes: await this.dtos(rows), canEdit: user.staffRole !== StaffRole.SUPPORT, canConvert: user.staffRole === StaffRole.SUPERADMIN };
  }

  async get(user: AuthUser, id: string) {
    const q = await this.find(user, id);
    return (await this.dtos([q]))[0]!;
  }

  private async dtos(rows: Row[]) {
    const homeIds = [...new Set(rows.map((r) => r.homeId).filter((x): x is string => !!x))];
    const people = [...new Set(rows.map((r) => r.createdById).filter((x): x is string => !!x))];
    const [homes, staff, orgs] = await Promise.all([
      homeIds.length ? this.prisma.home.findMany({ where: { id: { in: homeIds } }, select: { id: true, name: true, installerId: true } }) : [],
      people.length ? this.prisma.user.findMany({ where: { id: { in: people } }, select: { id: true, name: true } }) : [],
      this.prisma.organization.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.orgId))] } }, select: { id: true, name: true } }),
    ]);
    return rows.map((q) => ({
      ...this.view(q),
      home: q.homeId ? homes.find((h) => h.id === q.homeId) ?? null : null,
      createdBy: q.createdById ? staff.find((s) => s.id === q.createdById)?.name ?? null : null,
      company: orgs.find((o) => o.id === q.orgId)?.name ?? '',
      whatsapp: normalisePhone(q.customerPhone),
      path: `/quote/${q.token}`,
      decidedName: q.decidedName, declineReason: q.declineReason, convertedAt: q.convertedAt,
      visitRequestId: q.visitRequestId, homeId: q.homeId, createdAt: q.createdAt, updatedAt: q.updatedAt,
    }));
  }

  /** What both sides see: the lines, the totals and where it stands. */
  private view(q: Row) {
    const items = (q.items as unknown as QuoteLine[]).map((l) => ({ ...l, total: lineTotal(l) }));
    return {
      id: q.id, number: q.number, ref: quoteRef(q.number), status: q.status, customerName: q.customerName, city: q.city,
      items, subtotal: q.subtotal, discount: q.discount, total: q.total, note: q.note,
      validUntil: q.validUntil ? isoDay(q.validUntil) : null, sentAt: q.sentAt, decidedAt: q.decidedAt,
    };
  }

  // ---------------------------------------------------------------- making and changing
  async create(user: AuthUser, input: { visitRequestId?: string; homeId?: string; customerName?: string; customerPhone?: string; items: unknown; discount?: number; note?: string; validDays?: number }) {
    const orgId = this.org(user);
    this.editor(user);
    let customer: { name: string; phone: string | null; city: string; visitRequestId: string | null; homeId: string | null };
    if (input.visitRequestId) {
      if (user.staffRole !== StaffRole.SUPERADMIN) throw new ForbiddenException('Only a super admin can quote a visit request.');
      const v = await this.prisma.visitRequest.findFirst({ where: { id: input.visitRequestId, orgId } });
      if (!v) throw new NotFoundException('No such visit request.');
      customer = { name: v.name, phone: v.phone, city: v.city, visitRequestId: v.id, homeId: v.homeId };
    } else if (input.homeId) {
      const h = await this.prisma.home.findFirst({ where: { ...this.platform.homeWhere(user), id: input.homeId }, select: { id: true, name: true, city: true } });
      if (!h) throw new NotFoundException('No such home.');
      const c = await homeContact(this.prisma, h.id);
      customer = { name: c.name ?? h.name, phone: c.whatsapp ? `+${c.whatsapp}` : null, city: h.city, visitRequestId: null, homeId: h.id };
    } else {
      throw new BadRequestException('A quote is for a visit request or a home.');
    }
    const lines = cleanLines(input.items);
    const t = quoteTotals(lines, input.discount ?? 0);
    const today = todayIn(TZ);
    const q = await this.prisma.$transaction(async (tx) => {
      const { quoteSeq } = await tx.organization.update({ where: { id: orgId }, data: { quoteSeq: { increment: 1 } }, select: { quoteSeq: true } });
      return tx.quote.create({
        data: {
          orgId, number: quoteSeq, visitRequestId: customer.visitRequestId, homeId: customer.homeId,
          customerName: (input.customerName?.trim() || customer.name).slice(0, 80),
          customerPhone: (input.customerPhone?.trim() || customer.phone)?.slice(0, 24) ?? null, city: customer.city.slice(0, 80),
          items: lines as unknown as Prisma.InputJsonValue, discount: t.discount, subtotal: t.subtotal, total: t.total,
          note: input.note?.trim().slice(0, 1000) ?? '', validUntil: new Date(today.getTime() + (input.validDays ?? DEFAULT_VALID_DAYS) * DAY),
          token: randomToken(), createdById: user.id,
        },
      });
    });
    await this.audit.record(q.homeId, user.id, 'quote.create', q.id, { ref: quoteRef(q.number), customer: q.customerName, total: q.total }, orgId);
    return this.get(user, q.id);
  }

  async update(user: AuthUser, id: string, input: { items?: unknown; discount?: number; note?: string; customerName?: string; customerPhone?: string | null; validDays?: number; status?: 'DRAFT' }) {
    this.editor(user);
    const q = await this.find(user, id);
    if (input.status === QuoteStatus.DRAFT) {
      // "Change it": a declined (or sent) quote goes back to a draft to be edited and sent again
      if (q.status === QuoteStatus.ACCEPTED) throw new BadRequestException('The customer accepted this quote. Make a new one for changes.');
      await this.prisma.quote.update({ where: { id }, data: { status: QuoteStatus.DRAFT, decidedAt: null, decidedName: null, declineReason: null } });
    } else if (q.status === QuoteStatus.ACCEPTED || q.status === QuoteStatus.DECLINED) {
      throw new BadRequestException('The customer has answered this quote. Open it as a draft to change it.');
    } else if (q.status === QuoteStatus.SENT) {
      // the customer may be reading it right now: changes go through a draft, then it is sent again
      throw new BadRequestException('This quote was sent. Open it as a draft to change it, then send it again.');
    }
    const lines = input.items !== undefined ? cleanLines(input.items) : (q.items as unknown as QuoteLine[]);
    const t = quoteTotals(lines, input.discount ?? q.discount);
    const data: Prisma.QuoteUpdateInput = { items: lines as unknown as Prisma.InputJsonValue, discount: t.discount, subtotal: t.subtotal, total: t.total };
    if (input.note !== undefined) data.note = input.note.trim().slice(0, 1000);
    if (input.customerName?.trim()) data.customerName = input.customerName.trim().slice(0, 80);
    if (input.customerPhone !== undefined) data.customerPhone = input.customerPhone?.trim().slice(0, 24) || null;
    if (input.validDays !== undefined) data.validUntil = new Date(todayIn(TZ).getTime() + input.validDays * DAY);
    await this.prisma.quote.update({ where: { id }, data });
    return this.get(user, id);
  }

  /** Ready for the customer: the link works from now on. */
  async send(user: AuthUser, id: string) {
    this.editor(user);
    const q = await this.find(user, id);
    if (q.status === QuoteStatus.ACCEPTED || q.status === QuoteStatus.DECLINED) throw new BadRequestException('The customer has already answered this quote.');
    if (!(q.items as unknown[]).length) throw new BadRequestException('Add at least one item first.');
    if (q.status === QuoteStatus.DRAFT) {
      await this.prisma.quote.update({ where: { id }, data: { status: QuoteStatus.SENT, sentAt: new Date() } });
      await this.audit.record(q.homeId, user.id, 'quote.send', id, { ref: quoteRef(q.number), total: q.total }, q.orgId);
    }
    return this.get(user, id);
  }

  async remove(user: AuthUser, id: string) {
    this.editor(user);
    const q = await this.find(user, id);
    if (q.status !== QuoteStatus.DRAFT) throw new BadRequestException('Only a draft can be deleted. The customer may already have the link.');
    await this.prisma.quote.delete({ where: { id } });
  }

  // ---------------------------------------------------------------- the customer's page (public, by the secret link)
  private async byToken(token: string) {
    const q = token.length >= 20 ? await this.prisma.quote.findUnique({ where: { token } }) : null;
    // a draft isn't ready to be seen yet
    if (!q || q.status === QuoteStatus.DRAFT) throw new NotFoundException('This quote link is not valid. Ask the company to send it again.');
    return q;
  }

  private expired(q: Row) {
    return !!q.validUntil && q.validUntil.getTime() + DAY <= Date.now();
  }

  async publicView(token: string) {
    const q = await this.byToken(token);
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: q.orgId }, select: { name: true, logo: true, billingEmail: true } });
    return {
      ...this.view(q), company: org, decidedName: q.decidedName,
      expired: q.status === QuoteStatus.SENT && this.expired(q),
      canAnswer: q.status === QuoteStatus.SENT && !this.expired(q),
    };
  }

  async answer(token: string, accept: boolean, input: { name?: string; reason?: string }) {
    const q = await this.byToken(token);
    if (q.status !== QuoteStatus.SENT) throw new BadRequestException(q.status === QuoteStatus.ACCEPTED ? 'You have already accepted this quote. Thank you!' : 'You have already answered this quote.');
    if (this.expired(q)) throw new BadRequestException('This quote has expired. Ask the company for a new one.');
    const name = input.name?.trim().slice(0, 80) || q.customerName;
    // only the first answer counts, even if the page was open on two phones
    const done = await this.prisma.quote.updateMany({
      where: { id: q.id, status: QuoteStatus.SENT },
      data: { status: accept ? QuoteStatus.ACCEPTED : QuoteStatus.DECLINED, decidedAt: new Date(), decidedName: name, declineReason: accept ? null : input.reason?.trim().slice(0, 500) || null },
    });
    if (!done.count) throw new BadRequestException('You have already answered this quote.');
    await this.audit.record(q.homeId, null, accept ? 'quote.accepted' : 'quote.declined', q.id, { ref: quoteRef(q.number), customer: name, total: q.total }, q.orgId);
    await this.notices.superAdmins(q.orgId, {
      kind: 'quoteAnswered', severity: accept ? 'INFO' : 'WARN',
      title: `${q.customerName} ${accept ? 'accepted' : 'declined'} quote ${quoteRef(q.number)}`,
      body: accept ? `Rs ${q.total.toLocaleString('en-PK')}. Turn it into an installation job and pick the installer.` : input.reason?.trim() ? `They said: ${input.reason.trim().slice(0, 200)}` : 'No reason given. A call may help.',
      link: q.visitRequestId ? `/console/requests?id=${q.visitRequestId}` : q.homeId ? `/console/homes/${q.homeId}?tab=installation` : '/console/requests',
    }, q.homeId);
    this.realtime.visitsChanged(q.orgId);
    return this.publicView(token);
  }

  // ---------------------------------------------------------------- accepted: an installation job
  /**
   * One step from an accepted quote to work for an installer: the customer's home (made from the visit
   * request if there is none yet, with the owner's invite when an email is given), the installer, and
   * the visit request marked as a customer. The quote's items then show on the installation report.
   */
  async convert(user: AuthUser, id: string, input: { installerId: string; homeName?: string; ownerEmail?: string; ownerName?: string; rooms?: string[] }) {
    if (user.staffRole !== StaffRole.SUPERADMIN) throw new ForbiddenException('Only a super admin can start an installation job.');
    const q = await this.find(user, id);
    if (q.status !== QuoteStatus.ACCEPTED) throw new BadRequestException('Only an accepted quote can become an installation job.');
    if (q.convertedAt) throw new BadRequestException('This quote is already an installation job.');
    const visit = q.visitRequestId ? await this.prisma.visitRequest.findFirst({ where: { id: q.visitRequestId, orgId: q.orgId } }) : null;
    let homeId = q.homeId ?? visit?.homeId ?? null;
    let invite: { token: string; path: string } | null = null;
    if (!homeId) {
      const first = q.customerName.trim().split(/\s+/)[0] || q.customerName;
      const made = await this.platform.createHome(user, {
        name: input.homeName?.trim() || `${first}’s home`, city: visit && visit.city !== 'Somewhere else' ? visit.city : q.city,
        installerId: input.installerId, rooms: input.rooms ?? ['Living room', 'Kitchen', 'Bedroom'],
        owner: input.ownerEmail ? { email: input.ownerEmail.trim().toLowerCase(), name: input.ownerName?.trim() || q.customerName } : null,
      });
      homeId = made.id;
      invite = made.invite;
    } else {
      await this.platform.updateHome(user, homeId, { installerId: input.installerId });
    }
    if (visit) await this.visits.update(user, visit.id, { homeId, status: VisitStatus.CUSTOMER });
    await this.prisma.quote.update({ where: { id }, data: { homeId, convertedAt: new Date() } });
    const installer = await this.prisma.user.findUnique({ where: { id: input.installerId }, select: { name: true } });
    await this.audit.record(homeId, user.id, 'quote.convert', id, { ref: quoteRef(q.number), installer: installer?.name ?? null, total: q.total }, q.orgId);
    if (input.installerId !== user.id) {
      await this.notices.people([input.installerId], {
        kind: 'newJob', severity: 'INFO', title: `New installation job: ${q.customerName}`,
        body: `Quote ${quoteRef(q.number)} was accepted. The items to install are on the home's Installation tab.`,
        link: `/console/homes/${homeId}?tab=installation`,
      }, homeId);
    }
    return { homeId, invite, quote: await this.get(user, id) };
  }

  /** What the customer accepted for a home, for the installation report ("what to install"). */
  async toInstall(homeId: string) {
    const rows = await this.prisma.quote.findMany({ where: { homeId, status: QuoteStatus.ACCEPTED }, orderBy: { number: 'asc' } });
    return acceptedItems(rows.map((q) => ({ number: q.number, decidedAt: q.decidedAt, items: q.items as unknown as QuoteLine[] })));
  }

  /** The same, for staff who may see that home. */
  async toInstallFor(user: AuthUser, homeId: string) {
    const home = await this.prisma.home.findFirst({ where: { ...this.platform.homeWhere(user), id: homeId }, select: { id: true } });
    if (!home) throw new NotFoundException('No such home.');
    return this.toInstall(home.id);
  }
}

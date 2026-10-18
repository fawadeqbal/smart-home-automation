import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { BillingPeriod, ContractStatus, InvoiceStatus, Prisma, Role, StaffRole } from '@prisma/client';
import { AuthUser, isAdmin } from '../auth/auth.types';
import { localDate } from '../automation/time';
import { AuditService } from '../common/audit.service';
import { homeContacts } from '../common/contacts';
import { StaffNoticesService } from '../common/staff-notices.service';
import { SETTINGS, Settings } from '../config';
import { MailService } from '../mail/mail.service';
import { MonitoringService } from '../monitoring/monitoring.service';
import { PlatformService } from '../platform/platform.service';
import { PrismaService } from '../prisma/prisma.service';
import { addMonths, daysLeft, LAPSED_DAYS, onRenewalList, reminderDue, renewedEnd, RENEWAL_WINDOW_DAYS } from './renewals';

const DAY = 86_400_000;
export const PERIOD_MONTHS: Record<BillingPeriod, number> = { MONTHLY: 1, QUARTERLY: 3, YEARLY: 12 };
export const PERIOD_TEXT: Record<BillingPeriod, string> = { MONTHLY: 'a month', QUARTERLY: 'a quarter', YEARLY: 'a year' };
export const METHODS = ['cash', 'bank', 'jazzcash', 'easypaisa', 'cheque', 'other'] as const;
const DUE_DAYS = 10;

/** A calendar day as midnight UTC (dates here are days, not instants). */
export const dayOf = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
export const todayIn = (tz: string, now = new Date()) => { const d = localDate(tz, now); return dayOf(d.y, d.m, d.d); };
export const isoDay = (d: Date) => d.toISOString().slice(0, 10);

// kept here too for the code and tests that import it from billing
export { addMonths };

export const rupees = (n: number) => `Rs ${n.toLocaleString('en-PK')}`;

/** What a period's invoice says: "Care plan, 1 Oct – 31 Oct 2026". */
export function periodText(plan: string, from: Date, period: BillingPeriod) {
  const to = new Date(addMonths(from, PERIOD_MONTHS[period]).getTime() - DAY);
  const f = (d: Date, year: boolean) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(year ? { year: 'numeric' } : {}), timeZone: 'UTC' });
  return `${plan}, ${f(from, from.getUTCFullYear() !== to.getUTCFullYear())} – ${f(to, true)}`;
}

/** Monthly value of a contract (for the "per month" total). */
export const monthly = (c: { amount: number; period: BillingPeriod }) => Math.round(c.amount / PERIOD_MONTHS[c.period]);

/**
 * Maintenance contracts and invoices. Contracts bill themselves each period; one-off invoices
 * cover visits and new work. Payment is recorded by the team (cash, bank, JazzCash…); the home
 * sees its plan and bills, and gets a notice (and email) for each new bill and when one is late.
 */
@Injectable()
export class BillingService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Billing');
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly platform: PlatformService,
    private readonly monitoring: MonitoringService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly notices: StaffNoticesService,
    @Inject(SETTINGS) private readonly settings: Settings,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.tick(), 60 * 60_000);
    setTimeout(() => void this.tick(), 30_000).unref();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  private editor(staff: AuthUser) {
    if (staff.staffRole !== StaffRole.SUPERADMIN) throw new ForbiddenException('Only a super admin can change contracts and invoices.');
  }

  private async home(staff: AuthUser, homeId: string) {
    const h = await this.prisma.home.findFirst({ where: { ...this.platform.homeWhere(staff), id: homeId }, select: { id: true, name: true, orgId: true, timezone: true } });
    if (!h) throw new NotFoundException('No such home.');
    return h;
  }

  // ---------------------------------------------------------------- the console
  async overview(staff: AuthUser, now = new Date()) {
    if (staff.staffRole === StaffRole.INSTALLER) throw new ForbiddenException('Billing is for super admins and support.');
    const where = { home: this.platform.homeWhere(staff) };
    const [contracts, invoices] = await Promise.all([
      this.prisma.contract.findMany({ where, include: { home: { select: { name: true, city: true } } }, orderBy: [{ status: 'asc' }, { createdAt: 'desc' }] }),
      this.prisma.invoice.findMany({ where, include: { home: { select: { name: true, city: true } } }, orderBy: [{ number: 'desc' }], take: 500 }),
    ]);
    const today = todayIn('Asia/Karachi', now);
    const monthStart = dayOf(today.getUTCFullYear(), today.getUTCMonth() + 1, 1);
    const due = invoices.filter((i) => i.status === InvoiceStatus.DUE);
    const [company, contacts, renewals] = await Promise.all([
      this.company(staff.orgId!),
      homeContacts(this.prisma, [...contracts.map((c) => c.homeId), ...due.map((i) => i.homeId)]),
      this.renewalCount(staff, now),
    ]);
    const late = due.filter((i) => i.dueOn < today);
    return {
      kpis: {
        perMonth: contracts.filter((c) => c.status === ContractStatus.ACTIVE).reduce((a, c) => a + monthly(c), 0),
        active: contracts.filter((c) => c.status === ContractStatus.ACTIVE).length,
        due: due.reduce((a, i) => a + i.amount, 0), dueCount: due.length,
        late: late.reduce((a, i) => a + i.amount, 0), lateCount: late.length,
        paidThisMonth: invoices.filter((i) => i.status === InvoiceStatus.PAID && i.paidOn && i.paidOn >= monthStart).reduce((a, i) => a + i.amount, 0),
      },
      contracts: contracts.map((c) => this.contractDto(c)),
      invoices: invoices.map((i) => this.invoiceDto(i, today)),
      canEdit: staff.staffRole === StaffRole.SUPERADMIN,
      // for WhatsApp reminders: how to pay, and who to send them to
      company, contacts: Object.fromEntries(contacts), renewals,
    };
  }

  /** The company's name and how customers pay it (in invoice reminders). */
  private async company(orgId: string) {
    const o = await this.prisma.organization.findUniqueOrThrow({ where: { id: orgId }, select: { name: true, bankAccount: true, jazzcashNumber: true, easypaisaNumber: true } });
    return { name: o.name, pay: { bank: o.bankAccount, jazzcash: o.jazzcashNumber, easypaisa: o.easypaisaNumber } };
  }

  // ---------------------------------------------------------------- renewals
  /**
   * Contracts with an end date that could need renewing. An ended one counts only while its home has
   * no newer contract running (renewed by making a new contract is renewed too).
   */
  private async candidates(staff: AuthUser) {
    const rows = await this.prisma.contract.findMany({
      where: { home: this.platform.homeWhere(staff), endsOn: { not: null } },
      include: { home: { select: { name: true, city: true, timezone: true, archivedAt: true } } }, orderBy: { endsOn: 'asc' },
    });
    const running = new Set((await this.prisma.contract.findMany({
      where: { home: this.platform.homeWhere(staff), status: { not: ContractStatus.ENDED } }, select: { homeId: true },
    })).map((c) => c.homeId));
    return rows.filter((c) => !c.home.archivedAt && (c.status !== ContractStatus.ENDED || !running.has(c.homeId)));
  }

  private async renewalCount(staff: AuthUser, now: Date) {
    const rows = await this.candidates(staff);
    return rows.filter((c) => onRenewalList(c.endsOn, todayIn(c.home.timezone, now))).length;
  }

  /** Contracts ending in the next 60 days, and ones that ended without being renewed. */
  async renewals(staff: AuthUser, now = new Date()) {
    if (staff.staffRole === StaffRole.INSTALLER) throw new ForbiddenException('Billing is for super admins and support.');
    const rows = (await this.candidates(staff)).filter((c) => onRenewalList(c.endsOn, todayIn(c.home.timezone, now)));
    const [company, contacts] = await Promise.all([this.company(staff.orgId!), homeContacts(this.prisma, rows.map((c) => c.homeId))]);
    return {
      windowDays: RENEWAL_WINDOW_DAYS, lapsedDays: LAPSED_DAYS, company, canEdit: staff.staffRole === StaffRole.SUPERADMIN,
      contracts: rows.map((c) => {
        const left = daysLeft(c.endsOn!, todayIn(c.home.timezone, now));
        return { ...this.contractDto(c), daysLeft: left, ended: left < 0 || c.status === ContractStatus.ENDED, contact: contacts.get(c.homeId) ?? null };
      }),
    };
  }

  /** One more term: 3, 6 or 12 months after the current end (or until a chosen day), optionally at a new price. */
  async renew(staff: AuthUser, id: string, input: { months?: number; until?: string; amount?: number }, now = new Date()) {
    this.editor(staff);
    const c = await this.prisma.contract.findFirst({ where: { id, home: this.platform.homeWhere(staff) }, include: { home: { select: { name: true, timezone: true } } } });
    if (!c) throw new NotFoundException('No such contract.');
    if (!c.endsOn) throw new BadRequestException('This contract has no end date, so there is nothing to renew.');
    const today = todayIn(c.home.timezone, now);
    if (c.status === ContractStatus.ENDED) {
      const newer = await this.prisma.contract.findFirst({ where: { homeId: c.homeId, status: { not: ContractStatus.ENDED }, id: { not: c.id } } });
      if (newer) throw new BadRequestException(`${c.home.name} already has a newer contract (${newer.plan}).`);
    }
    let endsOn: Date;
    if (input.until) {
      endsOn = this.parseDay(input.until);
      const after = c.endsOn > today ? c.endsOn : today;
      if (endsOn <= after) throw new BadRequestException(`Pick a day after ${isoDay(after)}.`);
    } else if (input.months && [3, 6, 12].includes(input.months)) {
      endsOn = renewedEnd(c.endsOn, today, input.months);
    } else {
      throw new BadRequestException('Renew for 3, 6 or 12 months, or pick an end date.');
    }
    const data: Prisma.ContractUpdateInput = { endsOn, remind30At: null, remind7At: null };
    if (input.amount !== undefined) data.amount = input.amount;
    // a lapsed contract starts again from today: no bills for the weeks it had ended
    if (c.status === ContractStatus.ENDED || c.endsOn < today) {
      data.status = ContractStatus.ACTIVE;
      if (c.nextInvoiceOn < today) data.nextInvoiceOn = today;
    }
    await this.prisma.contract.update({ where: { id }, data });
    await this.audit.record(c.homeId, staff.id, 'contract.renew', id, {
      plan: c.plan, from: isoDay(c.endsOn), to: isoDay(endsOn), ...(input.months ? { months: input.months } : {}),
      ...(input.amount !== undefined && input.amount !== c.amount ? { amountFrom: c.amount, amount: input.amount } : {}),
    }, c.orgId);
    if (data.status === ContractStatus.ACTIVE) await this.issueDue(now, id);
    return this.renewals(staff, now);
  }

  /** Super admins hear 30 and 7 days before a contract ends (once each, remembered in the database). */
  async remindRenewals(now = new Date()) {
    const soon = new Date(now.getTime() + 32 * DAY);
    const rows = await this.prisma.contract.findMany({
      where: { status: { not: ContractStatus.ENDED }, endsOn: { not: null, lte: soon } },
      include: { home: { select: { name: true, timezone: true, archivedAt: true } } },
    });
    for (const c of rows) {
      if (c.home.archivedAt) continue;
      const left = daysLeft(c.endsOn!, todayIn(c.home.timezone, now));
      const due = reminderDue(left, c);
      if (!due) continue;
      // claim it first, so another tick (or a second server) can't send it again
      const claimed = await this.prisma.contract.updateMany({
        where: { id: c.id, ...(due === 30 ? { remind30At: null } : { remind7At: null }) },
        data: due === 30 ? { remind30At: now } : { remind7At: now, remind30At: c.remind30At ?? now },
      });
      if (!claimed.count) continue;
      const when = left === 0 ? 'today' : left === 1 ? 'tomorrow' : `in ${left} days`;
      await this.notices.superAdmins(c.orgId, {
        kind: 'contractEnding', severity: due === 7 ? 'WARN' : 'INFO',
        title: `${c.home.name}: contract ends ${when}`,
        body: `${c.plan}, ${rupees(c.amount)} ${PERIOD_TEXT[c.period]}, ends on ${c.endsOn!.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}. Renew it, or send the customer a reminder.`,
        link: '/console/billing?tab=renewals',
      }, c.homeId);
    }
  }

  async createContract(staff: AuthUser, input: { homeId: string; plan: string; amount: number; period: BillingPeriod; visitsIncluded?: number; startsOn: string; endsOn?: string | null; notes?: string }) {
    this.editor(staff);
    const home = await this.home(staff, input.homeId);
    const startsOn = this.parseDay(input.startsOn);
    const endsOn = input.endsOn ? this.parseDay(input.endsOn) : null;
    if (endsOn && endsOn <= startsOn) throw new BadRequestException('The end date must be after the start.');
    const open = await this.prisma.contract.findFirst({ where: { homeId: home.id, status: { not: ContractStatus.ENDED } } });
    if (open) throw new BadRequestException(`${home.name} already has a contract (${open.plan}). End it first.`);
    const c = await this.prisma.contract.create({
      data: {
        orgId: home.orgId, homeId: home.id, plan: input.plan.trim(), amount: input.amount, period: input.period, visitsIncluded: input.visitsIncluded ?? 0,
        startsOn, endsOn, nextInvoiceOn: startsOn, notes: input.notes?.trim() ?? '', createdById: staff.id,
      },
    });
    await this.audit.record(home.id, staff.id, 'contract.create', c.id, { plan: c.plan, amount: c.amount, period: c.period }, home.orgId);
    await this.issueDue(new Date(), c.id);
    return this.overview(staff);
  }

  async updateContract(staff: AuthUser, id: string, input: { status?: ContractStatus; plan?: string; amount?: number; visitsIncluded?: number; notes?: string; endsOn?: string | null }) {
    this.editor(staff);
    const c = await this.prisma.contract.findFirst({ where: { id, home: this.platform.homeWhere(staff) }, include: { home: { select: { timezone: true } } } });
    if (!c) throw new NotFoundException('No such contract.');
    if (c.status === ContractStatus.ENDED) throw new BadRequestException('This contract has ended. Make a new one.');
    const data: Prisma.ContractUpdateInput = {};
    if (input.plan?.trim()) data.plan = input.plan.trim();
    if (input.amount !== undefined) data.amount = input.amount;
    if (input.visitsIncluded !== undefined) data.visitsIncluded = input.visitsIncluded;
    if (input.notes !== undefined) data.notes = input.notes;
    if (input.endsOn !== undefined) data.endsOn = input.endsOn ? this.parseDay(input.endsOn) : null;
    if (input.status) {
      data.status = input.status;
      // resuming: bill from today on, not for the months it was paused
      if (input.status === ContractStatus.ACTIVE && c.status === ContractStatus.PAUSED) {
        const today = todayIn(c.home.timezone);
        if (c.nextInvoiceOn < today) data.nextInvoiceOn = today;
      }
      if (input.status === ContractStatus.ENDED) data.endsOn = c.endsOn ?? todayIn(c.home.timezone);
    }
    await this.prisma.contract.update({ where: { id }, data });
    await this.audit.record(c.homeId, staff.id, 'contract.update', id, { ...input }, c.orgId);
    if (input.status === ContractStatus.ACTIVE) await this.issueDue(new Date(), id);
    return this.overview(staff);
  }

  async createInvoice(staff: AuthUser, input: { homeId: string; description: string; amount: number; dueInDays?: number }) {
    this.editor(staff);
    const home = await this.home(staff, input.homeId);
    const today = todayIn(home.timezone);
    await this.issue({ orgId: home.orgId, homeId: home.id, description: input.description.trim(), amount: input.amount, issuedOn: today, dueOn: new Date(today.getTime() + (input.dueInDays ?? DUE_DAYS) * DAY), createdById: staff.id });
    return this.overview(staff);
  }

  async setInvoice(staff: AuthUser, id: string, input: { status: InvoiceStatus; method?: string; reference?: string; paidOn?: string }) {
    this.editor(staff);
    const inv = await this.prisma.invoice.findFirst({ where: { id, home: this.platform.homeWhere(staff) }, include: { home: { select: { timezone: true } } } });
    if (!inv) throw new NotFoundException('No such invoice.');
    const data: Prisma.InvoiceUpdateInput = { status: input.status };
    if (input.status === InvoiceStatus.PAID) {
      if (!input.method || !METHODS.includes(input.method as never)) throw new BadRequestException('How was it paid?');
      data.method = input.method;
      data.reference = input.reference?.trim().slice(0, 80) || null;
      data.paidOn = input.paidOn ? this.parseDay(input.paidOn) : todayIn(inv.home.timezone);
    } else {
      data.method = null;
      data.reference = null;
      data.paidOn = null;
    }
    await this.prisma.invoice.update({ where: { id }, data });
    await this.audit.record(inv.homeId, staff.id, `invoice.${input.status.toLowerCase()}`, id, { number: inv.number, amount: inv.amount, method: input.method ?? null }, inv.orgId);
    if (input.status === InvoiceStatus.PAID) {
      await this.tellHome(inv.homeId, { title: `Payment received: invoice ${inv.number}`, body: `${rupees(inv.amount)} received with thanks (${input.method}).`, severity: 'INFO' });
    }
    return this.overview(staff);
  }

  // ---------------------------------------------------------------- the home
  async forHome(user: AuthUser, now = new Date()) {
    if (!isAdmin(user.role)) throw new ForbiddenException('The plan and bills are for the home’s owner and admins.');
    const home = await this.prisma.home.findUniqueOrThrow({ where: { id: user.homeId }, select: { timezone: true, orgId: true, org: { select: { name: true } } } });
    const [contract, invoices] = await Promise.all([
      this.prisma.contract.findFirst({ where: { homeId: user.homeId, status: { not: ContractStatus.ENDED } }, include: { home: { select: { name: true, city: true } } } }),
      this.prisma.invoice.findMany({ where: { homeId: user.homeId, status: { not: InvoiceStatus.VOID } }, include: { home: { select: { name: true, city: true } } }, orderBy: { number: 'desc' } }),
    ]);
    const today = todayIn(home.timezone, now);
    return {
      company: home.org.name, pay: (await this.company(home.orgId)).pay,
      contract: contract ? this.contractDto(contract) : null,
      invoices: invoices.map((i) => this.invoiceDto(i, today)),
      due: invoices.filter((i) => i.status === InvoiceStatus.DUE).reduce((a, i) => a + i.amount, 0),
    };
  }

  /** One invoice, printable: for the team, or the home's owner and admins. */
  async invoice(user: AuthUser, id: string) {
    const inv = await this.prisma.invoice.findUnique({
      where: { id },
      include: { home: { select: { name: true, city: true, timezone: true, orgId: true, memberships: { where: { role: Role.OWNER }, select: { user: { select: { name: true, email: true } } } } } },
        org: { select: { name: true, billingEmail: true, taxId: true, logo: true, bankAccount: true, jazzcashNumber: true, easypaisaNumber: true } }, contract: { select: { plan: true, period: true } } },
    });
    if (!inv) throw new NotFoundException('No such invoice.');
    const staffOk = !!user.staffRole && user.staffRole !== StaffRole.INSTALLER && !!(await this.prisma.home.findFirst({ where: { ...this.platform.homeWhere(user), id: inv.homeId }, select: { id: true } }));
    const homeOk = inv.homeId === user.homeId && isAdmin(user.role) && !user.viaStaff;
    if (!staffOk && !homeOk) throw new NotFoundException('No such invoice.');
    const { bankAccount, jazzcashNumber, easypaisaNumber, ...company } = inv.org;
    return {
      ...this.invoiceDto(inv, todayIn(inv.home.timezone)),
      company, pay: { bank: bankAccount, jazzcash: jazzcashNumber, easypaisa: easypaisaNumber },
      billTo: { home: inv.home.name, city: inv.home.city, owner: inv.home.memberships[0]?.user ?? null },
      contract: inv.contract,
      // staff send reminders on WhatsApp: straight to this number when there is one
      contact: staffOk ? (await homeContacts(this.prisma, [inv.homeId])).get(inv.homeId) ?? null : null,
    };
  }

  // ---------------------------------------------------------------- the clock: bills and reminders
  async tick(now = new Date()) {
    try {
      await this.issueDue(now);
      await this.remind(now);
      await this.remindRenewals(now);
    } catch (err) {
      this.log.warn(`Billing tick failed: ${(err as Error).message}`);
    }
  }

  /** Every active contract whose day has come gets its invoice (several, if the server was off for a while). */
  async issueDue(now = new Date(), onlyId?: string) {
    const contracts = await this.prisma.contract.findMany({
      where: { status: ContractStatus.ACTIVE, ...(onlyId ? { id: onlyId } : {}) }, include: { home: { select: { timezone: true } } },
    });
    for (const c of contracts) {
      const today = todayIn(c.home.timezone, now);
      let next = c.nextInvoiceOn;
      for (let guard = 0; next <= today && guard < 24; guard++) {
        if (c.endsOn && next >= c.endsOn) {
          await this.prisma.contract.update({ where: { id: c.id }, data: { status: ContractStatus.ENDED } });
          break;
        }
        await this.issue({
          orgId: c.orgId, homeId: c.homeId, contractId: c.id, description: periodText(c.plan, next, c.period), amount: c.amount,
          issuedOn: today, dueOn: new Date(Math.max(today.getTime(), next.getTime()) + DUE_DAYS * DAY),
        });
        next = addMonths(next, PERIOD_MONTHS[c.period]);
        await this.prisma.contract.update({ where: { id: c.id }, data: { nextInvoiceOn: next } });
      }
    }
  }

  private async issue(data: { orgId: string; homeId: string; contractId?: string; description: string; amount: number; issuedOn: Date; dueOn: Date; createdById?: string }) {
    const inv = await this.prisma.$transaction(async (tx) => {
      const { invoiceSeq } = await tx.organization.update({ where: { id: data.orgId }, data: { invoiceSeq: { increment: 1 } }, select: { invoiceSeq: true } });
      return tx.invoice.create({ data: { ...data, number: invoiceSeq } });
    });
    this.log.log(`Invoice ${inv.number}: ${data.description} ${rupees(data.amount)}`);
    await this.tellHome(data.homeId, {
      title: `New bill: ${rupees(inv.amount)}`, body: `Invoice ${inv.number}: ${inv.description}. Due by ${inv.dueOn.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })}.`,
      severity: 'INFO', invoiceId: inv.id,
    });
    return inv;
  }

  /** A day after the due date, then every week while it stays unpaid. */
  private async remind(now: Date) {
    const late = await this.prisma.invoice.findMany({
      where: { status: InvoiceStatus.DUE, dueOn: { lt: new Date(now.getTime() - DAY) }, OR: [{ remindedAt: null }, { remindedAt: { lt: new Date(now.getTime() - 7 * DAY) } }] },
      take: 200,
    });
    for (const inv of late) {
      await this.prisma.invoice.update({ where: { id: inv.id }, data: { remindedAt: now } });
      await this.tellHome(inv.homeId, {
        title: `Bill overdue: ${rupees(inv.amount)}`, body: `Invoice ${inv.number} (${inv.description}) was due on ${inv.dueOn.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })}. If you've paid, tell us and we'll update it.`,
        severity: 'WARN', invoiceId: inv.id,
      });
    }
  }

  private async tellHome(homeId: string, n: { title: string; body: string; severity: 'INFO' | 'WARN'; invoiceId?: string }) {
    const admins = await this.prisma.membership.findMany({ where: { homeId, role: { in: [Role.OWNER, Role.ADMIN] }, user: { disabled: false } }, select: { user: { select: { id: true, email: true, notifyPrefs: true } } } });
    const link = n.invoiceId ? `/billing/${n.invoiceId}?home=${homeId}` : `/billing?home=${homeId}`;
    await this.monitoring.notify(homeId, admins.map((a) => a.user.id), { kind: 'billing', severity: n.severity, title: n.title, body: n.body, link });
    if (!this.mail.enabled) return;
    for (const a of admins) {
      if (((a.user.notifyPrefs ?? {}) as Record<string, boolean>).billing === false) continue;
      await this.mail.send({ to: a.user.email, subject: n.title, text: n.body, button: { label: 'Open the bill', url: `${this.settings.publicUrl}${link}` } });
    }
  }

  // ---------------------------------------------------------------- helpers
  private parseDay(s: string) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) throw new BadRequestException('Dates are YYYY-MM-DD.');
    return dayOf(Number(m[1]), Number(m[2]), Number(m[3]));
  }

  private contractDto(c: Prisma.ContractGetPayload<{ include: { home: { select: { name: true; city: true } } } }>) {
    return {
      id: c.id, homeId: c.homeId, home: c.home.name, city: c.home.city, plan: c.plan, amount: c.amount, period: c.period, periodText: PERIOD_TEXT[c.period],
      perMonth: monthly(c), visitsIncluded: c.visitsIncluded, startsOn: isoDay(c.startsOn), endsOn: c.endsOn ? isoDay(c.endsOn) : null,
      nextInvoiceOn: isoDay(c.nextInvoiceOn), status: c.status, notes: c.notes,
    };
  }

  private invoiceDto(i: Prisma.InvoiceGetPayload<{ include: { home: { select: { name: true; city: true } } } }>, today: Date) {
    return {
      id: i.id, number: i.number, homeId: i.homeId, home: i.home.name, city: i.home.city, contractId: i.contractId, description: i.description, amount: i.amount,
      issuedOn: isoDay(i.issuedOn), dueOn: isoDay(i.dueOn), status: i.status, late: i.status === InvoiceStatus.DUE && i.dueOn < today,
      paidOn: i.paidOn ? isoDay(i.paidOn) : null, method: i.method, reference: i.reference,
    };
  }
}

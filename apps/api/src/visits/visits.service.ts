import { BadRequestException, HttpException, HttpStatus, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma, VisitStatus } from '@prisma/client';
import type { Request } from 'express';
import { AuthUser } from '../auth/auth.types';
import { AuditService } from '../common/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';

export const VISIT_STATUS_LABEL: Record<VisitStatus, string> = {
  NEW: 'New', CONTACTED: 'Called', SCHEDULED: 'Visit booked', CUSTOMER: 'Customer', CLOSED: 'Not now',
};

const PER_IP_PER_HOUR = 5;
const ALL_PER_HOUR = 300;
const HOUR = 3_600_000;

/** The visitor's address. Behind our own proxy (Next.js, Traefik: a local address) it is in X-Forwarded-For. */
export function clientIp(req: Request): string {
  const peer = (req.socket?.remoteAddress ?? '').replace(/^::ffff:/, '');
  const local = peer === '::1' || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(peer);
  const forwarded = String(req.headers['x-forwarded-for'] ?? '').split(',')[0]!.trim();
  return local && forwarded ? forwarded : peer || 'unknown';
}

/**
 * "Book a free visit" from the public landing page. Anyone may send one (rate-limited); the organization
 * that runs the site sees them in the console (Visit requests) and turns them into customers.
 */
@Injectable()
export class VisitsService {
  private readonly perIp = new Map<string, number[]>();
  private all: number[] = [];

  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly realtime: RealtimeService) {}

  async create(input: { name: string; phone: string; city: string; homeSize: string; website?: string }, ip: string) {
    // the hidden "website" field is only ever filled in by bots: thank them and store nothing
    if (input.website) return { ok: true };
    this.limit(ip);
    // the site belongs to the organization that runs this install (the self-hosted one, else the first)
    const org = await this.prisma.organization.findFirst({ orderBy: [{ selfHosted: 'desc' }, { createdAt: 'asc' }], select: { id: true } });
    if (!org) throw new ServiceUnavailableException('Bookings open soon. Please try again later.');
    const row = await this.prisma.visitRequest.create({
      data: { orgId: org.id, name: input.name, phone: input.phone, city: input.city, homeSize: input.homeSize },
    });
    await this.audit.record(null, null, 'visit.requested', row.id, { name: row.name, city: row.city, homeSize: row.homeSize }, org.id);
    this.realtime.visitsChanged(org.id);
    return { ok: true };
  }

  async list(user: AuthUser) {
    const orgId = this.org(user);
    const rows = await this.prisma.visitRequest.findMany({ where: { orgId }, orderBy: { createdAt: 'desc' }, take: 500 });
    const homeIds = rows.map((r) => r.homeId).filter((x): x is string => !!x);
    const people = rows.map((r) => r.handledById).filter((x): x is string => !!x);
    const [homes, staff] = await Promise.all([
      homeIds.length ? this.prisma.home.findMany({ where: { id: { in: homeIds }, orgId }, select: { id: true, name: true } }) : [],
      people.length ? this.prisma.user.findMany({ where: { id: { in: people } }, select: { id: true, name: true } }) : [],
    ]);
    const counts = Object.fromEntries(Object.keys(VISIT_STATUS_LABEL).map((k) => [k, rows.filter((r) => r.status === k).length]));
    return {
      counts,
      requests: rows.map((r) => ({
        id: r.id, name: r.name, phone: r.phone, city: r.city, homeSize: r.homeSize, status: r.status,
        statusLabel: VISIT_STATUS_LABEL[r.status], note: r.note, createdAt: r.createdAt, updatedAt: r.updatedAt,
        home: r.homeId ? homes.find((h) => h.id === r.homeId) ?? null : null,
        handledBy: r.handledById ? staff.find((s) => s.id === r.handledById)?.name ?? null : null,
      })),
    };
  }

  /** How many are waiting for a call (the console's badge). */
  async waiting(orgId: string) {
    return this.prisma.visitRequest.count({ where: { orgId, status: VisitStatus.NEW } });
  }

  async update(user: AuthUser, id: string, input: { status?: VisitStatus; note?: string; homeId?: string | null }) {
    const orgId = this.org(user);
    const row = await this.prisma.visitRequest.findFirst({ where: { id, orgId } });
    if (!row) throw new NotFoundException('No such request.');
    if (input.homeId) {
      const home = await this.prisma.home.findFirst({ where: { id: input.homeId, orgId }, select: { id: true } });
      if (!home) throw new BadRequestException('That home is not in your organization.');
    }
    const data: Prisma.VisitRequestUpdateInput = { handledById: user.id };
    if (input.status) data.status = input.status;
    if (input.note !== undefined) data.note = input.note;
    if (input.homeId !== undefined) data.homeId = input.homeId;
    const updated = await this.prisma.visitRequest.update({ where: { id }, data });
    if (input.status && input.status !== row.status) {
      await this.audit.record(null, user.id, 'visit.update', id, { name: row.name, from: row.status, to: input.status }, orgId);
    }
    this.realtime.visitsChanged(orgId);
    return { id: updated.id, status: updated.status };
  }

  private limit(ip: string) {
    const now = Date.now();
    this.all = this.all.filter((t) => now - t < HOUR);
    const mine = (this.perIp.get(ip) ?? []).filter((t) => now - t < HOUR);
    if (mine.length >= PER_IP_PER_HOUR || this.all.length >= ALL_PER_HOUR) {
      throw new HttpException('Too many requests. Please try again later.', HttpStatus.TOO_MANY_REQUESTS);
    }
    mine.push(now);
    this.all.push(now);
    this.perIp.set(ip, mine);
    if (this.perIp.size > 10_000) this.perIp.clear(); // never grow without bound
  }

  private org(user: AuthUser) {
    if (!user.orgId) throw new NotFoundException('No organization.');
    return user.orgId;
  }
}

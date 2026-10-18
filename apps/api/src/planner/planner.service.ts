import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { NodeStatus, StaffRole, TicketStatus, VisitStatus } from '@prisma/client';
import { AuthUser } from '../auth/auth.types';
import { localDate, zonedToUtc } from '../automation/time';
import { normalisePhone } from '../common/phone';
import { homeContacts } from '../common/contacts';
import { PrismaService } from '../prisma/prisma.service';
import { VISIT_TZ } from '../visits/visits.service';
import { directionsTo, mapsRoute, orderStops } from './route';

const OPEN: TicketStatus[] = [TicketStatus.OPEN, TicketStatus.IN_PROGRESS, TicketStatus.WAITING];

export interface Job {
  type: 'visit' | 'install' | 'ticket';
  title: string;
  detail: string;
  /** a booked visit's time */
  at: string | null;
  link: string;
  priority?: string;
}

interface Stop {
  key: string;
  kind: 'home' | 'visit';
  name: string;
  city: string;
  lat: number | null;
  lng: number | null;
  homeId: string | null;
  visitRequestId: string | null;
  phone: string | null;
  whatsapp: string | null;
  jobs: Job[];
}

/**
 * "My day" for an installer: the visits booked for them that day, the homes they are installing, and
 * the open tickets they hold, as stops in a suggested driving order from the company's base.
 */
@Injectable()
export class PlannerService {
  constructor(private readonly prisma: PrismaService) {}

  async day(user: AuthUser, input: { installerId?: string; date?: string }) {
    const orgId = user.orgId;
    if (!orgId || !user.staffRole) throw new ForbiddenException('This is for platform staff only.');
    // installers see their own day; super admins and support may look at anyone's
    let installerId = input.installerId || user.id;
    if (user.staffRole === StaffRole.INSTALLER && installerId !== user.id) throw new ForbiddenException('You can only see your own day.');
    const team = await this.prisma.user.findMany({
      where: { orgId, disabled: false, staffRole: { in: [StaffRole.INSTALLER, StaffRole.SUPERADMIN] } },
      select: { id: true, name: true, staffRole: true }, orderBy: { name: 'asc' },
    });
    if (!team.some((t) => t.id === installerId)) {
      if (user.staffRole === StaffRole.SUPPORT && !input.installerId) installerId = team.find((t) => t.staffRole === StaffRole.INSTALLER)?.id ?? team[0]?.id ?? '';
      else throw new BadRequestException('Pick an installer from your team.');
    }
    const day = this.parseDate(input.date);
    const from = zonedToUtc(VISIT_TZ, day.y, day.m, day.d, 0, 0);
    const to = zonedToUtc(VISIT_TZ, day.y, day.m, day.d + 1, 0, 0);

    // installations and tickets are ongoing work: they show on today and later days, not on past ones
    const today = localDate(VISIT_TZ, new Date());
    const ongoing = Date.UTC(day.y, day.m - 1, day.d) >= Date.UTC(today.y, today.m - 1, today.d);
    const [org, visits, homes, tickets] = await Promise.all([
      this.prisma.organization.findUniqueOrThrow({ where: { id: orgId }, select: { baseLat: true, baseLng: true, name: true } }),
      this.prisma.visitRequest.findMany({ where: { orgId, assigneeId: installerId, status: VisitStatus.SCHEDULED, visitAt: { gte: from, lt: to } }, orderBy: { visitAt: 'asc' } }),
      // homes being installed: boards waiting to go in, a report not signed yet, or a new job (nothing installed, no report)
      !ongoing ? [] : this.prisma.home.findMany({
        where: {
          orgId, installerId, archivedAt: null,
          OR: [
            { nodes: { some: { status: NodeStatus.ASSIGNED } } },
            { installation: { is: { signedAt: null } } },
            { installation: { is: null }, nodes: { none: { status: NodeStatus.ADOPTED } } },
          ],
        },
        select: {
          id: true, name: true, city: true, latitude: true, longitude: true,
          nodes: { where: { status: NodeStatus.ASSIGNED }, select: { id: true } },
          installation: { select: { items: true, signedAt: true } },
        },
      }),
      !ongoing ? [] : this.prisma.ticket.findMany({
        where: { orgId, assigneeId: installerId, status: { in: OPEN }, home: { archivedAt: null } },
        select: { id: true, number: true, title: true, priority: true, status: true, homeId: true, home: { select: { name: true, city: true, latitude: true, longitude: true } } },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    const stops = new Map<string, Stop>();
    const homeStop = (h: { id: string; name: string; city: string; latitude: number | null; longitude: number | null }) => {
      let s = stops.get(h.id);
      if (!s) {
        s = { key: h.id, kind: 'home', name: h.name, city: h.city, lat: h.latitude, lng: h.longitude, homeId: h.id, visitRequestId: null, phone: null, whatsapp: null, jobs: [] };
        stops.set(h.id, s);
      }
      return s;
    };
    const visitHomes = visits.map((v) => v.homeId).filter((x): x is string => !!x);
    const knownHomes = visitHomes.length ? await this.prisma.home.findMany({ where: { id: { in: visitHomes }, orgId }, select: { id: true, name: true, city: true, latitude: true, longitude: true } }) : [];
    for (const v of visits) {
      const time = v.visitAt!.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: VISIT_TZ });
      const job: Job = { type: 'visit', title: `Home visit: ${v.name}`, detail: `${v.homeSize} · ${v.city}${v.note ? ` · ${v.note.slice(0, 120)}` : ''}`, at: v.visitAt!.toISOString(), link: `/console/requests?id=${v.id}` };
      job.detail = `${time} · ${job.detail}`;
      const h = v.homeId ? knownHomes.find((x) => x.id === v.homeId) : null;
      const s = h ? homeStop(h) : (() => {
        const n: Stop = { key: `visit:${v.id}`, kind: 'visit', name: v.name, city: v.city === 'Somewhere else' ? '' : v.city, lat: null, lng: null, homeId: null, visitRequestId: v.id, phone: v.phone, whatsapp: normalisePhone(v.phone), jobs: [] };
        stops.set(n.key, n);
        return n;
      })();
      s.jobs.push(job);
    }
    for (const h of homes) {
      const items = (h.installation?.items ?? []) as { done?: boolean }[];
      const done = items.filter((i) => i.done).length;
      const parts = [
        h.nodes.length ? `${h.nodes.length} board${h.nodes.length === 1 ? '' : 's'} to install` : null,
        items.length ? `checklist ${done} of ${items.length}` : null,
      ].filter(Boolean);
      homeStop(h).jobs.push({ type: 'install', title: 'Installation', detail: parts.join(' · ') || 'Not started', at: null, link: `/console/homes/${h.id}?tab=installation` });
    }
    for (const t of tickets) {
      homeStop({ id: t.homeId, ...t.home }).jobs.push({
        type: 'ticket', title: `#${t.number} · ${t.title}`, detail: t.status === TicketStatus.WAITING ? 'Waiting for the home' : t.priority === 'URGENT' ? 'Urgent' : t.priority === 'HIGH' ? 'High priority' : 'Open',
        at: null, link: `/console/tickets/${t.id}`, priority: t.priority,
      });
    }
    // a phone number to call at each home
    const contacts = await homeContacts(this.prisma, [...stops.values()].filter((s) => s.homeId).map((s) => s.homeId!));
    for (const s of stops.values()) {
      if (!s.homeId) continue;
      const c = contacts.get(s.homeId);
      if (c?.whatsapp) { s.whatsapp = c.whatsapp; s.phone = `+${c.whatsapp}`; }
    }

    const base = org.baseLat !== null && org.baseLng !== null ? { lat: org.baseLat, lng: org.baseLng } : null;
    const { ordered, totalKm } = orderStops(base, [...stops.values()]);
    const installer = team.find((t) => t.id === installerId) ?? null;
    return {
      date: `${day.y}-${String(day.m).padStart(2, '0')}-${String(day.d).padStart(2, '0')}`,
      installer: installer ? { id: installer.id, name: installer.name } : null,
      installers: user.staffRole === StaffRole.INSTALLER ? [] : team.map((t) => ({ id: t.id, name: t.name, staffRole: t.staffRole })),
      base, baseSet: !!base, totalKm,
      mapsUrl: mapsRoute(base, ordered),
      stops: ordered.map((s, i) => ({ ...s, n: i + 1, located: s.lat !== null && s.lng !== null, directions: directionsTo(s) })),
      counts: { visits: visits.length, installs: homes.length, tickets: tickets.length },
    };
  }

  /** "2026-10-20", or today in Pakistan. */
  private parseDate(s?: string) {
    if (!s) { const d = localDate(VISIT_TZ, new Date()); return { y: d.y, m: d.m, d: d.d }; }
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) throw new BadRequestException('Dates are YYYY-MM-DD.');
    return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  }
}

import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { normalisePhone } from './phone';

export interface Contact { name: string | null; whatsapp: string | null }

/**
 * Who to message about a home, and their WhatsApp number: the owner's own phone (their account),
 * else an admin's, else the number they gave when they booked the visit. No number: null (the
 * screens then offer the share sheet instead).
 */
export async function homeContacts(prisma: PrismaService, homeIds: string[]): Promise<Map<string, Contact>> {
  const ids = [...new Set(homeIds)];
  const out = new Map<string, Contact>();
  if (!ids.length) return out;
  const [people, visits] = await Promise.all([
    prisma.membership.findMany({
      where: { homeId: { in: ids }, role: { in: [Role.OWNER, Role.ADMIN] }, user: { disabled: false } },
      select: { homeId: true, role: true, user: { select: { name: true, phone: true } } },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.visitRequest.findMany({ where: { homeId: { in: ids } }, select: { homeId: true, name: true, phone: true }, orderBy: { createdAt: 'desc' } }),
  ]);
  for (const id of ids) {
    const mine = people.filter((p) => p.homeId === id).sort((a, b) => Number(b.role === Role.OWNER) - Number(a.role === Role.OWNER));
    const owner = mine[0]?.user ?? null;
    const withPhone = mine.find((p) => normalisePhone(p.user.phone));
    const visit = visits.find((v) => v.homeId === id && normalisePhone(v.phone));
    if (withPhone) out.set(id, { name: withPhone.user.name, whatsapp: normalisePhone(withPhone.user.phone) });
    else if (visit) out.set(id, { name: owner?.name ?? visit.name, whatsapp: normalisePhone(visit.phone) });
    else out.set(id, { name: owner?.name ?? null, whatsapp: null });
  }
  return out;
}

/** One home's contact. */
export async function homeContact(prisma: PrismaService, homeId: string): Promise<Contact> {
  return (await homeContacts(prisma, [homeId])).get(homeId) ?? { name: null, whatsapp: null };
}

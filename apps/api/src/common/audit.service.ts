import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Which filter an action shows under in the audit log. */
export function auditCategory(action: string): 'setup' | 'access' | 'devices' | 'system' | 'billing' {
  if (/^(user|invite|staff|role|membership)\./.test(action) || action === 'user.rooms') return 'access';
  if (/^(org|plan|billing)\./.test(action)) return 'billing';
  if (/^(board\.(offline|online)|system\.)/.test(action) || action === 'diagnostics.view') return 'system';
  if (/^(device\.(rename|command)|scene\.|schedule\.)/.test(action)) return 'devices';
  return 'setup';
}

/** Records who changed what: people, rights, rooms, boards, pins, inventory, staff and billing. */
@Injectable()
export class AuditService {
  private readonly log = new Logger('Audit');
  private readonly orgOfHome = new Map<string, string>();

  constructor(private readonly prisma: PrismaService) {}

  /** homeId null = an organization-wide change (pass orgId). The home's organization is looked up. */
  async record(homeId: string | null, userId: string | null, action: string, target: string, details: object = {}, orgId?: string | null) {
    try {
      let org = orgId ?? null;
      if (!org && homeId) {
        org = this.orgOfHome.get(homeId) ?? (await this.prisma.home.findUnique({ where: { id: homeId }, select: { orgId: true } }))?.orgId ?? null;
        if (org) this.orgOfHome.set(homeId, org);
      }
      await this.prisma.auditLog.create({
        data: { homeId: homeId || null, orgId: org, userId, action, target, details: details as Prisma.InputJsonValue },
      });
    } catch (err) {
      this.log.warn(`Could not write audit entry ${action}: ${err}`); // never break the request for it
    }
  }
}

@Global()
@Module({ providers: [AuditService], exports: [AuditService] })
export class AuditModule {}

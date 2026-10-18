import { BadRequestException, Body, Controller, NotFoundException, Patch, Param } from '@nestjs/common';
import { StaffRole } from '@prisma/client';
import { z } from 'zod';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser, NoHome, Staff } from '../auth/decorators';
import { AuditService } from '../common/audit.service';
import { displayPhone, normalisePhone } from '../common/phone';
import { ZodPipe } from '../common/zod';
import { PlatformService } from '../platform/platform.service';
import { PrismaService } from '../prisma/prisma.service';

const phone = z.object({ phone: z.string().trim().max(24).nullable() });
const BAD = 'That number doesn’t look right. Write it like 0300 1234567.';

/**
 * A person's mobile number, so the company can send them WhatsApp messages (visit confirmations,
 * ticket updates, bills). Optional. People set their own on the account page; the home's installer
 * or a super admin can fill it in for a customer from the home's page in the console.
 */
@Controller()
export class PhoneController {
  constructor(private readonly prisma: PrismaService, private readonly platform: PlatformService, private readonly audit: AuditService) {}

  @NoHome()
  @Patch('account/phone')
  async mine(@CurrentUser() user: AuthUser, @Body(new ZodPipe(phone)) body: z.infer<typeof phone>) {
    const value = this.clean(body.phone);
    await this.prisma.user.update({ where: { id: user.id }, data: { phone: value } });
    return { phone: value };
  }

  @Staff('SUPERADMIN', 'INSTALLER')
  @Patch('platform/homes/:id/people/:userId/phone')
  async forCustomer(@CurrentUser() user: AuthUser, @Param('id') homeId: string, @Param('userId') userId: string, @Body(new ZodPipe(phone)) body: z.infer<typeof phone>) {
    const home = await this.prisma.home.findFirst({ where: { ...this.platform.homeWhere(user), id: homeId }, select: { id: true } });
    if (!home) throw new NotFoundException('No such home.');
    const member = await this.prisma.membership.findUnique({ where: { userId_homeId: { userId, homeId } }, select: { user: { select: { staffRole: true, name: true } } } });
    // staff accounts look after their own numbers
    if (!member || member.user.staffRole === StaffRole.SUPERADMIN || member.user.staffRole === StaffRole.INSTALLER) throw new NotFoundException('No such person in this home.');
    const value = this.clean(body.phone);
    await this.prisma.user.update({ where: { id: userId }, data: { phone: value } });
    await this.audit.record(homeId, user.id, 'user.phone', userId, { name: member.user.name, set: !!value });
    return { phone: value };
  }

  /** Kept as the person wrote it if it reads as a phone number (shown back the same way). */
  private clean(raw: string | null) {
    if (!raw) return null;
    const digits = normalisePhone(raw);
    if (!digits) throw new BadRequestException(BAD);
    return displayPhone(digits);
  }
}

import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { BillingPeriod, ContractStatus, InvoiceStatus } from '@prisma/client';
import { z } from 'zod';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser, NoHome, Staff } from '../auth/decorators';
import { ZodPipe } from '../common/zod';
import { BillingService, METHODS } from './billing.service';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const rupees = z.number().int().min(1).max(10_000_000);
const contract = z.object({
  homeId: z.string().min(1), plan: z.string().trim().min(1).max(80), amount: rupees, period: z.nativeEnum(BillingPeriod),
  visitsIncluded: z.number().int().min(0).max(52).optional(), startsOn: day, endsOn: day.nullable().optional(), notes: z.string().max(1000).optional(),
});
const contractUpdate = z.object({
  status: z.nativeEnum(ContractStatus).optional(), plan: z.string().trim().min(1).max(80).optional(), amount: rupees.optional(),
  visitsIncluded: z.number().int().min(0).max(52).optional(), notes: z.string().max(1000).optional(), endsOn: day.nullable().optional(),
});
const invoice = z.object({ homeId: z.string().min(1), description: z.string().trim().min(1).max(200), amount: rupees, dueInDays: z.number().int().min(0).max(90).optional() });
const renew = z.object({ months: z.union([z.literal(3), z.literal(6), z.literal(12)]).optional(), until: day.optional(), amount: rupees.optional() });
const invoiceSet = z.object({ status: z.nativeEnum(InvoiceStatus), method: z.enum(METHODS).optional(), reference: z.string().max(80).optional(), paidOn: day.optional() });

/** Maintenance contracts and invoices: the team's view (/platform/billing…) and the home's (/billing…). */
@Controller()
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Staff('SUPERADMIN', 'SUPPORT')
  @Get('platform/billing')
  overview(@CurrentUser() user: AuthUser) {
    return this.billing.overview(user);
  }

  @Staff('SUPERADMIN')
  @Post('platform/billing/contracts')
  createContract(@CurrentUser() user: AuthUser, @Body(new ZodPipe(contract)) body: z.infer<typeof contract>) {
    return this.billing.createContract(user, body);
  }

  @Staff('SUPERADMIN')
  @Patch('platform/billing/contracts/:id')
  updateContract(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(contractUpdate)) body: z.infer<typeof contractUpdate>) {
    return this.billing.updateContract(user, id, body);
  }

  /** Contracts ending in the next 60 days, and ones that ended without a renewal. */
  @Staff('SUPERADMIN', 'SUPPORT')
  @Get('platform/billing/renewals')
  renewals(@CurrentUser() user: AuthUser) {
    return this.billing.renewals(user);
  }

  @Staff('SUPERADMIN')
  @Post('platform/billing/contracts/:id/renew')
  @HttpCode(200)
  renew(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(renew)) body: z.infer<typeof renew>) {
    return this.billing.renew(user, id, body);
  }

  @Staff('SUPERADMIN')
  @Post('platform/billing/invoices')
  createInvoice(@CurrentUser() user: AuthUser, @Body(new ZodPipe(invoice)) body: z.infer<typeof invoice>) {
    return this.billing.createInvoice(user, body);
  }

  @Staff('SUPERADMIN')
  @Patch('platform/billing/invoices/:id')
  setInvoice(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(invoiceSet)) body: z.infer<typeof invoiceSet>) {
    return this.billing.setInvoice(user, id, body);
  }

  @Get('billing')
  mine(@CurrentUser() user: AuthUser) {
    return this.billing.forHome(user);
  }

  /** One invoice to print: the team, or the home's owner and admins. */
  @NoHome()
  @Get('billing/invoices/:id')
  one(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.billing.invoice(user, id);
  }
}

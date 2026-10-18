import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser, Public, Staff } from '../auth/decorators';
import { ZodPipe } from '../common/zod';
import { MAX_LINES } from './quote-math';
import { QuotesService } from './quotes.service';

const line = z.object({
  priceItemId: z.string().max(40).nullable().optional(), name: z.string().trim().min(1).max(120), unit: z.string().trim().max(20).optional(),
  qty: z.number().int().min(1, 'At least one of each item.').max(9999), price: z.number().int().min(0).max(10_000_000),
});
const lines = z.array(line).max(MAX_LINES);
const create = z.object({
  visitRequestId: z.string().max(40).optional(), homeId: z.string().max(40).optional(),
  customerName: z.string().trim().max(80).optional(), customerPhone: z.string().trim().max(24).optional(),
  items: lines.default([]), discount: z.number().int().min(0).max(10_000_000).optional(), note: z.string().max(1000).optional(),
  validDays: z.number().int().min(1).max(180).optional(),
});
const update = z.object({
  items: lines.optional(), discount: z.number().int().min(0).max(10_000_000).optional(), note: z.string().max(1000).optional(),
  customerName: z.string().trim().max(80).optional(), customerPhone: z.string().trim().max(24).nullable().optional(),
  validDays: z.number().int().min(1).max(180).optional(), status: z.literal('DRAFT').optional(),
});
const prices = z.object({
  items: z.array(z.object({ id: z.string().max(40).optional(), name: z.string().trim().min(1).max(120), unit: z.string().trim().max(20).optional(), price: z.number().int().min(0).max(10_000_000) })).max(200),
});
const convert = z.object({
  installerId: z.string().min(1, 'Pick the installer.'), homeName: z.string().trim().max(80).optional(),
  ownerEmail: z.string().trim().toLowerCase().email('Enter a valid email address').optional().or(z.literal('').transform(() => undefined)),
  ownerName: z.string().trim().max(80).optional(), rooms: z.array(z.string().trim().max(60)).max(30).optional(),
});
const answer = z.object({ name: z.string().trim().max(80).optional(), reason: z.string().trim().max(500).optional() });

/** Quotes: the price list and quotes in the console (/platform/…), and the customer's page (/public/quotes/…). */
@Controller()
export class QuotesController {
  constructor(private readonly quotes: QuotesService) {}

  @Staff('SUPERADMIN', 'SUPPORT', 'INSTALLER')
  @Get('platform/price-items')
  priceItems(@CurrentUser() user: AuthUser) {
    return this.quotes.priceItems(user);
  }

  @Staff('SUPERADMIN')
  @Put('platform/price-items')
  savePrices(@CurrentUser() user: AuthUser, @Body(new ZodPipe(prices)) body: z.infer<typeof prices>) {
    return this.quotes.savePriceItems(user, body.items);
  }

  @Staff('SUPERADMIN', 'SUPPORT', 'INSTALLER')
  @Get('platform/quotes')
  list(@CurrentUser() user: AuthUser, @Query('visitRequestId') visitRequestId?: string, @Query('homeId') homeId?: string, @Query('status') status?: string) {
    return this.quotes.list(user, { visitRequestId, homeId, status });
  }

  @Staff('SUPERADMIN', 'INSTALLER')
  @Post('platform/quotes')
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(create)) body: z.infer<typeof create>) {
    return this.quotes.create(user, body);
  }

  @Staff('SUPERADMIN', 'SUPPORT', 'INSTALLER')
  @Get('platform/quotes/:id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.quotes.get(user, id);
  }

  @Staff('SUPERADMIN', 'INSTALLER')
  @Patch('platform/quotes/:id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(update)) body: z.infer<typeof update>) {
    return this.quotes.update(user, id, body);
  }

  /** Ready for the customer: the secret link works from now on. */
  @Staff('SUPERADMIN', 'INSTALLER')
  @Post('platform/quotes/:id/send')
  @HttpCode(200)
  send(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.quotes.send(user, id);
  }

  /** Accepted: make (or pick) the home, set the installer, mark the visit request a customer. */
  @Staff('SUPERADMIN')
  @Post('platform/quotes/:id/convert')
  @HttpCode(200)
  convert(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(convert)) body: z.infer<typeof convert>) {
    return this.quotes.convert(user, id, body);
  }

  @Staff('SUPERADMIN', 'INSTALLER')
  @Delete('platform/quotes/:id')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.quotes.remove(user, id);
  }

  /** What the customer accepted for a home: "what to install" on its installation report. */
  @Staff('SUPERADMIN', 'SUPPORT', 'INSTALLER')
  @Get('platform/homes/:id/quote-items')
  toInstall(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.quotes.toInstallFor(user, id);
  }

  // ---------------------------------------------------------------- the customer, by the secret link (no sign-in)
  @Public()
  @Get('public/quotes/:token')
  view(@Param('token') token: string) {
    return this.quotes.publicView(token);
  }

  @Public()
  @Post('public/quotes/:token/accept')
  @HttpCode(200)
  accept(@Param('token') token: string, @Body(new ZodPipe(answer)) body: z.infer<typeof answer>) {
    return this.quotes.answer(token, true, body);
  }

  @Public()
  @Post('public/quotes/:token/decline')
  @HttpCode(200)
  decline(@Param('token') token: string, @Body(new ZodPipe(answer)) body: z.infer<typeof answer>) {
    return this.quotes.answer(token, false, body);
  }
}

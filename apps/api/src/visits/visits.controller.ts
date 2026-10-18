import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { VisitStatus } from '@prisma/client';
import type { Request } from 'express';
import { z } from 'zod';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser, Public, Staff } from '../auth/decorators';
import { ZodPipe } from '../common/zod';
import { clientIp, VisitsService } from './visits.service';

const request = z.object({
  name: z.string().trim().min(2, 'Please enter your name.').max(80),
  phone: z.string().trim().regex(/^[+0-9 ()-]{7,20}$/, 'Please enter a phone number we can call, e.g. +92 300 1234567.')
    .refine((p) => p.replace(/\D/g, '').length >= 7, 'Please enter a phone number we can call, e.g. +92 300 1234567.'),
  city: z.string().trim().min(1).max(40),
  homeSize: z.string().trim().min(1).max(30),
  website: z.string().max(200).optional().nullable(),
});
const update = z.object({
  status: z.nativeEnum(VisitStatus).optional(),
  note: z.string().max(1000).optional(),
  homeId: z.string().max(40).nullable().optional(),
  // the booked visit, as the time on the clock in Pakistan ("2026-10-20T16:00"), and who goes
  visitAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Pick a date and a time.').nullable().optional(),
  assigneeId: z.string().max(40).nullable().optional(),
});

@Controller()
export class VisitsController {
  constructor(private readonly visits: VisitsService) {}

  /** The landing page's "Book a free visit" form. */
  @Public()
  @Post('public/visit-requests')
  create(@Body(new ZodPipe(request)) body: z.infer<typeof request>, @Req() req: Request) {
    return this.visits.create({ ...body, website: body.website ?? undefined }, clientIp(req));
  }

  @Staff('SUPERADMIN', 'SUPPORT')
  @Get('platform/visit-requests')
  list(@CurrentUser() user: AuthUser) {
    return this.visits.list(user);
  }

  @Staff('SUPERADMIN', 'SUPPORT')
  @Patch('platform/visit-requests/:id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(update)) body: z.infer<typeof update>) {
    return this.visits.update(user, id, body);
  }
}

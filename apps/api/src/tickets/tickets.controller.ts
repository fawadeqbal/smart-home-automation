import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { TicketPriority, TicketStatus } from '@prisma/client';
import { z } from 'zod';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser, Staff } from '../auth/decorators';
import { ZodPipe } from '../common/zod';
import { CATEGORIES, TicketsService } from './tickets.service';

const open = z.object({
  title: z.string().trim().max(100).optional(), body: z.string().trim().min(3).max(4000),
  category: z.enum(CATEGORIES).optional(), nodeId: z.string().max(64).optional(),
});
const homeReply = z.object({ body: z.string().trim().max(4000).default(''), solved: z.boolean().optional() });
const staffReply = z.object({ body: z.string().trim().max(4000).default(''), internal: z.boolean().optional(), status: z.nativeEnum(TicketStatus).optional() });
const update = z.object({
  priority: z.nativeEnum(TicketPriority).optional(), assigneeId: z.string().nullable().optional(),
  title: z.string().trim().min(1).max(100).optional(), category: z.enum(CATEGORIES).optional(),
});
const rating = z.object({ stars: z.number().int().min(1, 'Pick 1 to 5 stars.').max(5, 'Pick 1 to 5 stars.'), comment: z.string().trim().max(500).optional() });
const staffOpen = z.object({
  homeId: z.string().min(1), title: z.string().trim().min(1).max(100), body: z.string().trim().min(1).max(4000),
  priority: z.nativeEnum(TicketPriority).optional(), category: z.enum(CATEGORIES).optional(),
});

/** Service tickets: the home's requests (/support/…) and the team's queue (/platform/tickets/…). */
@Controller()
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @Get('support/tickets')
  mine(@CurrentUser() user: AuthUser) {
    return this.tickets.forHome(user);
  }

  @Post('support/tickets')
  open(@CurrentUser() user: AuthUser, @Body(new ZodPipe(open)) body: z.infer<typeof open>) {
    return this.tickets.open(user, body);
  }

  @Get('support/tickets/:id')
  one(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.tickets.homeTicket(user, id);
  }

  @Post('support/tickets/:id/reply')
  reply(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(homeReply)) body: z.infer<typeof homeReply>) {
    return this.tickets.homeReply(user, id, body.body, body.solved);
  }

  /** The person who opened it rates the help: 1 to 5 stars, once it is solved (changeable for 7 days). */
  @Post('support/tickets/:id/rating')
  rate(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(rating)) body: z.infer<typeof rating>) {
    return this.tickets.rate(user, id, body);
  }

  /** Average ratings: the company's, and per person who handled the tickets. */
  @Staff('SUPERADMIN', 'SUPPORT', 'INSTALLER')
  @Get('platform/tickets/ratings')
  ratings(@CurrentUser() user: AuthUser) {
    return this.tickets.ratings(user);
  }

  @Staff('SUPERADMIN', 'SUPPORT', 'INSTALLER')
  @Get('platform/tickets')
  list(@CurrentUser() user: AuthUser, @Query('status') status?: string, @Query('mine') mine?: string, @Query('homeId') homeId?: string) {
    return this.tickets.list(user, { status, mine: mine === 'true', homeId });
  }

  @Staff('SUPERADMIN', 'SUPPORT', 'INSTALLER')
  @Post('platform/tickets')
  staffOpen(@CurrentUser() user: AuthUser, @Body(new ZodPipe(staffOpen)) body: z.infer<typeof staffOpen>) {
    return this.tickets.staffOpen(user, body);
  }

  @Staff('SUPERADMIN', 'SUPPORT', 'INSTALLER')
  @Get('platform/tickets/:id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.tickets.get(user, id);
  }

  @Staff('SUPERADMIN', 'SUPPORT', 'INSTALLER')
  @Patch('platform/tickets/:id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(update)) body: z.infer<typeof update>) {
    return this.tickets.update(user, id, body);
  }

  @Staff('SUPERADMIN', 'SUPPORT', 'INSTALLER')
  @Post('platform/tickets/:id/reply')
  staffReply(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(staffReply)) body: z.infer<typeof staffReply>) {
    return this.tickets.staffReply(user, id, body);
  }
}

import { Body, Controller, Delete, Get, Param, Patch, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import { ZodPipe } from '../common/zod';
import { PowerService } from './power.service';

const hhmm = z.string().regex(/^\d{1,2}:\d{2}$/, 'Times like 14:00');
const schedule = z.object({ windows: z.array(z.object({ from: hhmm, to: hhmm, days: z.array(z.number().int().min(0).max(6)).max(7).optional() })).max(8) });
const grid = z.object({ loads: z.array(z.string()).max(20).optional(), restore: z.boolean().optional() });
const date = z.coerce.date();
const reading = z.object({ kwh: z.number().min(0).max(10_000_000), readAt: date.optional(), newMeter: z.boolean().optional() });
const readingUpdate = reading.partial();
const bill = z.object({
  billingDay: z.number().int().min(1).max(31).optional(),
  slabs: z.array(z.object({ upTo: z.number().positive().nullable(), rate: z.number().positive().max(999) })).max(10).optional(),
  protectedLimit: z.number().int().min(10).max(2000).nullable().optional(),
});

/**
 * Power at home: load-shedding (the pattern and the next cut; everyone may see it), UPS mode with a
 * grid sensor, and the electricity bill from meter readings (owners and admins).
 */
@Controller('power')
export class PowerController {
  constructor(private readonly power: PowerService) {}

  /** For the home page: on UPS or not, and the next expected cut. */
  @Get()
  status(@CurrentUser() user: AuthUser) {
    return this.power.status(user);
  }

  /** "When will the light go?": the typed or learned load-shedding windows and the next one. */
  @Get('shedding')
  shedding(@CurrentUser() user: AuthUser) {
    return this.power.shedding(user.homeId);
  }

  /** The area's schedule as typed from the DISCO's SMS (an empty list goes back to the learned pattern). */
  @Roles('OWNER', 'ADMIN')
  @Put('shedding')
  setShedding(@CurrentUser() user: AuthUser, @Body(new ZodPipe(schedule)) body: z.infer<typeof schedule>) {
    return this.power.setShedding(user, body.windows);
  }

  @Roles('OWNER', 'ADMIN')
  @Get('grid')
  grid(@CurrentUser() user: AuthUser) {
    return this.power.grid(user);
  }

  /** "When the grid goes: switch off these heavy loads", and whether they go back on. */
  @Roles('OWNER', 'ADMIN')
  @Put('grid')
  setGrid(@CurrentUser() user: AuthUser, @Body(new ZodPipe(grid)) body: z.infer<typeof grid>) {
    return this.power.setGrid(user, body);
  }

  @Roles('OWNER', 'ADMIN')
  @Get('bill')
  bill(@CurrentUser() user: AuthUser) {
    return this.power.bill(user);
  }

  @Roles('OWNER', 'ADMIN')
  @Put('bill')
  setBill(@CurrentUser() user: AuthUser, @Body(new ZodPipe(bill)) body: z.infer<typeof bill>) {
    return this.power.setBill(user, body);
  }

  @Roles('OWNER', 'ADMIN')
  @Get('readings')
  readings(@CurrentUser() user: AuthUser) {
    return this.power.readings(user.homeId);
  }

  @Roles('OWNER', 'ADMIN')
  @Post('readings')
  addReading(@CurrentUser() user: AuthUser, @Body(new ZodPipe(reading)) body: z.infer<typeof reading>) {
    return this.power.addReading(user, body);
  }

  @Roles('OWNER', 'ADMIN')
  @Patch('readings/:id')
  updateReading(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(readingUpdate)) body: z.infer<typeof readingUpdate>) {
    return this.power.updateReading(user, id, body);
  }

  @Roles('OWNER', 'ADMIN')
  @Delete('readings/:id')
  removeReading(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.power.removeReading(user, id);
  }
}

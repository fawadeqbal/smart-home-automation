import { Body, Controller, Get, HttpCode, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import { ZodPipe } from '../common/zod';
import { EnergyService } from './energy.service';

const tariff = z.object({ tariff: z.number().positive().max(1000).nullable() });

/** Electricity estimates for the switches this person can see; the price of a unit is the owner's to set. */
@Controller()
export class EnergyController {
  constructor(private readonly energy: EnergyService) {}

  @Get('energy')
  usage(@CurrentUser() user: AuthUser, @Query('days') days?: string) {
    return this.energy.usage(user, Number(days) || 7);
  }

  @Roles('OWNER', 'ADMIN')
  @Put('home/tariff')
  @HttpCode(204)
  setTariff(@CurrentUser() user: AuthUser, @Body(new ZodPipe(tariff)) body: z.infer<typeof tariff>) {
    return this.energy.setTariff(user, body.tariff);
  }
}

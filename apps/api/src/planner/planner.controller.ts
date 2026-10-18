import { Controller, Get, Query } from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser, Staff } from '../auth/decorators';
import { PlannerService } from './planner.service';

/** The installer's day: visits, installations and tickets in a suggested driving order. */
@Controller('platform')
export class PlannerController {
  constructor(private readonly planner: PlannerService) {}

  @Staff('SUPERADMIN', 'SUPPORT', 'INSTALLER')
  @Get('day')
  day(@CurrentUser() user: AuthUser, @Query('installerId') installerId?: string, @Query('date') date?: string) {
    return this.planner.day(user, { installerId, date });
  }
}

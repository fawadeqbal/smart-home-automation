import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { ZodPipe } from '../common/zod';
import { AutomationService } from './automation.service';

const action = z.object({ deviceId: z.string().min(1), on: z.boolean() });
const schedule = z.object({
  name: z.string().trim().max(80).optional(),
  kind: z.enum(['ONCE', 'DAILY']),
  runAt: z.string().datetime().optional(),
  inMinutes: z.number().min(1).max(60 * 24 * 365).optional(),
  time: z.string().regex(/^\d{1,2}:\d{2}$/).optional(),
  days: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  actions: z.array(action).max(30).optional(),
  sceneId: z.string().optional(),
}).refine((s) => !!s.sceneId || (s.actions?.length ?? 0) > 0, 'Pick at least one device or a scene.');
const scene = z.object({ name: z.string().trim().min(1).max(60), icon: z.string().max(30).optional(), actions: z.array(action).min(1).max(30) });

/** Everyone may automate the devices they are allowed to control; checks happen in the service. */
@Controller()
export class AutomationController {
  constructor(private readonly automation: AutomationService) {}

  @Get('schedules')
  list(@CurrentUser() user: AuthUser) {
    return this.automation.listSchedules(user);
  }

  @Post('schedules')
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(schedule)) body: z.infer<typeof schedule>) {
    return this.automation.createSchedule(user, body);
  }

  @Patch('schedules/:id')
  @HttpCode(204)
  toggle(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(z.object({ enabled: z.boolean() }))) body: { enabled: boolean }) {
    return this.automation.setEnabled(user, id, body.enabled);
  }

  @Delete('schedules/:id')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.automation.removeSchedule(user, id);
  }

  @Get('scenes')
  scenes(@CurrentUser() user: AuthUser) {
    return this.automation.listScenes(user);
  }

  @Post('scenes')
  createScene(@CurrentUser() user: AuthUser, @Body(new ZodPipe(scene)) body: z.infer<typeof scene>) {
    return this.automation.createScene(user, body);
  }

  @Delete('scenes/:id')
  @HttpCode(204)
  removeScene(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.automation.removeScene(user, id);
  }

  @Post('scenes/:id/run')
  run(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.automation.runScene(user, id);
  }
}

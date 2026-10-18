import { Body, Controller, Delete, Get, HttpCode, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import { ZodPipe } from '../common/zod';
import { PresenceRuleInput, PresenceService } from './presence.service';

const share = z.object({ sharing: z.boolean() });
const report = z.object({ atHome: z.boolean() });
const rule = z.object({
  enabled: z.boolean().optional(),
  switchOff: z.enum(['none', 'lights', 'chosen']).optional(),
  offDevices: z.array(z.string()).max(40).optional(),
  awayMode: z.boolean().optional(),
  notify: z.boolean().optional(),
  arriveSceneId: z.string().nullable().optional(),
});

/** Who's home (for those who share it) and "when the last person leaves / the first comes home". */
@Controller('presence')
export class PresenceController {
  constructor(private readonly presence: PresenceService) {}

  @Get()
  whoIsHome(@CurrentUser() user: AuthUser) {
    return this.presence.whoIsHome(user);
  }

  /** "Share when I'm home" for me in this home. */
  @Get('me')
  mine(@CurrentUser() user: AuthUser) {
    return this.presence.mine(user);
  }

  @Put('me')
  setSharing(@CurrentUser() user: AuthUser, @Body(new ZodPipe(share)) body: z.infer<typeof share>) {
    return this.presence.setSharing(user, body.sharing);
  }

  /** The phone app: whether it can reach a board of this home on the Wi‑Fi right now. */
  @Post()
  @HttpCode(200)
  report(@CurrentUser() user: AuthUser, @Body(new ZodPipe(report)) body: z.infer<typeof report>) {
    return this.presence.report(user, body.atHome);
  }

  @Roles('OWNER', 'ADMIN')
  @Get('rule')
  getRule(@CurrentUser() user: AuthUser) {
    return this.presence.getRule(user);
  }

  @Roles('OWNER', 'ADMIN')
  @Put('rule')
  setRule(@CurrentUser() user: AuthUser, @Body(new ZodPipe(rule)) body: PresenceRuleInput) {
    return this.presence.setRule(user, body);
  }

  @Roles('OWNER', 'ADMIN')
  @Delete('rule')
  @HttpCode(204)
  removeRule(@CurrentUser() user: AuthUser) {
    return this.presence.removeRule(user);
  }
}

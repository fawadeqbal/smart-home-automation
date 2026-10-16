import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import { AuditService } from '../common/audit.service';
import { ZodPipe } from '../common/zod';
import { PrismaService } from '../prisma/prisma.service';
import { AutomationService } from './automation.service';
import { PlaceService } from './place.service';
import { RuleInput, RulesService } from './rules.service';

const hhmm = z.string().regex(/^\d{1,2}:\d{2}$/);
const trigger = z.object({
  deviceId: z.string().min(1), event: z.enum(['on', 'off', 'opens', 'closes', 'above', 'below']),
  value: z.number().optional(), field: z.enum(['temperature', 'humidity', 'level']).optional(),
});
const conditions = z.object({ from: hhmm.optional(), to: hhmm.optional(), days: z.array(z.number().int().min(0).max(6)).max(7).optional(), away: z.boolean().optional() });
const action = z.discriminatedUnion('type', [
  z.object({ type: z.literal('device'), deviceId: z.string().min(1), on: z.boolean(), forMinutes: z.number().int().min(1).max(1440).optional() }),
  z.object({ type: z.literal('scene'), sceneId: z.string().min(1) }),
  z.object({ type: z.literal('notify'), to: z.enum(['me', 'admins', 'everyone']), message: z.string().trim().max(200).optional() }),
]);
const rule = z.object({
  name: z.string().trim().max(120).optional(), trigger, conditions: conditions.optional(),
  actions: z.array(action).min(1).max(10), cooldownSec: z.number().int().min(30).max(86400).optional(), enabled: z.boolean().optional(),
});
const ruleUpdate = rule.partial();
const away = z.object({ on: z.boolean().optional(), lights: z.array(z.string()).max(20).optional() });
const location = z.object({
  city: z.string().trim().max(80).optional(), lat: z.number().min(-90).max(90).optional(), lon: z.number().min(-180).max(180).optional(), auto: z.boolean().optional(),
});

/** Rules ("when this happens, do that"), away mode, and where the home is (for sunrise and sunset). */
@Controller()
export class RulesController {
  constructor(
    private readonly rules: RulesService,
    private readonly place: PlaceService,
    private readonly automation: AutomationService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get('rules')
  list(@CurrentUser() user: AuthUser) {
    return this.rules.list(user);
  }

  @Post('rules')
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(rule)) body: RuleInput) {
    return this.rules.create(user, body);
  }

  @Patch('rules/:id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(ruleUpdate)) body: Partial<RuleInput>) {
    return this.rules.update(user, id, body);
  }

  @Delete('rules/:id')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.rules.remove(user, id);
  }

  @Get('home/away')
  getAway(@CurrentUser() user: AuthUser) {
    return this.rules.away(user);
  }

  @Put('home/away')
  setAway(@CurrentUser() user: AuthUser, @Body(new ZodPipe(away)) body: z.infer<typeof away>) {
    return this.rules.setAway(user, body);
  }

  @Get('home/location')
  async location(@CurrentUser() user: AuthUser) {
    const home = await this.prisma.home.findUniqueOrThrow({ where: { id: user.homeId }, select: { timezone: true } });
    return { ...(await this.place.today(user.homeId, home.timezone)), timezone: home.timezone, cities: PlaceService.cities() };
  }

  @Roles('OWNER', 'ADMIN')
  @Put('home/location')
  async setLocation(@CurrentUser() user: AuthUser, @Body(new ZodPipe(location)) body: z.infer<typeof location>) {
    if (!body.auto && !body.city && (body.lat === undefined || body.lon === undefined)) throw new BadRequestException('Pick a city, or give the latitude and longitude.');
    const p = await this.place.set(user.homeId, body);
    if (!p) throw new BadRequestException(`We don't know "${body.city}" yet. Pick a city from the list or give the latitude and longitude.`);
    await this.automation.resyncSun(user.homeId);
    await this.audit.record(user.homeId, user.id, 'home.location', user.homeId, { source: p.source, label: p.label });
    return this.location(user);
  }
}

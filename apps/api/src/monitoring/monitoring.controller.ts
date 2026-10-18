import { Body, Controller, Get, Headers, HttpCode, Param, Post, Put, Query, ServiceUnavailableException } from '@nestjs/common';
import { z } from 'zod';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser, NoHome, Roles } from '../auth/decorators';
import { ZodPipe } from '../common/zod';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { MonitoringService } from './monitoring.service';
import { OutagesService } from './outages.service';
import { PushService } from './push.service';
import { SummaryService } from './summary.service';

const subscription = z.object({ endpoint: z.string().url().max(1000), keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }) });
const phone = z.object({
  token: z.string().trim().min(10).max(4096),
  platform: z.enum(['android', 'ios']),
  appVersion: z.string().trim().max(40).nullable().optional(),
  /** the token it had before (Firebase rotated it) */
  replaces: z.string().trim().max(4096).nullable().optional(),
});

@Controller()
export class MonitoringController {
  constructor(
    private readonly monitoring: MonitoringService, private readonly push: PushService, private readonly outages: OutagesService,
    private readonly summary: SummaryService, private readonly mail: MailService, private readonly prisma: PrismaService,
  ) {}

  /** How the home did today or this week, as lines and as text to share on WhatsApp. */
  @Get('home/summary')
  async homeSummary(@CurrentUser() user: AuthUser, @Query('period') period?: string) {
    return { ...(await this.summary.build(user, period === 'day' ? 'day' : 'week')), mail: this.mail.enabled };
  }

  /** The same, to this person's email now. */
  @Post('home/summary/email')
  @HttpCode(200)
  async emailSummary(@CurrentUser() user: AuthUser, @Query('period') period?: string) {
    const p = period === 'day' ? 'day' : 'week';
    const s = await this.summary.build(user, p);
    const me = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { email: true } });
    const sent = await this.mail.send({
      to: me.email, subject: `${s.home}: ${p === 'day' ? 'today' : 'your week'} (${s.range})`,
      text: `${s.lines.map((l) => `• ${l}`).join('\n')}`, button: { label: 'Open the summary', url: `${s.link}?period=${p}&home=${user.homeId}` },
    });
    if (!sent) throw new ServiceUnavailableException('Email is not set up on this server yet.');
    return { sent: true, to: me.email };
  }

  /** Power cuts, internet outages and board restarts in this home (everyone in the home may see them). */
  @Get('outages')
  homeOutages(@CurrentUser() user: AuthUser, @Query('days') days?: string) {
    return this.outages.forHome(user, Math.min(365, Math.max(1, Number(days) || 30)));
  }

  @NoHome()
  @Get('push/key')
  pushKey() {
    return this.push.publicKey();
  }

  @NoHome()
  @Get('push/devices')
  pushDevices(@CurrentUser() user: AuthUser) {
    return this.push.count(user);
  }

  @NoHome()
  @Post('push/subscribe')
  @HttpCode(204)
  subscribe(@CurrentUser() user: AuthUser, @Body(new ZodPipe(subscription)) body: z.infer<typeof subscription>, @Headers('user-agent') ua?: string) {
    return this.push.subscribe(user, body, ua);
  }

  @NoHome()
  @Post('push/unsubscribe')
  @HttpCode(204)
  unsubscribe(@CurrentUser() user: AuthUser, @Body(new ZodPipe(z.object({ endpoint: z.string().max(1000) }))) body: { endpoint: string }) {
    return this.push.unsubscribe(user, body.endpoint);
  }

  /** The phone app after sign-in, and whenever Firebase gives it a new token. */
  @NoHome()
  @Post('push/phone')
  @HttpCode(200)
  registerPhone(@CurrentUser() user: AuthUser, @Body(new ZodPipe(phone)) body: z.infer<typeof phone>) {
    return this.push.registerPhone(user, body);
  }

  /** The phone app when signing out. */
  @NoHome()
  @Post('push/phone/remove')
  @HttpCode(204)
  unregisterPhone(@CurrentUser() user: AuthUser, @Body(new ZodPipe(z.object({ token: z.string().trim().min(1).max(4096) }))) body: { token: string }) {
    return this.push.unregisterPhone(user, body.token);
  }

  @NoHome()
  @Get('notifications')
  list(@CurrentUser() user: AuthUser) {
    return this.monitoring.list(user);
  }

  @NoHome()
  @Post('notifications/read')
  @HttpCode(204)
  readAll(@CurrentUser() user: AuthUser) {
    return this.monitoring.markRead(user);
  }

  @NoHome()
  @Post('notifications/:id/read')
  @HttpCode(204)
  read(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.monitoring.markRead(user, id);
  }

  @NoHome()
  @Get('notifications/prefs')
  prefs(@CurrentUser() user: AuthUser) {
    return this.monitoring.prefs(user);
  }

  @NoHome()
  @Put('notifications/prefs')
  setPrefs(@CurrentUser() user: AuthUser, @Body(new ZodPipe(z.record(z.string(), z.boolean()))) body: Record<string, boolean>) {
    return this.monitoring.setPrefs(user, body);
  }

  @Roles('OWNER', 'ADMIN')
  @Get('nodes/:id/health-history')
  history(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query('hours') hours?: string) {
    return this.monitoring.healthHistory(user.homeId, id, Math.min(24 * 14, Math.max(1, Number(hours) || 24)));
  }
}

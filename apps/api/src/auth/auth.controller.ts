import { Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { ZodPipe } from '../common/zod';
import { MqttService } from '../mqtt/mqtt.service';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import { PasswordsService } from './passwords.service';
import { TwoFactorService } from './two-factor.service';
import { AuthUser, REFRESH_COOKIE } from './auth.types';
import { CurrentUser, NoHome, Public, Staff } from './decorators';
import { Inject } from '@nestjs/common';
import { SETTINGS, Settings } from '../config';
import { PrismaService } from '../prisma/prisma.service';

/** Very common passwords people pick first; the sign-up screens show the same list as a rule. */
export const COMMON_PASSWORDS = ['password', 'password1', '12345678', '123456789', '1234567890', '11111111', '00000000', 'qwertyui',
  'qwerty123', 'iloveyou', 'abc12345', 'switchboard', 'pakistan', 'pakistan1', 'pakistan123', 'welcome1'];
export const passwordSchema = z.string().min(8, 'Use at least 8 characters.').max(200)
  .refine((p) => /[\d\W_]/.test(p), 'Add a number or a symbol to your password.')
  .refine((p) => !COMMON_PASSWORDS.includes(p.toLowerCase()), 'That password is too common. Choose another one.');
const emailSchema = z.string().trim().toLowerCase().email('Enter a valid email address');

const setupSchema = z.object({
  homeName: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(80),
  email: emailSchema,
  password: passwordSchema,
});
const signupSchema = z.object({
  orgName: z.string().trim().min(1, 'Enter your company name').max(80),
  name: z.string().trim().min(1).max(80),
  email: emailSchema,
  password: passwordSchema,
});
const loginSchema = z.object({ email: emailSchema, password: z.string().min(1) });
const codeSchema = z.object({ ticket: z.string().min(10).max(2000), code: z.string().trim().min(6).max(12) });
const forgotSchema = z.object({ email: emailSchema });
const resetSchema = z.object({ password: passwordSchema });
const changeSchema = z.object({ current: z.string().min(1), password: passwordSchema });

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
    private readonly mqtt: MqttService,
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordsService,
    @Inject(SETTINGS) private readonly settings: Settings,
    private readonly twoFactor: TwoFactorService,
  ) {}

  @Public()
  @Get('status')
  async status() {
    const setupNeeded = await this.auth.setupNeeded();
    return { setupNeeded, signupOpen: setupNeeded || this.settings.allowSignup, mail: this.passwords.mailEnabled };
  }

  /** "Forgot password?": emails a link if the account exists (the answer is the same either way). */
  @Public()
  @Post('forgot')
  @HttpCode(200)
  forgot(@Body(new ZodPipe(forgotSchema)) body: z.infer<typeof forgotSchema>, @Req() req: Request) {
    return this.passwords.forgot(body.email, req.ip ?? '');
  }

  /** What the reset page shows: whose account, until when. */
  @Public()
  @Get('reset/:token')
  resetInfo(@Param('token') token: string) {
    return this.passwords.info(token);
  }

  /** A new password from a link; signs them in here and out everywhere else. */
  @Public()
  @Post('reset/:token')
  @HttpCode(200)
  async reset(@Param('token') token: string, @Body(new ZodPipe(resetSchema)) body: z.infer<typeof resetSchema>,
              @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = await this.passwords.reset(token, body.password, res, req.headers['user-agent']);
    if (user.totpEnabledAt) return { twoFactor: true, signIn: true };
    return this.users.me(user.id);
  }

  /** A new password while signed in (the current one is needed). Other sessions are signed out. */
  @NoHome()
  @Post('password')
  @HttpCode(200)
  changePassword(@CurrentUser() user: AuthUser, @Body(new ZodPipe(changeSchema)) body: z.infer<typeof changeSchema>, @Req() req: Request) {
    return this.passwords.change(user, body.current, body.password, req.cookies?.[REFRESH_COOKIE]);
  }

  /** Creates an organization and its first super admin (14-day trial). */
  @Public()
  @Post('signup')
  async signup(@Body(new ZodPipe(signupSchema)) body: z.infer<typeof signupSchema>, @Req() req: Request,
               @Res({ passthrough: true }) res: Response) {
    const user = await this.auth.signup(body);
    await this.auth.startSession(user, res, req.headers['user-agent']);
    await this.mqtt.resubscribe(); // a first organization picks up boards that announced before it existed
    return this.users.me(user.id);
  }

  /** First run of a self-hosted install: organization, owner account and their home in one go. */
  @Public()
  @Post('setup')
  async setup(@Body(new ZodPipe(setupSchema)) body: z.infer<typeof setupSchema>, @Req() req: Request,
              @Res({ passthrough: true }) res: Response) {
    const user = await this.auth.setup(body);
    await this.auth.startSession(user, res, req.headers['user-agent']);
    await this.mqtt.resubscribe(); // pick up boards that announced before the home existed
    return this.users.me(user.id);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body(new ZodPipe(loginSchema)) body: z.infer<typeof loginSchema>, @Req() req: Request,
              @Res({ passthrough: true }) res: Response) {
    const user = await this.auth.login(body.email, body.password);
    if (user.totpEnabledAt) return { twoFactor: true, ticket: await this.twoFactor.ticket(user) };
    await this.auth.startSession(user, res, req.headers['user-agent'], req.ip);
    return this.users.me(user.id);
  }

  /** The second step: a code from the authenticator app, or a recovery code. */
  @Public()
  @Post('login/code')
  @HttpCode(200)
  async loginCode(@Body(new ZodPipe(codeSchema)) body: z.infer<typeof codeSchema>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const r = await this.twoFactor.check(body.ticket, body.code);
    await this.auth.startSession(r.user, res, req.headers['user-agent'], req.ip);
    return { ...(await this.users.me(r.user.id)), ...(r.usedRecovery ? { recoveryLeft: r.left } : {}) };
  }

  // ---------------------------------------------------------------- two-step sign-in and sessions (your own account)
  @NoHome()
  @Get('2fa')
  twoFactorStatus(@CurrentUser() user: AuthUser) {
    return this.twoFactor.status(user.id);
  }

  @NoHome()
  @Post('2fa/setup')
  @HttpCode(200)
  twoFactorSetup(@CurrentUser() user: AuthUser) {
    return this.twoFactor.setup(user.id);
  }

  @NoHome()
  @Post('2fa/enable')
  @HttpCode(200)
  twoFactorEnable(@CurrentUser() user: AuthUser, @Body(new ZodPipe(z.object({ code: z.string().max(12) }))) body: { code: string }) {
    return this.twoFactor.enable(user.id, body.code);
  }

  @NoHome()
  @Post('2fa/disable')
  @HttpCode(204)
  twoFactorDisable(@CurrentUser() user: AuthUser, @Body(new ZodPipe(z.object({ password: z.string().min(1) }))) body: { password: string }) {
    return this.twoFactor.disable(user.id, body.password);
  }

  @NoHome()
  @Post('2fa/codes')
  @HttpCode(200)
  twoFactorCodes(@CurrentUser() user: AuthUser, @Body(new ZodPipe(z.object({ password: z.string().min(1) }))) body: { password: string }) {
    return this.twoFactor.newCodes(user.id, body.password);
  }

  /** A super admin turns two-step sign-in off for someone who lost their phone and codes. */
  @Staff('SUPERADMIN')
  @Post('2fa/reset/:userId')
  @HttpCode(204)
  twoFactorReset(@CurrentUser() user: AuthUser, @Param('userId') userId: string) {
    return this.twoFactor.adminReset(user, userId);
  }

  @NoHome()
  @Get('sessions')
  sessions(@CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.auth.sessions(user.id, req.cookies?.[REFRESH_COOKIE]);
  }

  @NoHome()
  @Delete('sessions/:id')
  @HttpCode(204)
  async endSession(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    if (!(await this.auth.revokeSession(user.id, id))) throw new NotFoundException('Not found.');
  }

  @NoHome()
  @Post('sessions/others')
  @HttpCode(200)
  async endOthers(@CurrentUser() user: AuthUser, @Req() req: Request) {
    return { ended: await this.auth.revokeOthers(user.id, req.cookies?.[REFRESH_COOKIE]) };
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = await this.auth.refresh(req.cookies?.[REFRESH_COOKIE], res, req.ip);
    return this.users.me(user.id);
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.cookies?.[REFRESH_COOKIE], res);
  }

  @NoHome()
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.users.me(user.id, user);
  }

  /** Opens another of my homes (remembered for next time). */
  @NoHome()
  @Post('home')
  @HttpCode(200)
  async switchHome(@CurrentUser() user: AuthUser, @Body(new ZodPipe(z.object({ homeId: z.string().min(1) }))) body: { homeId: string }) {
    const full = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const ctx = await this.auth.resolveHome(full, body.homeId);
    await this.prisma.user.update({ where: { id: user.id }, data: { lastHomeId: body.homeId } });
    return this.users.me(user.id, { ...user, ...ctx! });
  }
}

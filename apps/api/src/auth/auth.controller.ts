import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { ZodPipe } from '../common/zod';
import { MqttService } from '../mqtt/mqtt.service';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import { AuthUser, REFRESH_COOKIE } from './auth.types';
import { CurrentUser, NoHome, Public } from './decorators';
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

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
    private readonly mqtt: MqttService,
    private readonly prisma: PrismaService,
    @Inject(SETTINGS) private readonly settings: Settings,
  ) {}

  @Public()
  @Get('status')
  async status() {
    const setupNeeded = await this.auth.setupNeeded();
    return { setupNeeded, signupOpen: setupNeeded || this.settings.allowSignup };
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
    await this.auth.startSession(user, res, req.headers['user-agent']);
    return this.users.me(user.id);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = await this.auth.refresh(req.cookies?.[REFRESH_COOKIE], res);
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

import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Req, Res } from '@nestjs/common';
import { Access, Role } from '@prisma/client';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { passwordSchema } from '../auth/auth.controller';
import { AuthService } from '../auth/auth.service';
import { PasswordsService } from '../auth/passwords.service';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser, Public, Roles } from '../auth/decorators';
import { clientIp } from '../common/client-ip';
import { ZodPipe } from '../common/zod';
import { UsersService } from './users.service';

const updateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  role: z.nativeEnum(Role).optional(),
  disabled: z.boolean().optional(),
});
const roomsSchema = z.object({
  rooms: z.array(z.object({ roomId: z.string(), access: z.nativeEnum(Access) })).max(200),
});
const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  name: z.string().trim().max(80).optional(),
  role: z.nativeEnum(Role).default(Role.MEMBER),
  rooms: z.array(z.object({ roomId: z.string(), access: z.nativeEnum(Access) })).max(200).optional(),
});
const acceptSchema = z.object({ name: z.string().trim().max(80).optional(), password: z.string().min(1).max(200) });

@Controller()
export class UsersController {
  constructor(private readonly users: UsersService, private readonly auth: AuthService, private readonly passwords: PasswordsService) {}

  @Roles('OWNER', 'ADMIN')
  @Get('users')
  list(@CurrentUser() user: AuthUser) {
    return this.users.list(user);
  }

  @Roles('OWNER', 'ADMIN')
  @Patch('users/:id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string,
         @Body(new ZodPipe(updateSchema)) body: z.infer<typeof updateSchema>) {
    return this.users.update(user, id, body);
  }

  @Roles('OWNER', 'ADMIN')
  @Put('users/:id/rooms')
  setRooms(@CurrentUser() user: AuthUser, @Param('id') id: string,
           @Body(new ZodPipe(roomsSchema)) body: z.infer<typeof roomsSchema>) {
    return this.users.setRooms(user, id, body.rooms);
  }

  /** A link to choose a new password, for someone in this home who can't get the email. */
  @Roles('OWNER', 'ADMIN')
  @Post('users/:id/reset-link')
  resetLink(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.passwords.linkForHomePerson(user, id);
  }

  @Roles('OWNER', 'ADMIN')
  @Delete('users/:id')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.users.remove(user, id);
  }

  // ---------------------------------------------------------------- invites
  @Roles('OWNER', 'ADMIN')
  @Post('invites')
  invite(@CurrentUser() user: AuthUser, @Body(new ZodPipe(inviteSchema)) body: z.infer<typeof inviteSchema>) {
    return this.users.invite(user, body.email, body.role, body.name || undefined, body.rooms ?? []);
  }

  @Roles('OWNER', 'ADMIN')
  @Get('invites')
  invites(@CurrentUser() user: AuthUser) {
    return this.users.listInvites(user);
  }

  @Roles('OWNER', 'ADMIN')
  @Delete('invites/:id')
  @HttpCode(204)
  revokeInvite(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.users.revokeInvite(user, id);
  }

  @Public()
  @Get('invites/:token')
  describe(@Param('token') token: string, @Req() req: Request) {
    return this.users.describeInvite(token, clientIp(req));
  }

  @Public()
  @Post('invites/:token/accept')
  async accept(@Param('token') token: string, @Body(new ZodPipe(acceptSchema)) body: z.infer<typeof acceptSchema>,
               @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const ip = clientIp(req);
    const { existingAccount } = await this.users.describeInvite(token, ip);
    const strong = passwordSchema.safeParse(body.password);
    if (!existingAccount && !strong.success) throw new BadRequestException(strong.error.issues[0].message);
    const user = await this.users.acceptInvite(token, body.name, body.password, ip);
    await this.auth.startSession(user, res, req.headers['user-agent'], ip);
    return this.users.me(user.id);
  }
}

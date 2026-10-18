import { CanActivate, ConflictException, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role, StaffRole } from '@prisma/client';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { ACCESS_COOKIE, AuthUser, canSetup, HOME_HEADER } from './auth.types';
import { NO_HOME_KEY, PUBLIC_KEY, ROLES_KEY, SETUP_KEY, STAFF_KEY } from './decorators';

const READS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Global guard: every route needs a signed-in person unless marked @Public().
 * Browsers send the "access" cookie; the voice assistant sends "Authorization: Bearer <on-behalf token>".
 * Then it works out which home the request is about (X-Home-Id) and the person's role there,
 * and applies @Staff, @Roles, @Setup and the read-only rule for support staff.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly auth: AuthService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;

    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const bearer = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : undefined;
    const header = req.headers[HOME_HEADER];
    const requested = (Array.isArray(header) ? header[0] : header)?.trim() || undefined;
    const user = bearer
      ? await this.auth.authenticate(bearer, ['obo'], requested)
      : await this.auth.authenticate(req.cookies?.[ACCESS_COOKIE] ?? '', ['access'], requested);
    req.user = user;

    const staff = this.reflector.getAllAndOverride<StaffRole[] | undefined>(STAFF_KEY, targets);
    if (staff) {
      if (!user.staffRole || !staff.includes(user.staffRole)) throw new ForbiddenException('This is for platform staff only.');
      return true;
    }
    const noHome = this.reflector.getAllAndOverride<boolean>(NO_HOME_KEY, targets);
    if (noHome) return true;

    if (!user.homeId) throw new ConflictException('Choose a home first.');
    // time-limited access: outside the hours or after the end, nothing in the home (devices, rooms, the assistant)
    if (user.blocked) throw new ForbiddenException(user.blocked.message);
    if (user.readOnly && !READS.has(req.method)) throw new ForbiddenException('Support access is read-only.');
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, targets);
    if (roles && !roles.includes(user.role)) throw new ForbiddenException('You do not have permission for this.');
    if (this.reflector.getAllAndOverride<boolean>(SETUP_KEY, targets) && !canSetup(user)) {
      throw new ForbiddenException('Boards and wiring are managed by the installer.');
    }
    return true;
  }
}

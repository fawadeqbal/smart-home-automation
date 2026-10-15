import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { Role, StaffRole } from '@prisma/client';
import { AuthUser } from './auth.types';

export const PUBLIC_KEY = 'isPublic';
/** Route needs no sign-in (login, sign-up, invite acceptance, health). */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

export const NO_HOME_KEY = 'noHome';
/** Route works without a home (the person's own account, notifications, the platform console). */
export const NoHome = () => SetMetadata(NO_HOME_KEY, true);

export const ROLES_KEY = 'roles';
/** Route is limited to these roles in the current home, e.g. @Roles('OWNER', 'ADMIN'). */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export const STAFF_KEY = 'staff';
/** Route is for platform staff with one of these roles (implies @NoHome). */
export const Staff = (...roles: StaffRole[]) => SetMetadata(STAFF_KEY, roles);

export const SETUP_KEY = 'setup';
/** Boards, pins, wiring and firmware of the current home: super admins, and installers of that home. */
export const Setup = () => SetMetadata(SETUP_KEY, true);

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user,
);

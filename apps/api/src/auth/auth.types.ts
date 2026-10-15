import { Role, StaffRole } from '@prisma/client';

/**
 * The signed-in person, attached to every authenticated request, together with the home the
 * request is about (the "X-Home-Id" header, else the last home they used).
 *
 * `role` is their effective role in that home. Home people have it from their membership;
 * platform staff get one from their staff role: super admins act as OWNER, installers (on the
 * homes assigned to them) and support as ADMIN — support with `readOnly` set, so it can look
 * but never change anything.
 */
export interface AuthUser {
  id: string;
  name: string;
  email: string;
  /** "web" for a browser session, "voice" when the assistant acts on their behalf. */
  channel: 'web' | 'voice' | 'automation';
  /** Platform staff only. */
  orgId: string | null;
  staffRole: StaffRole | null;
  /** The home this request is about ('' when none: the person has no home and did not pick one). */
  homeId: string;
  role: Role;
  /** True when the access comes from the staff role rather than a membership in the home. */
  viaStaff: boolean;
  /** Support staff: may read everything in the home, change nothing. */
  readOnly: boolean;
}

export const ACCESS_COOKIE = 'access';
export const REFRESH_COOKIE = 'refresh';
export const HOME_HEADER = 'x-home-id';
export const ACCESS_TTL_SEC = 15 * 60;
export const REFRESH_TTL_SEC = 30 * 24 * 3600;
export const ON_BEHALF_TTL_SEC = 120;

export interface AccessClaims {
  sub: string;
  typ: 'access' | 'obo';
  /** obo tokens: the home the assistant acts in. */
  hid?: string;
}

export const isAdmin = (role: Role) => role === Role.OWNER || role === Role.ADMIN;

/** Boards, pins, wiring, firmware: super admins, and installers on their homes. */
export const canSetup = (user: Pick<AuthUser, 'staffRole' | 'viaStaff' | 'homeId'>) =>
  // only through the staff role in *this* home: a super admin of another organization who is a guest here gets nothing
  !!user.homeId && user.viaStaff && (user.staffRole === StaffRole.SUPERADMIN || user.staffRole === StaffRole.INSTALLER);

export const STAFF_LABEL: Record<StaffRole, string> = { SUPERADMIN: 'Super admin', INSTALLER: 'Installer', SUPPORT: 'Support' };
export const ROLE_LABEL: Record<Role, string> = { OWNER: 'Home owner', ADMIN: 'Home admin', MEMBER: 'Member', GUEST: 'Guest' };

import type { Access, Role, StaffRole } from './types';

export const ROLE_LABEL: Record<Role, string> = { OWNER: 'Home owner', ADMIN: 'Home admin', MEMBER: 'Member', GUEST: 'Guest' };
export const STAFF_LABEL: Record<StaffRole, string> = { SUPERADMIN: 'Super admin', INSTALLER: 'Installer', SUPPORT: 'Support' };
export const ACCESS_LABEL: Record<Access, string> = { VIEW: 'Can see', CONTROL: 'Can switch', MANAGE: 'Switch & rename' };

export const STAFF_BLURB: Record<StaffRole, string> = {
  SUPERADMIN: 'Everything: homes, inventory, staff and billing',
  INSTALLER: 'Sets up the homes assigned to them: boards, pins and rooms',
  SUPPORT: 'Reads every home to help owners; changes nothing',
};
export const ROLE_BLURB: Record<Role, string> = {
  OWNER: 'Everything in the home, invites the family',
  ADMIN: 'Like the owner, except owners and admins',
  MEMBER: 'Only the rooms shared with them',
  GUEST: 'Switching in shared rooms, for a while',
};

/* ---------------------------------------------------------------- the permission matrix (also enforced by the API) */
export type Cell = { t: 'full' } | { t: 'read' } | { t: 'none' } | { t: 'scope'; label: string };
const F: Cell = { t: 'full' }, R: Cell = { t: 'read' }, N: Cell = { t: 'none' };
const S = (label: string): Cell => ({ t: 'scope', label });

export const ROLE_COLUMNS: { key: StaffRole | Role; label: string; scope: 'Platform' | 'Home' }[] = [
  { key: 'SUPERADMIN', label: 'Super admin', scope: 'Platform' },
  { key: 'INSTALLER', label: 'Installer', scope: 'Platform' },
  { key: 'SUPPORT', label: 'Support', scope: 'Platform' },
  { key: 'OWNER', label: 'Home owner', scope: 'Home' },
  { key: 'ADMIN', label: 'Home admin', scope: 'Home' },
  { key: 'MEMBER', label: 'Member', scope: 'Home' },
  { key: 'GUEST', label: 'Guest', scope: 'Home' },
];

export const MATRIX: { group: string; rows: [string, Cell[]][] }[] = [
  { group: 'Platform', rows: [
    ['See homes', [F, S('Assigned'), R, N, N, N, N]],
    ['Create and archive homes', [F, N, N, N, N, N, N]],
    ['Board inventory', [F, N, R, N, N, N, N]],
    ['Assign boards to homes', [F, N, N, N, N, N, N]],
    ['Manage platform staff', [F, N, N, N, N, N, N]],
    ['Plan and billing', [F, N, N, N, N, N, N]],
  ] },
  { group: 'Home setup', rows: [
    ['Boards, pins and wiring', [F, S('Assigned'), R, R, R, N, N]],
    ['Firmware and reboot', [F, S('Assigned'), N, N, N, N, N]],
    ['Rooms', [F, S('Assigned'), R, F, F, N, N]],
    ['Invite people, set access', [F, S('Owner invite'), R, F, S('Not owner'), N, N]],
  ] },
  { group: 'Diagnostics', rows: [
    ['Board health and signal', [F, F, R, R, R, N, N]],
    ['Device history', [F, F, R, R, R, S('Shared rooms'), S('Shared rooms')]],
    ['Audit log', [F, S('Assigned'), R, S('Own home'), S('Own home'), N, N]],
  ] },
  { group: 'Daily use', rows: [
    ['Switch lights and sockets', [F, S('Assigned'), N, F, F, S('Shared rooms'), S('Shared rooms')]],
    ['Rename devices', [F, F, N, F, F, S('If allowed'), N]],
    ['Scenes and schedules', [F, S('Assigned'), N, F, F, S('Shared rooms'), S('Shared rooms')]],
    ['Voice assistant', [F, S('Assigned'), N, F, F, S('Shared rooms'), S('Shared rooms')]],
  ] },
];

export const ROOM_ICON = (name: string) => {
  const n = name.toLowerCase();
  if (/(living|lounge|hall|drawing)/.test(n)) return 'sofa';
  if (/(kitchen|dining)/.test(n)) return 'utensils';
  if (/(bed|kids|master|guest room)/.test(n)) return 'bed';
  if (/(bath|wash|toilet)/.test(n)) return 'bath';
  if (/(garage|parking|car)/.test(n)) return 'car';
  if (/(garden|lawn|balcony|terrace|yard)/.test(n)) return 'tree';
  if (/(pump|utility|store)/.test(n)) return 'wrench';
  return 'door-open';
};

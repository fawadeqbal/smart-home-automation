export * from './topics';
export * from './payloads';
export * from './boards';
export * from './device-types';

/** Roles and per-room access levels (mirrors the Prisma enums). */
export const ROLES = ['OWNER', 'ADMIN', 'MEMBER', 'GUEST'] as const;
export type RoleName = (typeof ROLES)[number];
export const ACCESS_LEVELS = ['VIEW', 'CONTROL', 'MANAGE'] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];

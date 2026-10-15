import { ForbiddenException, Global, Injectable, Module, NotFoundException } from '@nestjs/common';
import { Access } from '@prisma/client';
import { AuthUser, isAdmin } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';

/** VIEW < CONTROL < MANAGE */
export const RANK: Record<Access, number> = { VIEW: 1, CONTROL: 2, MANAGE: 3 };

/** 'all' for owners and admins, otherwise roomId -> level. */
export type RoomLevels = 'all' | Map<string, Access>;

/**
 * The single place that answers "may this person see / switch / edit this?".
 * Owners and admins (and platform staff working in the home) may do everything; members and guests
 * get per-room levels. Support staff see everything but the guard stops them changing anything.
 * A device with no room is visible to owners and admins only.
 */
@Injectable()
export class AccessService {
  constructor(private readonly prisma: PrismaService) {}

  async roomLevels(user: AuthUser): Promise<RoomLevels> {
    if (isAdmin(user.role)) return 'all';
    const rows = await this.prisma.roomAccess.findMany({ where: { userId: user.id, room: { homeId: user.homeId } } });
    // Guests can never manage, whatever the table says.
    return new Map(rows.map((r) => [r.roomId, user.role === 'GUEST' && r.access === 'MANAGE' ? Access.CONTROL : r.access]));
  }

  levelFor(levels: RoomLevels, roomId: string | null): Access | null {
    if (levels === 'all') return Access.MANAGE;
    return roomId ? levels.get(roomId) ?? null : null;
  }

  /** Throws 404 when the person may not even see it (so it does not leak), 403 when they may see but not do. */
  async require(user: AuthUser, roomId: string | null, needed: Access): Promise<Access> {
    const level = this.levelFor(await this.roomLevels(user), roomId);
    if (!level) throw new NotFoundException('Not found.');
    if (RANK[level] < RANK[needed]) {
      const what = needed === Access.CONTROL ? 'control' : 'change';
      throw new ForbiddenException(`You do not have permission to ${what} devices in this room.`);
    }
    return level;
  }
}

@Global()
@Module({ providers: [AccessService], exports: [AccessService] })
export class AccessModule {}

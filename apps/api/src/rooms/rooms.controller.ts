import { BadRequestException, Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { AccessService } from '../access/access.service';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import { AuditService } from '../common/audit.service';
import { ZodPipe } from '../common/zod';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';

const roomSchema = z.object({ name: z.string().trim().min(1).max(60), order: z.number().int().optional() });

@Controller('rooms')
export class RoomsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
  ) {}

  /** Rooms this person may see, with their level in each. */
  @Get()
  async list(@CurrentUser() user: AuthUser) {
    const levels = await this.access.roomLevels(user);
    const rooms = await this.prisma.room.findMany({ where: { homeId: user.homeId }, orderBy: [{ order: 'asc' }, { name: 'asc' }] });
    return rooms.flatMap((r) => {
      const access = this.access.levelFor(levels, r.id);
      return access ? [{ id: r.id, name: r.name, order: r.order, access }] : [];
    });
  }

  @Roles('OWNER', 'ADMIN')
  @Post()
  async create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(roomSchema)) body: z.infer<typeof roomSchema>) {
    try {
      const room = await this.prisma.room.create({ data: { homeId: user.homeId, name: body.name, order: body.order ?? 0 } });
      await this.audit.record(user.homeId, user.id, 'room.create', room.id, body);
      this.realtime.devicesChanged(user.homeId);
      return room;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new BadRequestException('A room with that name already exists.');
      }
      throw err;
    }
  }

  @Roles('OWNER', 'ADMIN')
  @Patch(':id')
  async update(@CurrentUser() user: AuthUser, @Param('id') id: string,
               @Body(new ZodPipe(roomSchema.partial())) body: Partial<z.infer<typeof roomSchema>>) {
    const found = await this.prisma.room.findFirst({ where: { id, homeId: user.homeId } });
    if (!found) throw new NotFoundException('No such room.');
    const room = await this.prisma.room.update({ where: { id }, data: body });
    this.realtime.devicesChanged(user.homeId);
    return room;
  }

  /** Devices in the room are kept, with no room (visible to owners and admins until moved). */
  @Roles('OWNER', 'ADMIN')
  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const { count } = await this.prisma.room.deleteMany({ where: { id, homeId: user.homeId } });
    if (!count) throw new NotFoundException('No such room.');
    await this.audit.record(user.homeId, user.id, 'room.remove', id);
    this.realtime.devicesChanged(user.homeId);
  }
}

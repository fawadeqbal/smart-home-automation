import { BadRequestException, Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { ZodPipe } from '../common/zod';
import { PrismaService } from '../prisma/prisma.service';

const MAX = 50;
const memory = z.object({ text: z.string().trim().min(2).max(300) });

/**
 * What a person asked the assistant to remember in this home ("the store room light is the one by
 * the stairs", "I wake up at 6"). Theirs alone: nobody else in the home sees it.
 */
@Controller('assistant/memory')
export class MemoryController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.prisma.assistantMemory.findMany({
      where: { userId: user.id, homeId: user.homeId }, orderBy: { createdAt: 'asc' }, select: { id: true, text: true, createdAt: true },
    });
  }

  @Post()
  async add(@CurrentUser() user: AuthUser, @Body(new ZodPipe(memory)) body: { text: string }) {
    const where = { userId: user.id, homeId: user.homeId };
    const same = await this.prisma.assistantMemory.findFirst({ where: { ...where, text: { equals: body.text, mode: 'insensitive' } } });
    if (same) return { id: same.id, text: same.text, createdAt: same.createdAt };
    if ((await this.prisma.assistantMemory.count({ where })) >= MAX) {
      throw new BadRequestException(`The assistant remembers at most ${MAX} things for you here. Remove some first.`);
    }
    return this.prisma.assistantMemory.create({ data: { ...where, text: body.text }, select: { id: true, text: true, createdAt: true } });
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const r = await this.prisma.assistantMemory.deleteMany({ where: { id, userId: user.id, homeId: user.homeId } });
    if (!r.count) throw new NotFoundException('Not found.');
  }
}

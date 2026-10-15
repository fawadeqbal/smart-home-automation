import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { HelpAudience, HelpCategory } from '@prisma/client';
import { z } from 'zod';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser, NoHome, Staff } from '../auth/decorators';
import { ZodPipe } from '../common/zod';
import { HelpService } from './help.service';

const article = z.object({
  title: z.string().trim().min(3).max(160),
  category: z.nativeEnum(HelpCategory),
  audience: z.nativeEnum(HelpAudience).default(HelpAudience.EVERYONE),
  tags: z.array(z.string().trim().min(1).max(40)).max(30).default([]),
  body: z.string().trim().min(1).max(20_000),
  published: z.boolean().default(false),
});
const tryIt = z.object({ question: z.string().trim().min(2).max(300), staff: z.boolean().default(false) });

/**
 * The Help Center. Staff read it in the console and super admins edit it; the assistant reads the
 * published articles (through the speaking person's own token, so it only gets what they may see).
 */
@Controller()
export class HelpController {
  constructor(private readonly help: HelpService) {}

  @Staff('SUPERADMIN', 'INSTALLER', 'SUPPORT')
  @Get('platform/help')
  list(@CurrentUser() user: AuthUser) {
    return this.help.list(user);
  }

  @Staff('SUPERADMIN')
  @Post('platform/help')
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(article)) body: z.infer<typeof article>) {
    return this.help.create(user, body);
  }

  @Staff('SUPERADMIN')
  @Patch('platform/help/:id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(article.partial())) body: Partial<z.infer<typeof article>>) {
    return this.help.update(user, id, body);
  }

  @Staff('SUPERADMIN')
  @Delete('platform/help/:id')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.help.remove(user, id);
  }

  /** What the assistant would find for a question (published articles), as a customer or as staff. */
  @Staff('SUPERADMIN', 'INSTALLER', 'SUPPORT')
  @Post('platform/help/try')
  @HttpCode(200)
  try(@CurrentUser() user: AuthUser, @Body(new ZodPipe(tryIt)) body: z.infer<typeof tryIt>) {
    return this.help.tryQuestion(user, body.question, body.staff);
  }

  /** For the assistant: `?articles=1` for the articles, else only the version key. */
  @NoHome()
  @Get('help/feed')
  feed(@CurrentUser() user: AuthUser, @Query('articles') articles?: string, @Query('view') view?: string) {
    return this.help.feed(user, articles === '1', view === 'customer' ? false : undefined);
  }
}

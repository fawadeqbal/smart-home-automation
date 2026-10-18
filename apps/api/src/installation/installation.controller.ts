import { Body, Controller, Delete, Get, Param, Post, Put, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { z } from 'zod';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser, Public, Roles, Staff } from '../auth/decorators';
import { ZodPipe } from '../common/zod';
import { InstallationService } from './installation.service';

const update = z.object({
  // `at`: when the tick was made on the phone (it may arrive later, after the installer is back online)
  items: z.array(z.object({ key: z.string().max(40), done: z.boolean(), note: z.string().max(300).optional(), at: z.string().datetime().optional() })).max(40).optional(),
  notes: z.string().max(4000).optional(),
});
const sign = z.object({ name: z.string().trim().min(2).max(80), signature: z.string().max(400_000) });

/** Installation reports: the installer's checklist and photos (console), the customer's sign-off, and the home's copy. */
@Controller()
export class InstallationController {
  constructor(private readonly installation: InstallationService) {}

  @Staff('SUPERADMIN', 'SUPPORT', 'INSTALLER')
  @Get('platform/homes/:id/installation')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.installation.forStaff(user, id);
  }

  @Staff('SUPERADMIN', 'INSTALLER')
  @Put('platform/homes/:id/installation')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(update)) body: z.infer<typeof update>) {
    return this.installation.update(user, id, body);
  }

  @Staff('SUPERADMIN', 'INSTALLER')
  @Post('platform/homes/:id/installation/photos')
  @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: 8 * 1024 * 1024 } }))
  addPhoto(@CurrentUser() user: AuthUser, @Param('id') id: string, @UploadedFile() file?: Express.Multer.File, @Body('caption') caption?: string) {
    return this.installation.addPhoto(user, id, file, caption ?? '');
  }

  @Staff('SUPERADMIN', 'INSTALLER')
  @Delete('platform/homes/:id/installation/photos/:photo')
  removePhoto(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('photo') photo: string) {
    return this.installation.removePhoto(user, id, photo);
  }

  @Staff('SUPERADMIN', 'INSTALLER')
  @Post('platform/homes/:id/installation/sign')
  staffSign(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(sign)) body: z.infer<typeof sign>) {
    return this.installation.sign(user, id, body, true);
  }

  @Staff('SUPERADMIN')
  @Post('platform/homes/:id/installation/reopen')
  reopen(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.installation.reopen(user, id);
  }

  @Roles('OWNER', 'ADMIN')
  @Get('home/installation')
  mine(@CurrentUser() user: AuthUser) {
    return this.installation.forHome(user);
  }

  @Roles('OWNER')
  @Post('home/installation/sign')
  ownerSign(@CurrentUser() user: AuthUser, @Body(new ZodPipe(sign)) body: z.infer<typeof sign>) {
    return this.installation.sign(user, user.homeId, body, false);
  }

  /** A photo, by the signed link the report gave out (so an <img> can load it). */
  @Public()
  @Get('installation/photos/:id')
  async photo(@Param('id') id: string, @Query('exp') exp: string, @Query('sig') sig: string, @Res() res: Response) {
    const p = await this.installation.photo(id, Number(exp), String(sig ?? ''));
    res.setHeader('Content-Type', p.mime);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.sendFile(p.path, (err) => { if (err && !res.headersSent) res.status(404).end(); });
  }
}

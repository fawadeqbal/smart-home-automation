import { Controller, Delete, Get, HttpCode, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser, Staff } from '../auth/decorators';
import { BackupService } from './backup.service';

/** Server backups: list, make one now, download, delete (super admins of a self-hosted install). */
@Controller('platform/backups')
export class BackupController {
  constructor(private readonly backups: BackupService) {}

  @Staff('SUPERADMIN')
  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.backups.list(user);
  }

  @Staff('SUPERADMIN')
  @Post()
  @HttpCode(200)
  now(@CurrentUser() user: AuthUser) {
    return this.backups.now(user);
  }

  @Staff('SUPERADMIN')
  @Get(':name')
  async download(@CurrentUser() user: AuthUser, @Param('name') name: string, @Res() res: Response) {
    const path = await this.backups.file(user, name);
    res.download(path, name);
  }

  @Staff('SUPERADMIN')
  @Delete(':name')
  remove(@CurrentUser() user: AuthUser, @Param('name') name: string) {
    return this.backups.remove(user, name);
  }
}

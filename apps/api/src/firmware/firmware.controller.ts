import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { z } from 'zod';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser, Public, Setup, Staff } from '../auth/decorators';
import { ZodPipe } from '../common/zod';
import { Inject } from '@nestjs/common';
import { Settings, SETTINGS } from '../config';
import { FirmwareService, lanAddress } from './firmware.service';

@Controller()
export class FirmwareController {
  constructor(private readonly firmware: FirmwareService, @Inject(SETTINGS) private readonly settings: Settings) {}

  /** What to type on a new board's setup page (add-board wizard). */
  @Staff('SUPERADMIN', 'INSTALLER')
  @Get('nodes/setup-info')
  setupInfo() {
    const fromUrl = this.settings.publicApiUrl ? new URL(this.settings.publicApiUrl).hostname : null;
    return {
      server: fromUrl ?? lanAddress(),
      port: this.settings.mqttPublicPort,
      login: 'node',
      password: this.settings.mqttNodePassword,
      encrypted: this.settings.mqttPublicPort === 8883,
    };
  }

  @Staff('SUPERADMIN', 'INSTALLER')
  @Get('firmware')
  list(@CurrentUser() user: AuthUser) {
    return this.firmware.list(user);
  }

  @Staff('SUPERADMIN')
  @Post('firmware')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 1_100_000 } }))
  upload(@CurrentUser() user: AuthUser, @UploadedFile() file: Express.Multer.File, @Body() body: { version?: string; notes?: string }) {
    return this.firmware.upload(user, file, String(body.version ?? ''), String(body.notes ?? ''));
  }

  @Staff('SUPERADMIN')
  @Delete('firmware/:id')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.firmware.remove(user, id);
  }

  @Setup()
  @Post('nodes/:id/update')
  install(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(z.object({ firmwareId: z.string().min(1) }))) body: { firmwareId: string }) {
    return this.firmware.install(user, id, body.firmwareId);
  }

  /** The board downloads here (no sign-in: the link is signed and expires in 10 minutes). */
  @Public()
  @Get('firmware/:id/download')
  async download(@Param('id') id: string, @Query('node') node: string, @Query('exp') exp: string, @Query('sig') sig: string, @Res() res: Response) {
    const f = await this.firmware.download(id, String(node ?? ''), Number(exp), String(sig ?? ''));
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('x-MD5', f.md5); // the ESP8266 updater verifies the image against this
    res.sendFile(f.path, (err) => {
      if (err && !res.headersSent) res.status(404).json({ message: `Firmware file missing on the server (${f.path}). Upload the build again.` });
    });
  }
}

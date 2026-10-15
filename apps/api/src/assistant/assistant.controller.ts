import {
  BadRequestException, Body, Controller, HttpCode, Post, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import { AuthUser } from '../auth/auth.types';
import { StaffRole } from '@prisma/client';
import { CurrentUser, Staff } from '../auth/decorators';
import { ZodPipe } from '../common/zod';
import { AssistantService } from './assistant.service';

/** fresh: the app's chat is empty, so the assistant starts a new conversation (remembers only what the person sees). */
const chatSchema = z.object({
  text: z.string().trim().min(1).max(1000),
  speak: z.boolean().default(true),
  fresh: z.boolean().default(false),
});

@Controller('assistant')
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}

  @Post('chat')
  @HttpCode(200)
  chat(@CurrentUser() user: AuthUser, @Body(new ZodPipe(chatSchema)) body: z.infer<typeof chatSchema>) {
    return this.assistant.chat(user, body.text, body.speak, body.fresh);
  }

  /** multipart/form-data with an "audio" file (what the browser's MediaRecorder produced). */
  @Post('voice')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('audio', { limits: { fileSize: 10 * 1024 * 1024 } }))
  voice(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file?: Express.Multer.File,
    @Body('fresh') fresh?: string,
    @Body('afterWake') afterWake?: string,
  ) {
    if (!file?.buffer?.length) throw new BadRequestException('No audio received.');
    return this.assistant.voice(user, file.buffer, file.mimetype, fresh === 'true', afterWake === 'true');
  }

  @Post('reset')
  @HttpCode(204)
  reset(@CurrentUser() user: AuthUser) {
    return this.assistant.reset(user);
  }

  // ------------------------------------------------- the console: staff, about all the homes they look after
  // Only staff get here (@Staff); what each one hears about is limited by their role on the API side:
  // super admins and support every home, installers only the homes assigned to them.
  @Staff(StaffRole.SUPERADMIN, StaffRole.INSTALLER, StaffRole.SUPPORT)
  @Post('console/chat')
  @HttpCode(200)
  consoleChat(@CurrentUser() user: AuthUser, @Body(new ZodPipe(chatSchema)) body: z.infer<typeof chatSchema>) {
    return this.assistant.chat(user, body.text, body.speak, body.fresh, true);
  }

  @Staff(StaffRole.SUPERADMIN, StaffRole.INSTALLER, StaffRole.SUPPORT)
  @Post('console/voice')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('audio', { limits: { fileSize: 10 * 1024 * 1024 } }))
  consoleVoice(@CurrentUser() user: AuthUser, @UploadedFile() file?: Express.Multer.File, @Body('fresh') fresh?: string) {
    if (!file?.buffer?.length) throw new BadRequestException('No audio received.');
    return this.assistant.voice(user, file.buffer, file.mimetype, fresh === 'true', false, true);
  }

  @Staff(StaffRole.SUPERADMIN, StaffRole.INSTALLER, StaffRole.SUPPORT)
  @Post('console/reset')
  @HttpCode(204)
  consoleReset(@CurrentUser() user: AuthUser) {
    return this.assistant.reset(user, true);
  }
}

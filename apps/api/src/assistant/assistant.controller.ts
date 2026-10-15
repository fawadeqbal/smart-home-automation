import {
  BadRequestException, Body, Controller, HttpCode, Post, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { ZodPipe } from '../common/zod';
import { AssistantService } from './assistant.service';

const chatSchema = z.object({ text: z.string().trim().min(1).max(1000), speak: z.boolean().default(true) });

@Controller('assistant')
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}

  @Post('chat')
  @HttpCode(200)
  chat(@CurrentUser() user: AuthUser, @Body(new ZodPipe(chatSchema)) body: z.infer<typeof chatSchema>) {
    return this.assistant.chat(user, body.text, body.speak);
  }

  /** multipart/form-data with an "audio" file (what the browser's MediaRecorder produced). */
  @Post('voice')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('audio', { limits: { fileSize: 10 * 1024 * 1024 } }))
  voice(@CurrentUser() user: AuthUser, @UploadedFile() file?: Express.Multer.File) {
    if (!file?.buffer?.length) throw new BadRequestException('No audio received.');
    return this.assistant.voice(user, file.buffer, file.mimetype);
  }

  @Post('reset')
  @HttpCode(204)
  reset(@CurrentUser() user: AuthUser) {
    return this.assistant.reset(user);
  }
}

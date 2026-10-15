import { Controller, Get, Inject } from '@nestjs/common';
import { Public } from '../auth/decorators';
import { SETTINGS, Settings } from '../config';
import { MqttService } from '../mqtt/mqtt.service';
import { PrismaService } from '../prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mqtt: MqttService,
    @Inject(SETTINGS) private readonly settings: Settings,
  ) {}

  @Public()
  @Get()
  async health() {
    const [db, assistant] = await Promise.all([
      this.prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
      this.assistant(),
    ]);
    return { ok: db && this.mqtt.connected, database: db, broker: this.mqtt.connected, assistant };
  }

  /** Is the voice assistant up, and can it speak ("natural" = the Piper voice, "basic" = espeak only)? */
  private async assistant(): Promise<{ running: boolean; voice?: string }> {
    try {
      const res = await fetch(`${this.settings.assistantUrl}/health`, { signal: AbortSignal.timeout(2000) });
      const body = (await res.json()) as { voice?: string };
      return { running: res.ok, voice: body.voice };
    } catch {
      return { running: false };
    }
  }
}

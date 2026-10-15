import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/decorators';
import { MqttService } from '../mqtt/mqtt.service';
import { PrismaService } from '../prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService, private readonly mqtt: MqttService) {}

  @Public()
  @Get()
  async health() {
    const db = await this.prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false);
    return { ok: db && this.mqtt.connected, database: db, broker: this.mqtt.connected };
  }
}

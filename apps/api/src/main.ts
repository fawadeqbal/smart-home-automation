import 'reflect-metadata';
import { INestApplicationContext, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { IoAdapter } from '@nestjs/platform-socket.io';
import cookieParser from 'cookie-parser';
import type { ServerOptions } from 'socket.io';
import { createAppModule } from './app.module';
import { loadSettings, Settings } from './config';

/** Socket.IO with the same allowed origins (and cookies) as the REST API. */
class CorsIoAdapter extends IoAdapter {
  constructor(app: INestApplicationContext, private readonly origins: string[]) {
    super(app);
  }

  createIOServer(port: number, options?: ServerOptions) {
    return super.createIOServer(port, { ...options, cors: { origin: this.origins, credentials: true } });
  }
}

export async function createApp(settings: Settings = loadSettings()) {
  const app = await NestFactory.create(createAppModule(settings), { logger: ['log', 'warn', 'error'] });
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.enableCors({ origin: settings.webOrigins, credentials: true });
  app.useWebSocketAdapter(new CorsIoAdapter(app, settings.webOrigins));
  app.enableShutdownHooks();
  return app;
}

async function main() {
  const settings = loadSettings();
  const app = await createApp(settings);
  await app.listen(settings.port, '0.0.0.0');
  new Logger('API').log(`Listening on http://localhost:${settings.port}/api`);
}

if (require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}

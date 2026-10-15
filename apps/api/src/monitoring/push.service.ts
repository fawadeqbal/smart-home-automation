import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import webpush from 'web-push';
import { AuthUser } from '../auth/auth.types';
import { Settings, SETTINGS } from '../config';
import { PrismaService } from '../prisma/prisma.service';

interface Keys { publicKey: string; privateKey: string }

/**
 * Web Push: notices reach phones and computers even when the app is closed (browsers need https,
 * or http://localhost). The VAPID key pair is created once and kept next to the firmware folder.
 */
@Injectable()
export class PushService implements OnModuleInit {
  private readonly log = new Logger('Push');
  private keys: Keys | null = null;

  constructor(private readonly prisma: PrismaService, @Inject(SETTINGS) private readonly settings: Settings) {}

  async onModuleInit() {
    try {
      if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
        this.keys = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
      } else {
        const file = join(dirname(this.settings.firmwareDir), 'vapid.json');
        try {
          this.keys = JSON.parse(await readFile(file, 'utf8')) as Keys;
        } catch {
          this.keys = webpush.generateVAPIDKeys();
          await mkdir(dirname(file), { recursive: true });
          await writeFile(file, JSON.stringify(this.keys), { mode: 0o600 });
          this.log.log(`Created Web Push keys in ${file}`);
        }
      }
      webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? 'mailto:admin@example.com', this.keys.publicKey, this.keys.privateKey);
    } catch (err) {
      this.log.warn(`Web Push disabled: ${(err as Error).message}`);
      this.keys = null;
    }
  }

  publicKey() {
    return { publicKey: this.keys?.publicKey ?? null };
  }

  async subscribe(user: AuthUser, sub: { endpoint: string; keys: { p256dh: string; auth: string } }, userAgent?: string) {
    await this.prisma.pushSubscription.upsert({
      where: { endpoint: sub.endpoint },
      create: { userId: user.id, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent: userAgent?.slice(0, 200) },
      update: { userId: user.id, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    });
  }

  async unsubscribe(user: AuthUser, endpoint: string) {
    await this.prisma.pushSubscription.deleteMany({ where: { userId: user.id, endpoint } });
  }

  async count(user: AuthUser) {
    return { devices: await this.prisma.pushSubscription.count({ where: { userId: user.id } }) };
  }

  /** Sends to every browser the person enabled; forgets ones the push service says are gone. */
  async send(userId: string, payload: { title: string; body: string; link?: string | null; severity: string; id: string }) {
    if (!this.keys) return;
    const subs = await this.prisma.pushSubscription.findMany({ where: { userId } });
    await Promise.all(subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), {
          TTL: 3600, urgency: payload.severity === 'ALERT' ? 'high' : 'normal',
        });
      } catch (err) {
        const code = (err as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) await this.prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => undefined);
        else this.log.warn(`Push failed (${code ?? 'network'}): ${(err as Error).message}`);
      }
    }));
  }
}

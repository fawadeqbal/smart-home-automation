import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import webpush from 'web-push';
import { AuthUser } from '../auth/auth.types';
import { Settings, SETTINGS } from '../config';
import { PrismaService } from '../prisma/prisma.service';
import { FcmClient, PushNotice, readServiceAccount } from './fcm';

interface Keys { publicKey: string; privateKey: string }

/**
 * Push notifications when the app is closed:
 *  - Web Push for browsers (https, or http://localhost). The VAPID key pair is created once and kept next
 *    to the firmware folder.
 *  - Firebase Cloud Messaging for the phone app, once FCM_SERVICE_ACCOUNT is set (see docs/push.md).
 *    Without it phones still register, and nothing is sent.
 */
@Injectable()
export class PushService implements OnModuleInit {
  private readonly log = new Logger('Push');
  private keys: Keys | null = null;
  private fcm: FcmClient | null = null;

  constructor(private readonly prisma: PrismaService, @Inject(SETTINGS) private readonly settings: Settings) {
    try {
      const sa = readServiceAccount(settings.fcmServiceAccount);
      if (sa) {
        this.fcm = new FcmClient(sa);
        this.log.log(`Phone push on (Firebase project ${sa.project_id})`);
      }
    } catch (err) {
      this.log.warn(`Phone push off: ${(err as Error).message}`);
    }
  }

  /** For tests: talk to a fake Google. */
  useFcm(client: FcmClient | null) {
    this.fcm = client;
  }

  get phonePushOn() {
    return !!this.fcm;
  }

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
    const [devices, phones] = await Promise.all([
      this.prisma.pushSubscription.count({ where: { userId: user.id } }),
      this.prisma.phoneToken.count({ where: { userId: user.id } }),
    ]);
    return { devices, phones, phonePush: this.phonePushOn };
  }

  // ---------------------------------------------------------------- phones (Firebase)
  /**
   * The phone app signed in, or Firebase gave it a new token: remember it for this person. A token
   * belongs to one phone, so it moves to whoever signed in on that phone last.
   */
  async registerPhone(user: AuthUser, input: { token: string; platform: string; appVersion?: string | null; replaces?: string | null }) {
    if (input.replaces && input.replaces !== input.token) {
      await this.prisma.phoneToken.deleteMany({ where: { token: input.replaces, userId: user.id } });
    }
    await this.prisma.phoneToken.upsert({
      where: { token: input.token },
      create: { userId: user.id, token: input.token, platform: input.platform, appVersion: input.appVersion ?? null },
      update: { userId: user.id, platform: input.platform, appVersion: input.appVersion ?? null, lastSeenAt: new Date() },
    });
    return { ok: true, phonePush: this.phonePushOn };
  }

  /** Signed out on the phone: no more notices to it. */
  async unregisterPhone(user: AuthUser, token: string) {
    await this.prisma.phoneToken.deleteMany({ where: { token, userId: user.id } });
  }

  /** Sends to every browser and phone the person enabled; forgets ones the push service says are gone. */
  async send(userId: string, payload: PushNotice) {
    await Promise.all([this.sendWeb(userId, payload), this.sendPhones(userId, payload)]);
  }

  private async sendPhones(userId: string, payload: PushNotice) {
    const fcm = this.fcm;
    if (!fcm) return;
    const phones = await this.prisma.phoneToken.findMany({ where: { userId } });
    await Promise.all(phones.map(async (p) => {
      try {
        const r = await fcm.send(p.token, payload);
        if (r.result === 'gone') await this.prisma.phoneToken.delete({ where: { id: p.id } }).catch(() => undefined);
        else if (r.result === 'failed') this.log.warn(`Phone push failed (${r.status}): ${r.error ?? 'no reason given'}`);
      } catch (err) {
        this.log.warn(`Phone push failed: ${(err as Error).message}`);
      }
    }));
  }

  private async sendWeb(userId: string, payload: PushNotice) {
    if (!this.keys) return;
    const subs = await this.prisma.pushSubscription.findMany({ where: { userId } });
    await Promise.all(subs.map(async (s) => {
      try {
        const { id, title, body, link, severity } = payload;
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify({ id, title, body, link, severity }), {
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

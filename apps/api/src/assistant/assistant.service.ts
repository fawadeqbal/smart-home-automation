import { BadGatewayException, Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { AuthUser } from '../auth/auth.types';
import { SETTINGS, Settings } from '../config';
import { PrismaService } from '../prisma/prisma.service';

export interface AssistantReply {
  heard?: string;
  reply: string;
  audio?: string | null; // base64 WAV
}

/**
 * Forwards voice and text to the Python assistant. Each request carries a short-lived token for the
 * person speaking, which the assistant uses for its device tools, so it can only do what they may do.
 *
 * The assistant keeps one conversation per person per home (user id + home id): a customer never sees
 * or continues anyone else's chat, and staff looking into several customers' homes get a separate
 * conversation in each.
 */
@Injectable()
export class AssistantService {
  private readonly log = new Logger('Assistant');

  constructor(
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
    @Inject(SETTINGS) private readonly settings: Settings,
  ) {}

  async chat(user: AuthUser, text: string, speak: boolean, fresh = false): Promise<AssistantReply> {
    const body = JSON.stringify({ text, speak, fresh, ...(await this.identity(user)) });
    return this.call('/v1/chat', { body, headers: { 'Content-Type': 'application/json' } });
  }

  /** afterWake: recorded straight after "Hey Switchboard" (hands-free), so its tail may be in it. */
  async voice(user: AuthUser, audio: Buffer, mimeType: string, fresh = false, afterWake = false): Promise<AssistantReply> {
    const form = new FormData();
    form.append('audio', new Blob([new Uint8Array(audio)], { type: mimeType || 'audio/webm' }), 'speech');
    for (const [k, v] of Object.entries(await this.identity(user))) form.append(k, v);
    form.append('fresh', String(fresh));
    form.append('after_wake', String(afterWake));
    return this.call('/v1/voice', { body: form });
  }

  async reset(user: AuthUser) {
    const body = JSON.stringify(await this.identity(user));
    await this.call('/v1/reset', { body, headers: { 'Content-Type': 'application/json' } });
  }

  /** Who is speaking and in which home: the assistant keys its conversation on both. */
  private async identity(user: AuthUser) {
    const home = user.homeId
      ? await this.prisma.home.findUnique({ where: { id: user.homeId }, select: { name: true, timezone: true } })
      : null;
    return {
      user_id: user.id,
      user_name: user.name,
      home_id: user.homeId,
      home_name: home?.name ?? '',
      timezone: home?.timezone ?? '',
      token: await this.auth.onBehalfToken(user),
    };
  }

  private async call(path: string, init: { body: BodyInit; headers?: Record<string, string> }): Promise<AssistantReply> {
    let res: Response;
    try {
      res = await fetch(`${this.settings.assistantUrl}${path}`, {
        method: 'POST',
        body: init.body,
        headers: { ...init.headers, 'X-Assistant-Secret': this.settings.assistantSecret },
        signal: AbortSignal.timeout(120_000),
      });
    } catch (err) {
      this.log.warn(`Assistant unreachable at ${this.settings.assistantUrl}: ${err}`);
      throw new ServiceUnavailableException('The assistant isn’t available right now. You can still switch things from the app.');
    }
    const data = (await res.json().catch(() => ({}))) as AssistantReply & { detail?: string };
    if (!res.ok) throw new BadGatewayException(data.detail ?? `Assistant error ${res.status}`);
    return data;
  }
}

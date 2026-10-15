import { Global, Inject, Injectable, Logger, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ParsedTopic, parseTopic, topics } from '@home/contracts';
import { connect, IClientPublishOptions, MqttClient } from 'mqtt';
import { randomBytes } from 'node:crypto';
import { SETTINGS, Settings } from '../config';

export type MqttKind = ParsedTopic['kind'];
export type MqttHandler = (topic: ParsedTopic, payload: Record<string, unknown> | null) => void | Promise<void>;

/**
 * The API's one connection to the broker. Parses every message from the boards and hands it to
 * whoever registered for that kind (`on('deviceState', ...)`), so feature modules never deal with
 * raw topics. An empty payload (a cleared retained message) arrives as null.
 *
 * Messages from the same board are handled one after another, in the order the broker delivered
 * them (status before announce, state before the next state...), so handlers never race each other.
 */
@Injectable()
export class MqttService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('MQTT');
  private readonly handlers = new Map<MqttKind, MqttHandler[]>();
  private readonly queues = new Map<string, Promise<void>>();
  private client?: MqttClient;

  constructor(@Inject(SETTINGS) private readonly settings: Settings) {}

  get connected(): boolean {
    return this.client?.connected ?? false;
  }

  on(kind: MqttKind, handler: MqttHandler) {
    this.handlers.set(kind, [...(this.handlers.get(kind) ?? []), handler]);
  }

  onModuleInit() {
    this.client = connect(this.settings.mqttUrl, {
      clientId: `api-${randomBytes(4).toString('hex')}`,
      username: this.settings.mqttUsername,
      password: this.settings.mqttPassword,
      reconnectPeriod: 2000,
      connectTimeout: 10_000,
    });
    this.client.on('connect', () => {
      this.log.log(`Connected to ${this.settings.mqttUrl}`);
      this.client!.subscribe(topics.allFromNodes, { qos: 1 }, (err) => {
        if (err) this.log.error(`Subscribe failed: ${err.message}`);
      });
    });
    this.client.on('error', (err) => this.log.warn(`Broker error: ${err.message}`));
    this.client.on('offline', () => this.log.warn('Broker unreachable, retrying...'));
    this.client.on('message', (topic, buffer) => this.dispatch(topic, buffer));
  }

  async onModuleDestroy() {
    await this.client?.endAsync();
  }

  /** Unsubscribe and subscribe again: the broker re-sends every retained message (all boards' announcements). */
  async resubscribe() {
    if (!this.client?.connected) return;
    await this.client.unsubscribeAsync(topics.allFromNodes);
    await this.client.subscribeAsync(topics.allFromNodes, { qos: 1 });
  }

  async publish(topic: string, payload: object | null, options: IClientPublishOptions = { qos: 1 }) {
    if (!this.client) throw new Error('MQTT not started');
    await this.client.publishAsync(topic, payload === null ? '' : JSON.stringify(payload), options);
  }

  private dispatch(topic: string, buffer: Buffer) {
    const parsed = parseTopic(topic);
    if (!parsed) return;
    let payload: Record<string, unknown> | null = null;
    if (buffer.length > 0) {
      try {
        const value = JSON.parse(buffer.toString('utf8'));
        if (value && typeof value === 'object' && !Array.isArray(value)) payload = value;
        else return;
      } catch {
        this.log.warn(`Ignoring non-JSON message on ${topic}`);
        return;
      }
    }
    const handlers = this.handlers.get(parsed.kind) ?? [];
    if (!handlers.length) return;
    const previous = this.queues.get(parsed.nodeId) ?? Promise.resolve();
    const next = previous.then(async () => {
      for (const handler of handlers) {
        try {
          await handler(parsed, payload);
        } catch (err) {
          this.log.error(`Handler for ${parsed.kind} from ${parsed.nodeId} failed: ${err}`);
        }
      }
    });
    this.queues.set(parsed.nodeId, next);
    void next.then(() => {
      if (this.queues.get(parsed.nodeId) === next) this.queues.delete(parsed.nodeId);
    });
  }
}

@Global()
@Module({ providers: [MqttService], exports: [MqttService] })
export class MqttModule {}

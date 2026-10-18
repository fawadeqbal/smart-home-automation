import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { BOARD_LOGIN_MIN_FIRMWARE, firmwareAtLeast, topics } from '@home/contracts';
import { randomBytes, randomUUID } from 'node:crypto';
import { seal, unseal } from '../auth/totp';
import { SETTINGS, Settings } from '../config';
import { MqttService } from '../mqtt/mqtt.service';
import { PrismaService } from '../prisma/prisma.service';
import { LogsService } from './logs.service';

const CONTROL = '$CONTROL/dynamic-security/v1';
const REPLY = `${CONTROL}/response`;
/** Errors the broker gives for things that are already the way we want them. */
const ALREADY = /already exists|already has role|role already/i;

type Command = Record<string, unknown> & { command: string };

/**
 * Per-board MQTT logins (firmware 2.6.0+). Before, every board used the one shared "node" login, so
 * anyone holding it could pretend to be any board. Now each board gets its own (user and client id =
 * its node id, a random password) the first time it connects with the shared login, over its cmd
 * topic (never retained); the broker's dynamic-security plugin lets that login use only the board's
 * own topics. The password is kept sealed in the database, so the broker's list can be rebuilt after
 * its file is lost.
 *
 * A board that has used its own login is never sent it again automatically: if one later asks with
 * the shared login (an erased chip, or someone else using its id), staff decide with "Reset login".
 * Brokers without the plugin simply keep working with the shared login.
 */
@Injectable()
export class BoardLoginService implements OnModuleInit {
  private readonly log = new Logger('BoardLogin');
  private readonly waiting = new Map<string, (r: { error?: string; data?: unknown }) => void>();
  /** null: not checked yet; false: this broker has no per-board logins */
  private available: boolean | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mqtt: MqttService,
    private readonly logs: LogsService,
    @Inject(SETTINGS) private readonly settings: Settings,
  ) {}

  onModuleInit() {
    this.mqtt.onTopic(REPLY, (buf) => this.onReply(buf));
    // after the broker restarted (or this API did): make sure it knows every board's login
    this.mqtt.onConnect(() => {
      this.available = null;
      setTimeout(() => void this.syncAll().catch((e) => this.log.warn(`Sync failed: ${e}`)), 500);
    });
  }

  get enabled() {
    return this.available === true;
  }

  // ---------------------------------------------------------------- the broker's dynamic security
  private onReply(buf: Buffer) {
    let body: { responses?: { command?: string; error?: string; data?: unknown; correlationData?: string }[] };
    try { body = JSON.parse(buf.toString('utf8')); } catch { return; }
    for (const r of body.responses ?? []) {
      const done = r.correlationData ? this.waiting.get(r.correlationData) : undefined;
      if (!done) continue;
      this.waiting.delete(r.correlationData!);
      done({ error: r.error, data: r.data });
    }
  }

  /** Runs commands one by one; resolves with each one's error (undefined = ok). Rejects on no answer. */
  private async run(commands: Command[], timeoutMs = 4000): Promise<(string | undefined)[]> {
    const results: Promise<string | undefined>[] = [];
    const tagged = commands.map((c) => {
      const id = randomUUID();
      results.push(new Promise((resolve, reject) => {
        const timer = setTimeout(() => { this.waiting.delete(id); reject(new Error('no answer from the broker')); }, timeoutMs);
        this.waiting.set(id, (r) => { clearTimeout(timer); resolve(r.error); });
      }));
      return { ...c, correlationData: id };
    });
    await this.mqtt.publish(CONTROL, { commands: tagged }, { qos: 1 });
    return Promise.all(results);
  }

  /** Whether this broker has per-board logins (asked once per connection). */
  private async check(): Promise<boolean> {
    if (this.available !== null) return this.available;
    try {
      const [error] = await this.run([{ command: 'getDefaultACLAccess' }], 3000);
      this.available = !error;
    } catch {
      this.available = false;
    }
    if (!this.available) this.log.log('This broker has no per-board logins: boards keep the shared login');
    return this.available;
  }

  /** Makes the broker know this board's login: its own role (only its topics) and client. */
  private async ensure(nodeId: string, password: string) {
    const role = `board-${nodeId}`;
    const topic = `home/v1/nodes/${nodeId}/#`;
    const errors = await this.run([
      { command: 'createRole', rolename: role },
      { command: 'addRoleACL', rolename: role, acltype: 'publishClientSend', topic, allow: true, priority: 5 },
      { command: 'addRoleACL', rolename: role, acltype: 'publishClientReceive', topic, allow: true, priority: 5 },
      { command: 'addRoleACL', rolename: role, acltype: 'subscribePattern', topic, allow: true, priority: 5 },
      { command: 'addRoleACL', rolename: role, acltype: 'unsubscribePattern', topic, allow: true, priority: 5 },
      { command: 'createClient', username: nodeId, password, clientid: nodeId, roles: [{ rolename: role }] },
    ]);
    const created = errors[5];
    if (created && ALREADY.test(created)) {
      // it was there already: the password may have changed (a reset)
      const more = await this.run([
        { command: 'setClientPassword', username: nodeId, password },
        { command: 'setClientId', username: nodeId, clientid: nodeId },
        { command: 'addClientRole', username: nodeId, rolename: role },
      ]);
      // (Mosquitto 2.0 answers "Internal error" when the client already has the role: not a problem)
      const bad = more.slice(0, 2).find((e) => e && !ALREADY.test(e));
      if (bad) throw new Error(bad);
    } else if (created) {
      throw new Error(created);
    }
    const bad = errors.slice(0, 5).find((e) => e && !ALREADY.test(e));
    if (bad) throw new Error(bad);
  }

  private async remove(nodeId: string) {
    await this.run([
      { command: 'deleteClient', username: nodeId },
      { command: 'deleteRole', rolename: `board-${nodeId}` },
    ]).catch(() => undefined);
  }

  private async syncAll() {
    if (!(await this.check())) return;
    const nodes = await this.prisma.node.findMany({ where: { mqttSecret: { not: null } }, select: { id: true, mqttSecret: true } });
    for (const n of nodes) {
      try {
        await this.ensure(n.id, unseal(n.mqttSecret!, this.settings.jwtSecret));
      } catch (err) {
        this.log.warn(`Could not restore the login of ${n.id}: ${(err as Error).message}`);
      }
    }
    if (nodes.length) this.log.log(`Broker has the logins of ${nodes.length} board(s)`);
  }

  // ---------------------------------------------------------------- from the boards
  /** A board announced itself: give it its own login when it should have one and isn't using it. */
  async announced(nodeId: string, fw: string, login: 'own' | 'shared' | undefined) {
    if (!firmwareAtLeast(fw, BOARD_LOGIN_MIN_FIRMWARE)) {
      await this.prisma.node.update({ where: { id: nodeId }, data: { mqttLogin: 'shared' } }).catch(() => undefined);
      return;
    }
    const node = await this.prisma.node.findUnique({ where: { id: nodeId }, select: { mqttSecret: true, mqttLoginUsedAt: true } });
    if (!node) return;
    if (login === 'own') {
      await this.prisma.node.update({
        where: { id: nodeId },
        data: { mqttLogin: 'own', mqttLoginProblem: false, ...(node.mqttLoginUsedAt ? {} : { mqttLoginUsedAt: new Date() }) },
      });
      return;
    }
    if (node.mqttLoginUsedAt) {
      // it had its own login and used it, and now comes with the shared one: don't hand the password
      // to whoever this is; staff can reset it after checking the board
      await this.prisma.node.update({ where: { id: nodeId }, data: { mqttLogin: 'shared', mqttLoginProblem: true } });
      this.logs.server(nodeId, 'warn', 'Signed in with the shared login although it has its own: reset its login on the board page if the board was erased or replaced');
      return;
    }
    await this.prisma.node.update({ where: { id: nodeId }, data: { mqttLogin: 'shared' } });
    await this.give(nodeId, node.mqttSecret);
  }

  /** Staff: issue a new login (the board was erased, or the old one may have leaked). */
  async reset(nodeId: string) {
    await this.prisma.node.update({ where: { id: nodeId }, data: { mqttSecret: null, mqttLoginUsedAt: null, mqttLoginProblem: false } });
    if (await this.check()) await this.remove(nodeId);
    const node = await this.prisma.node.findUnique({ where: { id: nodeId }, select: { online: true, firmware: true } });
    // an online board gets the new one now; otherwise when it next connects
    if (node?.online && firmwareAtLeast(node.firmware, BOARD_LOGIN_MIN_FIRMWARE)) await this.give(nodeId, null);
  }

  private async give(nodeId: string, sealed: string | null) {
    if (!(await this.check())) return;
    const password = sealed ? unseal(sealed, this.settings.jwtSecret) : randomBytes(24).toString('base64url');
    try {
      await this.ensure(nodeId, password);
    } catch (err) {
      this.log.warn(`Could not create the login of ${nodeId}: ${(err as Error).message}`);
      return;
    }
    if (!sealed) {
      await this.prisma.node.update({ where: { id: nodeId }, data: { mqttSecret: seal(password, this.settings.jwtSecret), mqttLoginAt: new Date() } });
    }
    await this.mqtt.publish(topics.cmd(nodeId), { action: 'login', user: nodeId, password }, { qos: 1, retain: false });
    this.logs.server(nodeId, 'info', 'Gave the board its own server login');
  }
}

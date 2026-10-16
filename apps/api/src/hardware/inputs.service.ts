import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InputAction, inputEventPayload } from '@home/contracts';
import { Role } from '@prisma/client';
import { AuthService } from '../auth/auth.service';
import { AutomationService } from '../automation/automation.service';
import { MqttService } from '../mqtt/mqtt.service';
import { PrismaService } from '../prisma/prisma.service';
import { DevicesService } from './devices.service';
import { LogsService } from './logs.service';

const GESTURE_TEXT: Record<string, string> = { single: 'pressed', double: 'double-pressed', long: 'held', flip: 'flipped' };

/**
 * What wall buttons and switches do beyond their own switch (which the board already toggled by
 * itself, even without Wi-Fi): a double-press runs a scene, a long press switches everything in a
 * room off, a flip switches a light on another board. They act with the home owner's rights.
 */
@Injectable()
export class InputsService implements OnModuleInit {
  private readonly log = new Logger('Inputs');

  constructor(
    private readonly prisma: PrismaService,
    private readonly devices: DevicesService,
    private readonly automation: AutomationService,
    private readonly auth: AuthService,
    private readonly logs: LogsService,
    private readonly mqtt: MqttService,
  ) {}

  onModuleInit() {
    this.mqtt.on('inputEvent', (t, p) => (t.kind === 'inputEvent' ? this.onEvent(t.nodeId, t.pin, p) : undefined));
  }

  async onEvent(nodeId: string, pin: number, payload: unknown) {
    const parsed = inputEventPayload.safeParse(payload);
    if (!parsed.success) return;
    const gesture = parsed.data.gesture;
    const input = await this.prisma.input.findUnique({
      where: { nodeId_pin: { nodeId, pin } }, include: { node: { select: { homeId: true } }, target: { select: { name: true } } },
    });
    if (!input?.node.homeId) return;
    await this.prisma.input.update({ where: { id: input.id }, data: { lastEventAt: new Date() } });
    const label = input.name || input.target?.name || `GPIO ${pin}`;
    const action = (input.actions as Record<string, InputAction>)[gesture];
    if (!action) {
      this.logs.server(nodeId, 'info', `${label}: ${GESTURE_TEXT[gesture]}`);
      return;
    }
    const owner = await this.prisma.membership.findFirst({ where: { homeId: input.node.homeId, role: Role.OWNER, user: { disabled: false } }, select: { userId: true } });
    const actor = owner ? await this.auth.actorFor(owner.userId, input.node.homeId, 'automation') : null;
    if (!actor) return;
    try {
      const done = await this.run(actor, action);
      this.logs.server(nodeId, 'info', `${label} ${GESTURE_TEXT[gesture]}: ${done}`);
    } catch (err) {
      this.logs.server(nodeId, 'error', `${label} ${GESTURE_TEXT[gesture]}: ${(err as Error).message}`);
      this.log.warn(`Input ${nodeId}/${pin} ${gesture}: ${(err as Error).message}`);
    }
  }

  private async run(actor: Awaited<ReturnType<AuthService['actorFor']>> & object, a: InputAction): Promise<string> {
    if (a.type === 'scene') {
      const r = await this.automation.runScene(actor, a.sceneId);
      return r.summary;
    }
    if (a.type === 'device') {
      const d = await this.devices.command(actor, a.deviceId, a.on === undefined ? { toggle: true } : { on: a.on });
      return `${d.name} ${d.state?.on ? 'on' : 'off'}`;
    }
    // everything (in a room, or the home) that is on and online goes off
    const on = await this.prisma.device.findMany({
      where: { node: { homeId: actor.homeId, online: true }, type: 'switch', enabled: true, ...(a.roomId ? { roomId: a.roomId } : {}) },
      include: { state: true },
    });
    const targets = on.filter((d) => (d.state?.state as { on?: boolean } | null)?.on === true);
    const results = await Promise.allSettled(targets.map((d) => this.devices.command(actor, d.id, { on: false })));
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    return targets.length ? `${ok} of ${targets.length} switched off` : 'nothing was on';
  }
}

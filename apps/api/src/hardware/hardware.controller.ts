import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { BOARDS, DEVICE_TYPES, INPUT_TYPES } from '@home/contracts';
import { z } from 'zod';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser, NoHome, Roles, Setup } from '../auth/decorators';
import { ZodPipe } from '../common/zod';
import { MqttService } from '../mqtt/mqtt.service';
import { DevicesService } from './devices.service';
import { ConnectionsService } from './connections.service';
import { NodesService } from './nodes.service';

const name = z.string().trim().min(1).max(60);
const aliases = z.array(z.string().trim().min(1).max(40)).max(10);
const key = z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/, 'Key: lowercase letters, digits, - and _');

const createDevice = z.object({
  name, type: z.string(), pin: z.number().int(), key: key.optional(), activeLow: z.boolean().optional(),
  roomId: z.string().nullable().optional(), aliases: aliases.optional(), settings: z.record(z.unknown()).optional(),
});
const updateDevice = z.object({
  name: name.optional(), roomId: z.string().nullable().optional(), aliases: aliases.optional(),
  pin: z.number().int().optional(), activeLow: z.boolean().optional(),
  settings: z.record(z.unknown()).optional(), enabled: z.boolean().optional(),
  childLock: z.boolean().optional(), autoOffMinutes: z.number().int().min(0).max(1440).nullable().optional(),
});
const adopt = z.object({ name, board: z.string() });
const updateNode = z.object({ name: name.optional(), board: z.string().optional() });
// Wi-Fi limits: SSID 1-32 bytes, WPA password 8-63 characters (empty for open networks)
const wifi = z.object({ ssid: z.string().min(1).max(32), password: z.string().max(63).refine((p) => p.length === 0 || p.length >= 8, 'A Wi-Fi password has at least 8 characters.') });
const createInput = z.object({
  type: z.string(), pin: z.number().int(), targetId: z.string(), settings: z.record(z.unknown()).optional(),
});

@Controller()
export class HardwareController {
  constructor(
    private readonly nodes: NodesService,
    private readonly devices: DevicesService,
    private readonly mqtt: MqttService,
    private readonly connectionsService: ConnectionsService,
  ) {}

  /** Board pin rules and device types, for the UI's forms. */
  @NoHome()
  @Get('catalog')
  catalog() {
    const strip = (o: Record<string, { settings: unknown }>) =>
      Object.values(o).map(({ settings: _s, ...rest }) => rest);
    return { boards: Object.values(BOARDS), deviceTypes: strip(DEVICE_TYPES), inputTypes: strip(INPUT_TYPES) };
  }

  // ---------------------------------------------------------------- devices (everyone, filtered by rights)
  @Get('devices')
  listDevices(@CurrentUser() user: AuthUser) {
    return this.devices.list(user);
  }

  @Get('devices/:id')
  getDevice(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.devices.get(user, id);
  }

  /** Who switched what, newest first (the home app's "Just now" and Activity). */
  @Get('events')
  events(@CurrentUser() user: AuthUser, @Query('limit') limit?: string, @Query('deviceId') deviceId?: string,
         @Query('roomId') roomId?: string, @Query('before') before?: string) {
    const at = before ? new Date(before) : undefined;
    return this.devices.events(user, { limit: Number(limit ?? 50) || 50, deviceId, roomId, before: at && !Number.isNaN(at.getTime()) ? at : undefined });
  }

  @Get('devices/:id/history')
  history(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query('limit') limit?: string) {
    return this.devices.history(user, id, Number(limit ?? 100));
  }

  @Post('devices/:id/commands')
  @HttpCode(200)
  command(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.devices.command(user, id, body);
  }

  @Patch('devices/:id')
  updateDevice(@CurrentUser() user: AuthUser, @Param('id') id: string,
               @Body(new ZodPipe(updateDevice)) body: z.infer<typeof updateDevice>) {
    return this.devices.update(user, id, body);
  }

  @Setup()
  @Delete('devices/:id')
  @HttpCode(204)
  removeDevice(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.devices.remove(user, id);
  }

  // ---------------------------------------------------------------- boards (owners and admins)
  @Roles('OWNER', 'ADMIN')
  @Get('nodes')
  listNodes(@CurrentUser() user: AuthUser) {
    return this.nodes.list(user.homeId);
  }

  /** Asks the broker to send every board's announcement again (finds boards that started before setup). */
  @Setup()
  @Post('nodes/scan')
  @HttpCode(204)
  async scan() {
    await this.mqtt.resubscribe();
  }

  /** The board's recent live log lines (newer ones arrive over the socket as "node.log"). */
  @Roles('OWNER', 'ADMIN')
  @Get('nodes/:id/logs')
  logs(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.nodes.recentLogs(user, id);
  }

  @Setup()
  @Post('nodes/:id/adopt')
  @HttpCode(204)
  adopt(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(adopt)) body: z.infer<typeof adopt>) {
    return this.nodes.adopt(user, id, body);
  }

  @Setup()
  @Patch('nodes/:id')
  @HttpCode(204)
  updateNode(@CurrentUser() user: AuthUser, @Param('id') id: string,
             @Body(new ZodPipe(updateNode)) body: z.infer<typeof updateNode>) {
    return this.nodes.update(user, id, body);
  }

  @Setup()
  @Delete('nodes/:id')
  @HttpCode(204)
  forget(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.nodes.forget(user, id);
  }

  /** The board's internet connection: public IP, place and provider, how steady it is, recent connections. */
  @Roles('OWNER', 'ADMIN')
  @Get('nodes/:id/connections')
  connections(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.connectionsService.forNode(user.homeId, id);
  }

  @Roles('OWNER', 'ADMIN')
  @Get('nodes/:id/network')
  network(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.nodes.networkInfo(user, id);
  }

  @Setup()
  @Post('nodes/:id/wifi/scan')
  @HttpCode(204)
  scanWifi(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.nodes.scanWifi(user, id);
  }

  @Setup()
  @Post('nodes/:id/wifi')
  @HttpCode(204)
  changeWifi(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(wifi)) body: z.infer<typeof wifi>) {
    return this.nodes.changeWifi(user, id, body);
  }

  @Setup()
  @Post('nodes/:id/wifi/reset')
  @HttpCode(204)
  resetWifi(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.nodes.resetWifi(user, id);
  }

  @Setup()
  @Post('nodes/:id/reboot')
  @HttpCode(204)
  reboot(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.nodes.reboot(user, id);
  }

  @Setup()
  @Post('nodes/:id/devices')
  createDevice(@CurrentUser() user: AuthUser, @Param('id') id: string,
               @Body(new ZodPipe(createDevice)) body: z.infer<typeof createDevice>) {
    return this.devices.create(user, id, body);
  }

  @Setup()
  @Post('nodes/:id/inputs')
  createInput(@CurrentUser() user: AuthUser, @Param('id') id: string,
              @Body(new ZodPipe(createInput)) body: z.infer<typeof createInput>) {
    return this.nodes.addInput(user, id, { ...body, settings: body.settings ?? {} });
  }

  @Setup()
  @Delete('inputs/:id')
  @HttpCode(204)
  removeInput(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.nodes.removeInput(user, id);
  }
}

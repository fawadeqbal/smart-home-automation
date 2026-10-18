import { Global, Injectable, Module } from '@nestjs/common';
import type { Server } from 'socket.io';

/**
 * Pushes live changes to browsers. Each socket joins:
 *   user:<id>      its own person
 *   home:<id>      everyone in the home (board online/offline)
 *   admins:<id>    owners and admins (everything, including devices with no room)
 *   room:<id>      each room the person may at least view
 *   org:<id>       platform staff of an organization (inventory, homes list)
 * so a device change only reaches people who may see that device.
 */
@Injectable()
export class RealtimeService {
  private server?: Server;

  attach(server: Server) {
    this.server = server;
  }

  deviceState(homeId: string, roomId: string | null, payload: object) {
    if (!this.server) return;
    const target = this.server.to(`admins:${homeId}`);
    (roomId ? target.to(`room:${roomId}`) : target).emit('device.state', payload);
  }

  /** Something about devices changed (added, renamed, moved): clients reload their list. */
  devicesChanged(homeId: string) {
    this.server?.to(`home:${homeId}`).emit('devices.changed', {});
  }

  /** Anything addressed to one person (notifications). */
  toUser(userId: string, event: string, payload: unknown) {
    this.server?.to(`user:${userId}`).emit(event, payload);
  }

  /** Timers, schedules or scenes changed: lists reload. */
  schedulesChanged(homeId: string) {
    this.server?.to(`home:${homeId}`).emit('schedules.changed', {});
  }

  /** A schedule just ran (for a notice in the app). */
  scheduleRan(homeId: string, payload: { id: string; name: string; result: string; createdById: string }) {
    this.server?.to(`home:${homeId}`).emit('schedule.ran', payload);
  }

  /** A visit request came in or changed (the console's badge and list). */
  visitsChanged(orgId: string) {
    this.server?.to(`org:${orgId}`).emit('visits.changed', {});
  }

  /** A firmware build was uploaded or deleted: staff screens refresh their "latest version" labels. */
  firmwareChanged(orgId: string) {
    this.server?.to(`org:${orgId}`).emit('firmware.changed', {});
  }

  /** Wi-Fi scan results / Wi-Fi change outcome (admins only). */
  nodeNetwork(homeId: string, payload: Record<string, unknown> & { nodeId: string }) {
    this.server?.to(`admins:${homeId}`).emit('node.network', payload);
  }

  /** A board's latest health report (admins only). */
  nodeHealth(homeId: string, payload: { nodeId: string; health: Record<string, unknown>; lastSeenAt: string }) {
    this.server?.to(`admins:${homeId}`).emit('node.health', payload);
  }

  nodeStatus(homeId: string, payload: { nodeId: string; online: boolean; name?: string | null; changed?: boolean; at?: string }) {
    this.server?.to(`home:${homeId}`).emit('node.status', payload);
  }

  /** Board details (announce, config applied, telemetry) for the boards page. */
  nodesChanged(homeId: string, nodeId: string) {
    this.server?.to(`admins:${homeId}`).emit('nodes.changed', { nodeId });
  }

  /** One live log line of a board (owners and admins only). */
  nodeLog(homeId: string, nodeId: string, entry: object) {
    this.server?.to(`admins:${homeId}`).emit('node.log', { nodeId, entry });
  }

  /** Boards of an organization changed (added to stock, assigned, online…): the inventory reloads. */
  inventoryChanged(orgId: string) {
    this.server?.to(`org:${orgId}`).emit('inventory.changed', {});
  }

  /** Homes of an organization changed (created, setup progress): the console reloads. */
  homesChanged(orgId: string) {
    this.server?.to(`org:${orgId}`).emit('homes.changed', {});
  }

  /** The grid went or came back, the load-shedding schedule or the bill changed: power cards reload. */
  powerChanged(homeId: string) {
    this.server?.to(`home:${homeId}`).emit('power.changed', {});
  }

  /** Someone came home or left (or started or stopped sharing it): "who's home" reloads. */
  presenceChanged(homeId: string) {
    this.server?.to(`home:${homeId}`).emit('presence.changed', {});
  }

  /** Rights changed: drop the person's sockets so they reconnect with the new rooms. */
  accessChanged(userId: string) {
    this.server?.to(`user:${userId}`).emit('access.changed', {});
    this.server?.in(`user:${userId}`).disconnectSockets(true);
  }
}

@Global()
@Module({ providers: [RealtimeService], exports: [RealtimeService] })
export class RealtimeModule {}

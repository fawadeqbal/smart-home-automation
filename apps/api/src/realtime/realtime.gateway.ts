import { Logger } from '@nestjs/common';
import { OnGatewayConnection, OnGatewayInit, WebSocketGateway } from '@nestjs/websockets';
import { parse } from 'cookie';
import type { Server, Socket } from 'socket.io';
import { AccessService } from '../access/access.service';
import { AuthService } from '../auth/auth.service';
import { ACCESS_COOKIE } from '../auth/auth.types';
import { RealtimeService } from './realtime.service';

/** Socket.IO endpoint at /socket.io. Signs in with the same "access" cookie as the REST API. */
@WebSocketGateway()
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly log = new Logger('Realtime');

  constructor(
    private readonly realtime: RealtimeService,
    private readonly auth: AuthService,
    private readonly access: AccessService,
  ) {}

  afterInit(server: Server) {
    this.realtime.attach(server);
  }

  async handleConnection(socket: Socket) {
    try {
      const cookies = parse(socket.handshake.headers.cookie ?? '');
      const asked = typeof socket.handshake.auth?.home === 'string' ? socket.handshake.auth.home : undefined;
      const user = await this.auth.authenticate(cookies[ACCESS_COOKIE] ?? '', ['access'], asked || undefined);
      const rooms = [`user:${user.id}`];
      if (user.orgId && user.staffRole) rooms.push(`org:${user.orgId}`);
      if (user.homeId) {
        const levels = await this.access.roomLevels(user);
        rooms.push(`home:${user.homeId}`);
        if (levels === 'all') rooms.push(`admins:${user.homeId}`);
        else for (const roomId of levels.keys()) rooms.push(`room:${roomId}`);
      }
      await socket.join(rooms);
      socket.emit('ready', { userId: user.id, homeId: user.homeId || null });
    } catch (err) {
      // Expired access token: the browser refreshes it and reconnects.
      socket.emit('auth.error', { message: (err as Error).message || 'Session expired' });
      socket.disconnect(true);
      this.log.debug('Socket rejected: not signed in');
    }
  }
}

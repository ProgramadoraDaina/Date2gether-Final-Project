import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import type { Socket } from 'socket.io';
import { RoomAccessService, type RoomParticipant } from '../room-access.service';

@Injectable()
export class WsJwtAuthGuard implements CanActivate {
  constructor(private readonly access: RoomAccessService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const client = context.switchToWs().getClient<Socket>();
    const data = context.switchToWs().getData<{ code?: string }>();
    const token = client.handshake.auth?.token as string | undefined;
    if (!token) throw new WsException('Elegí tu nombre antes de entrar');
    try {
      const participant = await this.access.verify(token);
      if (data?.code && participant.roomCode !== data.code) throw new Error('Otra sala');
      const socketData = client.data as { participant?: RoomParticipant };
      socketData.participant = participant;
      return true;
    } catch {
      throw new WsException('Acceso a la sala inválido o expirado');
    }
  }
}

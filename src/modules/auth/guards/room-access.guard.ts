import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { Room } from '../../../db/schema';
import { RoomResolverService } from '../../rooms/room-resolver.service';
import { RoomAccessService, type RoomParticipant } from '../room-access.service';

export interface ParticipantRequest extends Request {
  participant: RoomParticipant;
  room: Room;
}

@Injectable()
export class RoomAccessGuard implements CanActivate {
  constructor(
    private readonly access: RoomAccessService,
    private readonly resolver: RoomResolverService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ParticipantRequest>();
    const participant = await this.access.verify(this.access.bearer(request.headers.authorization));
    // Un solo lugar hace el chequeo de binding (D4): resuelve la sala real
    // por código y confirma que el token pertenece a ESA sala por roomId,
    // no por código (que puede haber sido reciclado).
    const room = await this.resolver.resolveJoinable(request.params.roomCode as string);
    this.resolver.assertBound(participant, room);
    request.participant = participant;
    request.room = room;
    return true;
  }
}

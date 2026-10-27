import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { RoomAccessService, type RoomParticipant } from '../room-access.service';

export interface ParticipantRequest extends Request {
  participant: RoomParticipant;
}

@Injectable()
export class RoomAccessGuard implements CanActivate {
  constructor(private readonly access: RoomAccessService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ParticipantRequest>();
    const participant = await this.access.verify(this.access.bearer(request.headers.authorization));
    if (participant.roomCode !== request.params.roomCode) {
      throw new ForbiddenException('El acceso pertenece a otra sala');
    }
    request.participant = participant;
    return true;
  }
}

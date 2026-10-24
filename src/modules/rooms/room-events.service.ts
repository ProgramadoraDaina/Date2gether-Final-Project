import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'events';

export interface MemberRoleChangedEvent {
  roomCode: string;
}

// Puente desacoplado entre RoomsService (REST) y ChatGateway (sockets):
// evita que RoomsModule importe ChatModule (ChatModule ya importa RoomsModule).
@Injectable()
export class RoomEventsService {
  private readonly emitter = new EventEmitter();

  onMemberRoleChanged(listener: (event: MemberRoleChangedEvent) => void): void {
    this.emitter.on('memberRoleChanged', listener);
  }

  emitMemberRoleChanged(event: MemberRoleChangedEvent): void {
    this.emitter.emit('memberRoleChanged', event);
  }
}

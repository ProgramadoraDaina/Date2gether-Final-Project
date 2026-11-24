import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'events';

export interface MemberRoleChangedEvent {
  roomCode: string;
}

export interface RoomEmojisChangedEvent {
  roomCode: string;
}

export interface RoomDeletedEvent {
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

  onRoomEmojisChanged(listener: (event: RoomEmojisChangedEvent) => void): void {
    this.emitter.on('roomEmojisChanged', listener);
  }

  emitRoomEmojisChanged(event: RoomEmojisChangedEvent): void {
    this.emitter.emit('roomEmojisChanged', event);
  }

  onRoomDeleted(listener: (event: RoomDeletedEvent) => void): void {
    this.emitter.on('roomDeleted', listener);
  }

  emitRoomDeleted(event: RoomDeletedEvent): void {
    this.emitter.emit('roomDeleted', event);
  }
}

import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'events';

export interface MemberRoleChangedEvent {
  roomCode: string;
}

export interface RoomEmojisChangedEvent {
  roomCode: string;
}

// Mini salas (breakout-rooms, D12 del design.md): señal de traslado y de
// cierre, nunca el token de LiveKit (ese se emite por HTTP autenticado,
// issueBreakoutToken). roomCode es siempre el código de la sala PADRE: el
// socket de sala es por `roomCode` de la app, no por sala de LiveKit, así
// que un occupant trasladado a una mini sala sigue unido al mismo socket
// room del padre durante todo el traslado.
export interface BreakoutAssignedEvent {
  roomCode: string;
  // El identity del pase de la sala principal (participant.sub == la
  // identity de LiveKit en la principal) con el que ChatGateway ya indexa
  // su connectedUsers: es personal, no se hace broadcast a toda la sala.
  targetIdentity: string;
  breakoutId: string;
  label: string;
  leavePolicy: string;
  closesAt: string | null;
}

// Avisos para toda la sala (cuenta regresiva de retorno, idas y vueltas): solo datos de UI.
export type BreakoutBroadcastEvent =
  | {
      roomCode: string;
      event: 'breakout:closing';
      payload: { breakoutId: string; closesAt: string };
    }
  | {
      roomCode: string;
      event: 'breakout:presence';
      payload: { kind: 'moved' | 'returned'; names: string[]; label: string };
    };

export interface BreakoutClosedEvent {
  roomCode: string;
  breakoutId: string;
}

// Decisión 2 (design.md "Señal de motivo de remoción"): señal previa a una
// remoción forzada, distinguible del cierre y de la asignación --
// `reason` es `BreakoutRemovalReason` (call-group.ts), pero se mantiene
// como `string` acá para que este módulo de infraestructura no dependa de
// CallsModule.
export interface BreakoutRemovalEvent {
  roomCode: string;
  targetIdentity: string;
  reason: string;
}

export interface RoomDeletedEvent {
  roomCode: string;
}

// Puente desacoplado entre RoomsService/CallsModule (REST) y ChatGateway
// (sockets): evita que RoomsModule importe ChatModule (ChatModule ya importa
// RoomsModule) y, para breakout-rooms, evita un import circular entre
// CallsModule y ChatModule (CallsModule ya importa RoomsModule).
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

  onBreakoutAssigned(listener: (event: BreakoutAssignedEvent) => void): void {
    this.emitter.on('breakoutAssigned', listener);
  }

  emitBreakoutAssigned(event: BreakoutAssignedEvent): void {
    this.emitter.emit('breakoutAssigned', event);
  }

  onBreakoutClosed(listener: (event: BreakoutClosedEvent) => void): void {
    this.emitter.on('breakoutClosed', listener);
  }

  emitBreakoutClosed(event: BreakoutClosedEvent): void {
    this.emitter.emit('breakoutClosed', event);
  }

  onBreakoutRemoval(listener: (event: BreakoutRemovalEvent) => void): void {
    this.emitter.on('breakoutRemoval', listener);
  }

  emitBreakoutRemoval(event: BreakoutRemovalEvent): void {
    this.emitter.emit('breakoutRemoval', event);
  }

  onBreakoutBroadcast(listener: (event: BreakoutBroadcastEvent) => void): void {
    this.emitter.on('breakoutBroadcast', listener);
  }

  emitBreakoutBroadcast(event: BreakoutBroadcastEvent): void {
    this.emitter.emit('breakoutBroadcast', event);
  }

  onRoomDeleted(listener: (event: RoomDeletedEvent) => void): void {
    this.emitter.on('roomDeleted', listener);
  }

  emitRoomDeleted(event: RoomDeletedEvent): void {
    this.emitter.emit('roomDeleted', event);
  }
}

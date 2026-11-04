import { describe, expect, it, jest } from '@jest/globals';
import type { DrizzleDb } from '../../db/drizzle.module';
import { WsJwtAuthGuard } from '../auth/guards/ws-jwt-auth.guard';
import type { RoomParticipant } from '../auth/room-access.service';
import type { RoomEventsService } from '../rooms/room-events.service';
import type { RoomsService } from '../rooms/rooms.service';
import type { ChatService } from './chat.service';
import { ChatGateway } from './chat.gateway';

describe('ChatGateway', () => {
  it('requiere un socket autenticado para unirse a una sala', () => {
    const handler = Object.getOwnPropertyDescriptor(ChatGateway.prototype, 'handleJoinRoom')!
      .value as object;
    const guards = (Reflect.getMetadata('__guards__', handler) ?? []) as unknown[];
    expect(guards).toContain(WsJwtAuthGuard);
  });

  function createGateway(nameColorRow?: { nameColor: string | null }) {
    const limit = jest.fn().mockResolvedValue(nameColorRow ? [nameColorRow] : []);
    const where = jest.fn().mockReturnValue({ limit });
    const from = jest.fn().mockReturnValue({ where });
    const select = jest.fn().mockReturnValue({ from });
    const db = { select } as unknown as DrizzleDb;

    const room = { id: 'room-1', code: 'abc-defg-hij', isActive: true };
    const roomsService = {
      findByCode: jest.fn<RoomsService['findByCode']>().mockResolvedValue(room as never),
    } as unknown as RoomsService;
    const chatService = {
      getHistory: jest.fn<ChatService['getHistory']>().mockResolvedValue([]),
      createMessage: jest.fn<ChatService['createMessage']>(),
    } as unknown as ChatService;
    const roomEvents = { onMemberRoleChanged: jest.fn() } as unknown as RoomEventsService;

    const gateway = new ChatGateway(db, roomsService, chatService, roomEvents);
    return { gateway, db, select, chatService };
  }

  function createSocket(participant: RoomParticipant) {
    const toEmit = jest.fn();
    return {
      id: 'socket-1',
      data: { participant },
      join: jest.fn().mockResolvedValue(undefined),
      emit: jest.fn(),
      to: jest.fn().mockReturnValue({ emit: toEmit }),
      toEmit,
    };
  }

  it('incluye el nameColor guardado en la presencia de una cuenta registrada', async () => {
    const { gateway } = createGateway({ nameColor: 'teal' });
    const participant: RoomParticipant = {
      kind: 'room-participant',
      sub: 'participant-1',
      roomCode: 'abc-defg-hij',
      name: 'Ana',
      userId: 'user-1',
    };
    const client = createSocket(participant);

    await gateway.handleJoinRoom(client as never, { code: 'abc-defg-hij' });

    expect(client.toEmit).toHaveBeenCalledWith('userJoined', {
      participantId: 'participant-1',
      userName: 'Ana',
      userId: 'user-1',
      nameColor: 'teal',
    });
  });

  it('no incluye nameColor para invitados sin cuenta', async () => {
    const { gateway, select } = createGateway();
    const participant: RoomParticipant = {
      kind: 'room-participant',
      sub: 'participant-2',
      roomCode: 'abc-defg-hij',
      name: 'Beto',
    };
    const client = createSocket(participant);

    await gateway.handleJoinRoom(client as never, { code: 'abc-defg-hij' });

    expect(select).not.toHaveBeenCalled();
    expect(client.toEmit).toHaveBeenCalledWith('userJoined', {
      participantId: 'participant-2',
      userName: 'Beto',
      userId: undefined,
      nameColor: undefined,
    });
  });

  it('rechaza un mensaje GIF que no viene de GIPHY y no lo guarda', async () => {
    const { gateway, chatService } = createGateway();
    const participant: RoomParticipant = {
      kind: 'room-participant',
      sub: 'participant-3',
      roomCode: 'abc-defg-hij',
      name: 'Caro',
    };
    const client = createSocket(participant);
    await gateway.handleJoinRoom(client as never, { code: 'abc-defg-hij' });

    await gateway.handleSendMessage(client as never, {
      kind: 'gif',
      content: 'https://example.com/tracker.gif',
    });

    expect(client.emit).toHaveBeenCalledWith('error', { message: 'El GIF no es válido' });
    expect(chatService.createMessage).not.toHaveBeenCalled();
  });
});

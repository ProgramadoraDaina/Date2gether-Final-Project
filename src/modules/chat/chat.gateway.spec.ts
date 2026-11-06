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

  function createGateway(
    nameColorRow?: { nameColor: string | null },
    getMemberRole?: RoomsService['getMemberRole'],
  ) {
    const limit = jest
      .fn<() => Promise<{ nameColor: string | null }[]>>()
      .mockResolvedValue(nameColorRow ? [nameColorRow] : []);
    const where = jest.fn().mockReturnValue({ limit });
    const from = jest.fn().mockReturnValue({ where });
    const select = jest.fn().mockReturnValue({ from });
    const db = { select } as unknown as DrizzleDb;

    const room = { id: 'room-1', code: 'abc-defg-hij', isActive: true };
    const roomsService = {
      findByCode: jest.fn<RoomsService['findByCode']>().mockResolvedValue(room as never),
      getMemberRole: getMemberRole ?? jest.fn<RoomsService['getMemberRole']>(),
    } as unknown as RoomsService;
    const createMessage = jest.fn<ChatService['createMessage']>();
    const chatService = {
      getHistory: jest.fn<ChatService['getHistory']>().mockResolvedValue([]),
      createMessage,
    } as unknown as ChatService;
    const roomEvents = {
      onMemberRoleChanged: jest.fn(),
      onRoomEmojisChanged: jest.fn(),
    } as unknown as RoomEventsService;

    const gateway = new ChatGateway(db, roomsService, chatService, roomEvents);
    const serverEmit = jest.fn();
    const serverTo = jest.fn().mockReturnValue({ emit: serverEmit });
    gateway.server = { to: serverTo } as unknown as ChatGateway['server'];
    return { gateway, db, select, createMessage, chatService, roomsService, serverTo, serverEmit };
  }

  function createSocket(participant: RoomParticipant, id = 'socket-1') {
    const toEmit = jest.fn();
    return {
      id,
      data: { participant },
      join: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
      leave: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
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
    const { gateway, createMessage } = createGateway();
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
    expect(createMessage).not.toHaveBeenCalled();
  });

  describe('música ambiental', () => {
    const admin: RoomParticipant = {
      kind: 'room-participant',
      sub: 'participant-admin',
      roomCode: 'abc-defg-hij',
      name: 'Ana',
      userId: 'user-admin',
    };
    const guest: RoomParticipant = {
      kind: 'room-participant',
      sub: 'participant-guest',
      roomCode: 'abc-defg-hij',
      name: 'Invitado',
    };

    async function joinedAdmin(role: 'administrador' | 'colaborador' | 'participante') {
      const getMemberRole = jest.fn<RoomsService['getMemberRole']>().mockResolvedValue(role);
      const setup = createGateway(undefined, getMemberRole);
      const client = createSocket(admin);
      await setup.gateway.handleJoinRoom(client as never, { code: 'abc-defg-hij' });
      return { ...setup, client };
    }

    async function joinedGuest() {
      const setup = createGateway();
      const client = createSocket(guest);
      await setup.gateway.handleJoinRoom(client as never, { code: 'abc-defg-hij' });
      return { ...setup, client };
    }

    it('rechaza musicSetTrack de alguien que no es administrador de la sala', async () => {
      const { gateway, client, serverEmit } = await joinedAdmin('participante');

      await gateway.handleMusicSetTrack(client as never, { videoId: 'dQw4w9WgXcQ' });

      expect(client.emit).toHaveBeenCalledWith('error', {
        message: 'Solo el administrador de la sala puede controlar la música',
      });
      expect(serverEmit).not.toHaveBeenCalled();
    });

    it('rechaza musicSetTrack de un invitado sin cuenta, aunque esté en la sala', async () => {
      const { gateway, client, serverEmit } = await joinedGuest();

      await gateway.handleMusicSetTrack(client as never, { videoId: 'dQw4w9WgXcQ' });

      expect(client.emit).toHaveBeenCalledWith('error', {
        message: 'Necesitás una cuenta para controlar la música de la sala',
      });
      expect(serverEmit).not.toHaveBeenCalled();
    });

    it('un administrador puede elegir una canción por id y se difunde a toda la sala', async () => {
      const { gateway, client, serverTo, serverEmit } = await joinedAdmin('administrador');

      await gateway.handleMusicSetTrack(client as never, { videoId: 'dQw4w9WgXcQ' });

      expect(serverTo).toHaveBeenCalledWith('abc-defg-hij');
      expect(serverEmit).toHaveBeenCalledWith(
        'musicState',
        expect.objectContaining({
          videoId: 'dQw4w9WgXcQ',
          isPlaying: false,
          positionSeconds: 0,
        }),
      );
    });

    it('acepta un link completo de YouTube y extrae el id real', async () => {
      const { gateway, client, serverEmit } = await joinedAdmin('administrador');

      await gateway.handleMusicSetTrack(client as never, {
        videoId: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s',
      });

      expect(serverEmit).toHaveBeenCalledWith(
        'musicState',
        expect.objectContaining({ videoId: 'dQw4w9WgXcQ' }),
      );
    });

    it('rechaza un link o id de YouTube inválido y no actualiza el estado', async () => {
      const { gateway, client, serverEmit } = await joinedAdmin('administrador');

      await gateway.handleMusicSetTrack(client as never, { videoId: '<script>evil</script>' });

      expect(client.emit).toHaveBeenCalledWith('error', {
        message: 'El link o ID de YouTube no es válido',
      });
      expect(serverEmit).not.toHaveBeenCalled();
    });

    it('musicPlay actualiza isPlaying/posición y se difunde a toda la sala, incluido el admin', async () => {
      const { gateway, client, serverTo, serverEmit } = await joinedAdmin('administrador');
      await gateway.handleMusicSetTrack(client as never, { videoId: 'dQw4w9WgXcQ' });

      await gateway.handleMusicPlay(client as never, { positionSeconds: 12 });

      expect(serverTo).toHaveBeenCalledWith('abc-defg-hij');
      expect(serverEmit).toHaveBeenLastCalledWith(
        'musicState',
        expect.objectContaining({ isPlaying: true, positionSeconds: 12 }),
      );
    });

    it('musicPause actualiza isPlaying/posición y se difunde', async () => {
      const { gateway, client, serverEmit } = await joinedAdmin('administrador');
      await gateway.handleMusicSetTrack(client as never, { videoId: 'dQw4w9WgXcQ' });
      await gateway.handleMusicPlay(client as never, { positionSeconds: 12 });

      await gateway.handleMusicPause(client as never, { positionSeconds: 20 });

      expect(serverEmit).toHaveBeenLastCalledWith(
        'musicState',
        expect.objectContaining({ isPlaying: false, positionSeconds: 20 }),
      );
    });

    it('musicSeek cambia la posición sin tocar isPlaying', async () => {
      const { gateway, client, serverEmit } = await joinedAdmin('administrador');
      await gateway.handleMusicSetTrack(client as never, { videoId: 'dQw4w9WgXcQ' });
      await gateway.handleMusicPlay(client as never, { positionSeconds: 12 });

      await gateway.handleMusicSeek(client as never, { positionSeconds: 42 });

      expect(serverEmit).toHaveBeenLastCalledWith(
        'musicState',
        expect.objectContaining({ isPlaying: true, positionSeconds: 42 }),
      );
    });

    it('rechaza musicPlay/Pause/Seek si todavía no se eligió ninguna canción', async () => {
      const { gateway, client, serverEmit } = await joinedAdmin('administrador');

      await gateway.handleMusicPlay(client as never, { positionSeconds: 0 });

      expect(client.emit).toHaveBeenCalledWith('error', {
        message: 'Todavía no se eligió una canción para la sala',
      });
      expect(serverEmit).not.toHaveBeenCalled();
    });

    it('a quien se une después, se le manda el estado de música actual de la sala', async () => {
      const getMemberRole = jest
        .fn<RoomsService['getMemberRole']>()
        .mockResolvedValue('administrador');
      const setup = createGateway(undefined, getMemberRole);
      const adminClient = createSocket(admin, 'socket-admin');
      await setup.gateway.handleJoinRoom(adminClient as never, { code: 'abc-defg-hij' });
      await setup.gateway.handleMusicSetTrack(adminClient as never, { videoId: 'dQw4w9WgXcQ' });

      const lateClient = createSocket(guest, 'socket-guest');
      await setup.gateway.handleJoinRoom(lateClient as never, { code: 'abc-defg-hij' });

      expect(lateClient.emit).toHaveBeenCalledWith(
        'musicState',
        expect.objectContaining({ videoId: 'dQw4w9WgXcQ' }),
      );
    });

    it('no manda musicState a quien se une si todavía no hay ninguna canción elegida', async () => {
      const { client } = await joinedGuest();

      expect(client.emit).not.toHaveBeenCalledWith('musicState', expect.anything());
    });
  });
});

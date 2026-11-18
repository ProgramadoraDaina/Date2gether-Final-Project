import { describe, expect, it, jest } from '@jest/globals';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { DrizzleDb } from '../../db/drizzle.module';
import { WsJwtAuthGuard } from '../auth/guards/ws-jwt-auth.guard';
import type { RoomParticipant } from '../auth/room-access.service';
import type { RoomEventsService } from '../rooms/room-events.service';
import type { RoomResolverService } from '../rooms/room-resolver.service';
import type { RoomsService } from '../rooms/rooms.service';
import type { ChatService } from './chat.service';
import type { RoomPlaylistsService, StoredPlaylist } from './room-playlists.service';
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
    roomOptions: { isPermanent?: boolean; stored?: StoredPlaylist | null } = {},
  ) {
    const limit = jest
      .fn<() => Promise<{ nameColor: string | null }[]>>()
      .mockResolvedValue(nameColorRow ? [nameColorRow] : []);
    const where = jest.fn().mockReturnValue({ limit });
    const from = jest.fn().mockReturnValue({ where });
    const select = jest.fn().mockReturnValue({ from });
    const db = { select } as unknown as DrizzleDb;

    const room = {
      id: 'room-1',
      code: 'abc-defg-hij',
      isActive: true,
      isPermanent: roomOptions.isPermanent ?? false,
    };
    const playlists = {
      load: jest.fn<RoomPlaylistsService['load']>().mockResolvedValue(roomOptions.stored ?? null),
      save: jest.fn<RoomPlaylistsService['save']>().mockResolvedValue(undefined),
    };
    const roomsService = {
      getMemberRole: getMemberRole ?? jest.fn<RoomsService['getMemberRole']>(),
    } as unknown as RoomsService;
    // resolveJoinable/assertBound replican la lógica real (D4, Categoría E):
    // 404 si el código no resuelve (chain().resolveJoinable configurable por
    // test), 403 si el roomId del participante no coincide con el de la sala.
    const resolveJoinable = jest
      .fn<RoomResolverService['resolveJoinable']>()
      .mockResolvedValue(room as never);
    const assertBound = jest
      .fn<RoomResolverService['assertBound']>()
      .mockImplementation((participant, resolvedRoom) => {
        if (participant.roomId !== resolvedRoom.id) {
          throw new ForbiddenException('El acceso pertenece a otra sala');
        }
      });
    const resolver = { resolveJoinable, assertBound } as unknown as RoomResolverService;
    const createMessage = jest.fn<ChatService['createMessage']>();
    const chatService = {
      getHistory: jest.fn<ChatService['getHistory']>().mockResolvedValue([]),
      createMessage,
    } as unknown as ChatService;
    const roomEvents = {
      onMemberRoleChanged: jest.fn(),
      onRoomEmojisChanged: jest.fn(),
    } as unknown as RoomEventsService;

    const gateway = new ChatGateway(
      db,
      roomsService,
      chatService,
      roomEvents,
      resolver,
      playlists as unknown as RoomPlaylistsService,
    );
    const serverEmit = jest.fn();
    const serverTo = jest.fn().mockReturnValue({ emit: serverEmit });
    gateway.server = { to: serverTo } as unknown as ChatGateway['server'];
    return {
      gateway,
      db,
      select,
      createMessage,
      chatService,
      roomsService,
      resolveJoinable,
      assertBound,
      serverTo,
      serverEmit,
      playlists,
    };
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

  describe('handleJoinRoom (Categoría E, D4: resolver.resolveJoinable + assertBound)', () => {
    it('código retirado/vencido/inexistente: emite el evento error existente, no lanza', async () => {
      const { gateway, resolveJoinable } = createGateway();
      resolveJoinable.mockRejectedValueOnce(
        new NotFoundException('No existe una sala con el código "abc-defg-hij"'),
      );
      const participant: RoomParticipant = {
        kind: 'room-participant',
        sub: 'participant-x',
        roomId: 'room-1',
        roomCode: 'abc-defg-hij',
        name: 'Deb',
      };
      const client = createSocket(participant);

      await gateway.handleJoinRoom(client as never, { code: 'abc-defg-hij' });

      expect(client.emit).toHaveBeenCalledWith('error', {
        message: 'No existe una sala con el código "abc-defg-hij"',
      });
      expect(client.join).not.toHaveBeenCalled();
    });

    it('[Flujo 2, design.md] token de R1 presentado contra R2 tras reciclar el código: assertBound rechaza, emite error en vez de unir', async () => {
      const { gateway, resolveJoinable } = createGateway();
      // El código "abc-defg-hij" ahora resuelve a R2 (id distinto); el
      // participante sigue siendo el de R1.
      resolveJoinable.mockResolvedValueOnce({
        id: 'room-2-recycled',
        code: 'abc-defg-hij',
        isActive: true,
      } as never);
      const participant: RoomParticipant = {
        kind: 'room-participant',
        sub: 'participant-y',
        roomId: 'room-1',
        roomCode: 'abc-defg-hij',
        name: 'Edu',
      };
      const client = createSocket(participant);

      await gateway.handleJoinRoom(client as never, { code: 'abc-defg-hij' });

      expect(client.emit).toHaveBeenCalledWith('error', {
        message: 'El acceso pertenece a otra sala',
      });
      expect(client.join).not.toHaveBeenCalled();
    });
  });

  it('incluye el nameColor guardado en la presencia de una cuenta registrada', async () => {
    const { gateway } = createGateway({ nameColor: 'teal' });
    const participant: RoomParticipant = {
      kind: 'room-participant',
      roomId: 'room-1',
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
      roomId: 'room-1',
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
      roomId: 'room-1',
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
      roomId: 'room-1',
      sub: 'participant-admin',
      roomCode: 'abc-defg-hij',
      name: 'Ana',
      userId: 'user-admin',
    };
    const guest: RoomParticipant = {
      kind: 'room-participant',
      roomId: 'room-1',
      sub: 'participant-guest',
      roomCode: 'abc-defg-hij',
      name: 'Invitado',
    };

    async function joinedAdmin(
      role: 'administrador' | 'colaborador' | 'participante',
      roomOptions: { isPermanent?: boolean; stored?: StoredPlaylist | null } = {},
    ) {
      const getMemberRole = jest.fn<RoomsService['getMemberRole']>().mockResolvedValue(role);
      const setup = createGateway(undefined, getMemberRole, roomOptions);
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

    it('en una sala permanente guarda la playlist en la base cada vez que cambia', async () => {
      const { gateway, client, playlists } = await joinedAdmin('administrador', {
        isPermanent: true,
      });

      await gateway.handleMusicAddTrack(client as never, {
        videoId: 'dQw4w9WgXcQ',
        title: 'Love Song Baby',
      });

      expect(playlists.save).toHaveBeenCalledWith(
        'room-1',
        [{ videoId: 'dQw4w9WgXcQ', title: 'Love Song Baby' }],
        0,
      );
    });

    it('en una sala temporal no guarda la playlist en la base', async () => {
      const { gateway, client, playlists } = await joinedAdmin('administrador');

      await gateway.handleMusicAddTrack(client as never, {
        videoId: 'dQw4w9WgXcQ',
        title: 'Love Song Baby',
      });

      expect(playlists.save).not.toHaveBeenCalled();
      expect(playlists.load).not.toHaveBeenCalled();
    });

    it('al entrar a una sala permanente vacía recupera la playlist guardada, en pausa', async () => {
      const { client, playlists } = await joinedAdmin('administrador', {
        isPermanent: true,
        stored: {
          tracks: [
            { videoId: 'dQw4w9WgXcQ', title: 'Love Song Baby' },
            { videoId: 'jNQXAC9IVRw', title: 'Otro Tema' },
          ],
          currentIndex: 1,
        },
      });

      expect(playlists.load).toHaveBeenCalledWith('room-1');
      expect(client.emit).toHaveBeenCalledWith(
        'musicState',
        expect.objectContaining({
          tracks: [
            { videoId: 'dQw4w9WgXcQ', title: 'Love Song Baby' },
            { videoId: 'jNQXAC9IVRw', title: 'Otro Tema' },
          ],
          currentIndex: 1,
          isPlaying: false,
          positionSeconds: 0,
        }),
      );
    });

    it('si falla la base al recuperar la playlist, la persona entra igual sin música', async () => {
      const getMemberRole = jest
        .fn<RoomsService['getMemberRole']>()
        .mockResolvedValue('administrador');
      const setup = createGateway(undefined, getMemberRole, { isPermanent: true });
      setup.playlists.load.mockRejectedValueOnce(new Error('db down'));
      const client = createSocket(admin);

      await setup.gateway.handleJoinRoom(client as never, { code: 'abc-defg-hij' });

      expect(client.emit).not.toHaveBeenCalledWith('musicState', expect.anything());
      expect(client.emit).toHaveBeenCalledWith('roomUsers', expect.anything());
    });

    it('rechaza musicAddTrack de alguien que no es administrador de la sala', async () => {
      const { gateway, client, serverEmit } = await joinedAdmin('participante');

      await gateway.handleMusicAddTrack(client as never, {
        videoId: 'dQw4w9WgXcQ',
        title: 'Love Song Baby',
      });

      expect(client.emit).toHaveBeenCalledWith('error', {
        message: 'Solo el administrador de la sala puede controlar la música',
      });
      expect(serverEmit).not.toHaveBeenCalled();
    });

    it('rechaza musicAddTrack de un invitado sin cuenta, aunque esté en la sala', async () => {
      const { gateway, client, serverEmit } = await joinedGuest();

      await gateway.handleMusicAddTrack(client as never, {
        videoId: 'dQw4w9WgXcQ',
        title: 'Love Song Baby',
      });

      expect(client.emit).toHaveBeenCalledWith('error', {
        message: 'Necesitás una cuenta para controlar la música de la sala',
      });
      expect(serverEmit).not.toHaveBeenCalled();
    });

    it('un administrador puede agregar la primera canción de la lista y se difunde a toda la sala', async () => {
      const { gateway, client, serverTo, serverEmit } = await joinedAdmin('administrador');

      await gateway.handleMusicAddTrack(client as never, {
        videoId: 'dQw4w9WgXcQ',
        title: 'Love Song Baby',
      });

      expect(serverTo).toHaveBeenCalledWith('abc-defg-hij');
      expect(serverEmit).toHaveBeenCalledWith(
        'musicState',
        expect.objectContaining({
          tracks: [{ videoId: 'dQw4w9WgXcQ', title: 'Love Song Baby' }],
          currentIndex: 0,
          isPlaying: false,
          positionSeconds: 0,
        }),
      );
    });

    it('una segunda canción se agrega al final de la lista sin interrumpir lo que ya suena', async () => {
      const { gateway, client, serverEmit } = await joinedAdmin('administrador');
      await gateway.handleMusicAddTrack(client as never, {
        videoId: 'dQw4w9WgXcQ',
        title: 'Love Song Baby',
      });
      await gateway.handleMusicPlay(client as never, { positionSeconds: 12 });

      await gateway.handleMusicAddTrack(client as never, {
        videoId: 'jNQXAC9IVRw',
        title: 'Otro Tema',
      });

      expect(serverEmit).toHaveBeenLastCalledWith(
        'musicState',
        expect.objectContaining({
          tracks: [
            { videoId: 'dQw4w9WgXcQ', title: 'Love Song Baby' },
            { videoId: 'jNQXAC9IVRw', title: 'Otro Tema' },
          ],
          currentIndex: 0,
          isPlaying: true,
          positionSeconds: 12,
        }),
      );
    });

    it('acepta un link completo de YouTube y extrae el id real', async () => {
      const { gateway, client, serverEmit } = await joinedAdmin('administrador');

      await gateway.handleMusicAddTrack(client as never, {
        videoId: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s',
        title: 'Love Song Baby',
      });

      expect(serverEmit).toHaveBeenCalledWith(
        'musicState',
        expect.objectContaining({ tracks: [{ videoId: 'dQw4w9WgXcQ', title: 'Love Song Baby' }] }),
      );
    });

    it('rechaza un link o id de YouTube inválido y no actualiza el estado', async () => {
      const { gateway, client, serverEmit } = await joinedAdmin('administrador');

      await gateway.handleMusicAddTrack(client as never, {
        videoId: '<script>evil</script>',
        title: 'Love Song Baby',
      });

      expect(client.emit).toHaveBeenCalledWith('error', {
        message: 'El link o ID de YouTube no es válido',
      });
      expect(serverEmit).not.toHaveBeenCalled();
    });

    it('musicPlay actualiza isPlaying/posición y se difunde a toda la sala, incluido el admin', async () => {
      const { gateway, client, serverTo, serverEmit } = await joinedAdmin('administrador');
      await gateway.handleMusicAddTrack(client as never, {
        videoId: 'dQw4w9WgXcQ',
        title: 'Love Song Baby',
      });

      await gateway.handleMusicPlay(client as never, { positionSeconds: 12 });

      expect(serverTo).toHaveBeenCalledWith('abc-defg-hij');
      expect(serverEmit).toHaveBeenLastCalledWith(
        'musicState',
        expect.objectContaining({ isPlaying: true, positionSeconds: 12 }),
      );
    });

    it('musicPause actualiza isPlaying/posición y se difunde', async () => {
      const { gateway, client, serverEmit } = await joinedAdmin('administrador');
      await gateway.handleMusicAddTrack(client as never, {
        videoId: 'dQw4w9WgXcQ',
        title: 'Love Song Baby',
      });
      await gateway.handleMusicPlay(client as never, { positionSeconds: 12 });

      await gateway.handleMusicPause(client as never, { positionSeconds: 20 });

      expect(serverEmit).toHaveBeenLastCalledWith(
        'musicState',
        expect.objectContaining({ isPlaying: false, positionSeconds: 20 }),
      );
    });

    it('musicSeek cambia la posición sin tocar isPlaying', async () => {
      const { gateway, client, serverEmit } = await joinedAdmin('administrador');
      await gateway.handleMusicAddTrack(client as never, {
        videoId: 'dQw4w9WgXcQ',
        title: 'Love Song Baby',
      });
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

    it('musicNext avanza a la siguiente canción y reinicia la posición, sin pasarse del final', async () => {
      const { gateway, client, serverEmit } = await joinedAdmin('administrador');
      await gateway.handleMusicAddTrack(client as never, { videoId: 'dQw4w9WgXcQ', title: 'A' });
      await gateway.handleMusicAddTrack(client as never, { videoId: 'jNQXAC9IVRw', title: 'B' });
      await gateway.handleMusicPlay(client as never, { positionSeconds: 30 });

      await gateway.handleMusicNext(client as never);

      expect(serverEmit).toHaveBeenLastCalledWith(
        'musicState',
        expect.objectContaining({ currentIndex: 1, positionSeconds: 0, isPlaying: true }),
      );

      serverEmit.mockClear();
      await gateway.handleMusicNext(client as never);

      expect(serverEmit).toHaveBeenLastCalledWith(
        'musicState',
        expect.objectContaining({ currentIndex: 1 }),
      );
    });

    it('musicPrevious retrocede a la canción anterior y reinicia la posición, sin pasarse del principio', async () => {
      const { gateway, client, serverEmit } = await joinedAdmin('administrador');
      await gateway.handleMusicAddTrack(client as never, { videoId: 'dQw4w9WgXcQ', title: 'A' });
      await gateway.handleMusicAddTrack(client as never, { videoId: 'jNQXAC9IVRw', title: 'B' });
      await gateway.handleMusicNext(client as never);
      await gateway.handleMusicPlay(client as never, { positionSeconds: 30 });

      await gateway.handleMusicPrevious(client as never);

      expect(serverEmit).toHaveBeenLastCalledWith(
        'musicState',
        expect.objectContaining({ currentIndex: 0, positionSeconds: 0, isPlaying: true }),
      );

      serverEmit.mockClear();
      await gateway.handleMusicPrevious(client as never);

      expect(serverEmit).toHaveBeenLastCalledWith(
        'musicState',
        expect.objectContaining({ currentIndex: 0 }),
      );
    });

    it('musicRemoveTrack saca una canción de la lista y se difunde', async () => {
      const { gateway, client, serverTo, serverEmit } = await joinedAdmin('administrador');
      await gateway.handleMusicAddTrack(client as never, { videoId: 'dQw4w9WgXcQ', title: 'A' });
      await gateway.handleMusicAddTrack(client as never, { videoId: 'jNQXAC9IVRw', title: 'B' });

      await gateway.handleMusicRemoveTrack(client as never, { index: 1 });

      expect(serverTo).toHaveBeenCalledWith('abc-defg-hij');
      expect(serverEmit).toHaveBeenLastCalledWith(
        'musicState',
        expect.objectContaining({
          tracks: [{ videoId: 'dQw4w9WgXcQ', title: 'A' }],
          currentIndex: 0,
        }),
      );
    });

    it('al sacar la canción que está sonando, la reproducción se detiene y la posición se reinicia', async () => {
      const { gateway, client, serverEmit } = await joinedAdmin('administrador');
      await gateway.handleMusicAddTrack(client as never, { videoId: 'dQw4w9WgXcQ', title: 'A' });
      await gateway.handleMusicAddTrack(client as never, { videoId: 'jNQXAC9IVRw', title: 'B' });
      await gateway.handleMusicPlay(client as never, { positionSeconds: 30 });

      await gateway.handleMusicRemoveTrack(client as never, { index: 0 });

      expect(serverEmit).toHaveBeenLastCalledWith(
        'musicState',
        expect.objectContaining({
          tracks: [{ videoId: 'jNQXAC9IVRw', title: 'B' }],
          currentIndex: 0,
          isPlaying: false,
          positionSeconds: 0,
        }),
      );
    });

    it('rechaza musicRemoveTrack con un índice fuera de rango', async () => {
      const { gateway, client, serverEmit } = await joinedAdmin('administrador');
      await gateway.handleMusicAddTrack(client as never, { videoId: 'dQw4w9WgXcQ', title: 'A' });
      serverEmit.mockClear();

      await gateway.handleMusicRemoveTrack(client as never, { index: 5 });

      expect(client.emit).toHaveBeenCalledWith('error', {
        message: 'Esa canción ya no está en la lista',
      });
      expect(serverEmit).not.toHaveBeenCalled();
    });

    it('musicJumpToTrack salta directo a la canción elegida, reinicia la posición y preserva isPlaying', async () => {
      const { gateway, client, serverTo, serverEmit } = await joinedAdmin('administrador');
      await gateway.handleMusicAddTrack(client as never, { videoId: 'dQw4w9WgXcQ', title: 'A' });
      await gateway.handleMusicAddTrack(client as never, { videoId: 'jNQXAC9IVRw', title: 'B' });
      await gateway.handleMusicPlay(client as never, { positionSeconds: 30 });

      await gateway.handleMusicJumpToTrack(client as never, { index: 1 });

      expect(serverTo).toHaveBeenCalledWith('abc-defg-hij');
      expect(serverEmit).toHaveBeenLastCalledWith(
        'musicState',
        expect.objectContaining({ currentIndex: 1, positionSeconds: 0, isPlaying: true }),
      );
    });

    it('rechaza musicJumpToTrack con un índice fuera de rango', async () => {
      const { gateway, client, serverEmit } = await joinedAdmin('administrador');
      await gateway.handleMusicAddTrack(client as never, { videoId: 'dQw4w9WgXcQ', title: 'A' });
      serverEmit.mockClear();

      await gateway.handleMusicJumpToTrack(client as never, { index: 5 });

      expect(client.emit).toHaveBeenCalledWith('error', {
        message: 'Esa canción ya no está en la lista',
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
      await setup.gateway.handleMusicAddTrack(adminClient as never, {
        videoId: 'dQw4w9WgXcQ',
        title: 'Love Song Baby',
      });

      const lateClient = createSocket(guest, 'socket-guest');
      await setup.gateway.handleJoinRoom(lateClient as never, { code: 'abc-defg-hij' });

      expect(lateClient.emit).toHaveBeenCalledWith(
        'musicState',
        expect.objectContaining({
          tracks: [{ videoId: 'dQw4w9WgXcQ', title: 'Love Song Baby' }],
        }),
      );
    });

    it('no manda musicState a quien se une si todavía no hay ninguna canción elegida', async () => {
      const { client } = await joinedGuest();

      expect(client.emit).not.toHaveBeenCalledWith('musicState', expect.anything());
    });
  });

  describe('evento de sala (ruleta)', () => {
    const admin: RoomParticipant = {
      kind: 'room-participant',
      roomId: 'room-1',
      sub: 'participant-admin',
      roomCode: 'abc-defg-hij',
      name: 'Ana',
      userId: 'user-admin',
    };
    const collaborator: RoomParticipant = {
      kind: 'room-participant',
      roomId: 'room-1',
      sub: 'participant-collab',
      roomCode: 'abc-defg-hij',
      name: 'Caro',
      userId: 'user-collab',
    };
    const guest: RoomParticipant = {
      kind: 'room-participant',
      roomId: 'room-1',
      sub: 'participant-guest',
      roomCode: 'abc-defg-hij',
      name: 'Invitado',
    };

    async function joinedAs(
      participant: RoomParticipant,
      role: 'administrador' | 'colaborador' | 'participante',
      socketId = 'socket-1',
    ) {
      const getMemberRole = jest.fn<RoomsService['getMemberRole']>().mockResolvedValue(role);
      const setup = createGateway(undefined, getMemberRole);
      const client = createSocket(participant, socketId);
      await setup.gateway.handleJoinRoom(client as never, { code: 'abc-defg-hij' });
      return { ...setup, client };
    }

    it('rechaza startRoomEvent de un participante sin rol de moderación', async () => {
      const { gateway, client, serverEmit } = await joinedAs(admin, 'participante');

      await gateway.handleStartRoomEvent(client as never, {
        type: 'roulette',
        participantIds: ['participant-admin'],
      });

      expect(client.emit).toHaveBeenCalledWith('error', {
        message: 'Solo un administrador o colaborador de la sala puede armar un evento',
      });
      expect(serverEmit).not.toHaveBeenCalled();
    });

    it('rechaza startRoomEvent de un invitado sin cuenta, aunque esté en la sala', async () => {
      const setup = createGateway();
      const client = createSocket(guest);
      await setup.gateway.handleJoinRoom(client as never, { code: 'abc-defg-hij' });

      await setup.gateway.handleStartRoomEvent(client as never, {
        type: 'roulette',
        participantIds: ['participant-guest'],
      });

      expect(client.emit).toHaveBeenCalledWith('error', {
        message: 'Necesitás una cuenta para armar un evento en la sala',
      });
      expect(setup.serverEmit).not.toHaveBeenCalled();
    });

    it('un colaborador puede iniciar una ruleta y se difunde a toda la sala con un ganador de la lista pedida', async () => {
      const { gateway, client, serverTo, serverEmit } = await joinedAs(collaborator, 'colaborador');
      const guestClient = createSocket(guest, 'socket-guest');
      await gateway.handleJoinRoom(guestClient as never, { code: 'abc-defg-hij' });

      await gateway.handleStartRoomEvent(client as never, {
        type: 'roulette',
        participantIds: ['participant-collab', 'participant-guest'],
      });

      expect(serverTo).toHaveBeenCalledWith('abc-defg-hij');
      expect(serverEmit).toHaveBeenCalledWith(
        'eventStarted',
        expect.objectContaining({
          type: 'roulette',
          participants: [
            {
              participantId: 'participant-collab',
              userName: 'Caro',
              userId: 'user-collab',
              nameColor: undefined,
            },
            {
              participantId: 'participant-guest',
              userName: 'Invitado',
              userId: undefined,
              nameColor: undefined,
            },
          ],
        }),
      );
      const [, state] = serverEmit.mock.calls[0] as [string, { winner: { participantId: string } }];
      expect(['participant-collab', 'participant-guest']).toContain(state.winner.participantId);
    });

    it('filtra participantIds de gente que ya no está en la sala; si no queda nadie, error y no difunde', async () => {
      const { gateway, client, serverEmit } = await joinedAs(admin, 'administrador');

      await gateway.handleStartRoomEvent(client as never, {
        type: 'roulette',
        participantIds: ['alguien-que-ya-se-fue'],
      });

      expect(client.emit).toHaveBeenCalledWith('error', {
        message: 'Nadie de la lista elegida sigue en la sala',
      });
      expect(serverEmit).not.toHaveBeenCalled();
    });

    it('a quien se une mientras el resultado sigue vigente, se le manda el eventState (sin animar)', async () => {
      const { gateway, client } = await joinedAs(admin, 'administrador');
      await gateway.handleStartRoomEvent(client as never, {
        type: 'roulette',
        participantIds: ['participant-admin'],
      });

      const lateClient = createSocket(guest, 'socket-guest');
      await gateway.handleJoinRoom(lateClient as never, { code: 'abc-defg-hij' });

      expect(lateClient.emit).toHaveBeenCalledWith(
        'eventState',
        expect.objectContaining({ type: 'roulette' }),
      );
    });

    it('no manda eventState a quien se une si el resultado ya venció (15 minutos)', async () => {
      const { gateway, client } = await joinedAs(admin, 'administrador');
      await gateway.handleStartRoomEvent(client as never, {
        type: 'roulette',
        participantIds: ['participant-admin'],
      });

      const realNow = Date.now;
      jest.spyOn(Date, 'now').mockImplementation(() => realNow() + 15 * 60 * 1000 + 1);
      const lateClient = createSocket(guest, 'socket-guest');
      await gateway.handleJoinRoom(lateClient as never, { code: 'abc-defg-hij' });
      jest.restoreAllMocks();

      expect(lateClient.emit).not.toHaveBeenCalledWith('eventState', expect.anything());
    });
  });
});

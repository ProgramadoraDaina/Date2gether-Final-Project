import { beforeEach, afterEach, describe, expect, it, jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { RoomServiceClient, TokenVerifier } from 'livekit-server-sdk';
import type { DrizzleDb } from '../../db/drizzle.module';
import { callParticipantIdentities, type Room } from '../../db/schema';
import type { RoomParticipant } from '../auth/room-access.service';
import { RoomsService } from '../rooms/rooms.service';
import { CallsService } from './calls.service';

const participant: RoomParticipant = {
  kind: 'room-participant',
  sub: 'guest-1',
  roomCode: 'abc-defg-hij',
  name: 'Ana',
};
const room = { id: 'room-1', code: participant.roomCode, isActive: true } as Room;
const secret = 'test-secret-at-least-32-characters-long';
const config = {
  LIVEKIT_URL: 'wss://media.example.com',
  LIVEKIT_API_URL: 'http://localhost:7880',
  LIVEKIT_API_KEY: 'test-key',
  LIVEKIT_API_SECRET: secret,
  MAX_ROOM_PARTICIPANTS: '6',
};

function createDbMock() {
  const insertValues = jest
    .fn<(values: { roomId: string; userId: string }) => Promise<void>>()
    .mockResolvedValue(undefined);
  const historyInsert = jest.fn().mockReturnValue({ values: insertValues });
  // La correlación de identidad usa un upsert: insert().values().onConflictDoUpdate().
  const identityOnConflictDoUpdate = jest
    .fn<(config: unknown) => Promise<void>>()
    .mockResolvedValue(undefined);
  const identityValues = jest
    .fn()
    .mockReturnValue({ onConflictDoUpdate: identityOnConflictDoUpdate });
  const identityInsert = jest.fn().mockReturnValue({ values: identityValues });
  // Un solo db.insert(table) real: distingue por la tabla recibida, como hace Drizzle.
  const insert = jest.fn((table: unknown) =>
    table === callParticipantIdentities ? identityInsert() : historyInsert(),
  );
  const limit = jest
    .fn<(n: number) => Promise<{ roomCode: string; roomName: string; startedAt: Date }[]>>()
    .mockResolvedValue([]);
  const orderBy = jest.fn().mockReturnValue({ limit });
  const where = jest.fn().mockReturnValue({ orderBy });
  const innerJoin = jest.fn().mockReturnValue({ where });
  const from = jest.fn().mockReturnValue({ innerJoin });
  const select = jest.fn().mockReturnValue({ from });
  return {
    insert,
    insertValues,
    identityValues,
    identityOnConflictDoUpdate,
    select,
    from,
    innerJoin,
    where,
    orderBy,
    limit,
  };
}

describe('CallsService: LiveKit', () => {
  let rooms: { getByCodeOrThrow: jest.Mock<RoomsService['getByCodeOrThrow']> };
  let createRoom: jest.SpiedFunction<RoomServiceClient['createRoom']>;
  let db: ReturnType<typeof createDbMock>;
  let service: CallsService;
  beforeEach(() => {
    rooms = {
      getByCodeOrThrow: jest.fn<RoomsService['getByCodeOrThrow']>().mockResolvedValue(room),
    };
    createRoom = jest
      .spyOn(RoomServiceClient.prototype, 'createRoom')
      .mockResolvedValue({} as Awaited<ReturnType<RoomServiceClient['createRoom']>>);
    db = createDbMock();
    service = new CallsService(
      rooms as unknown as RoomsService,
      new ConfigService(config),
      db as unknown as DrizzleDb,
    );
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('firma un token de invitado limitado a su sala, con permisos de solo unirse (sin admin ni grabación)', async () => {
    const session = await service.join(room.code, participant);
    const claims = await new TokenVerifier(config.LIVEKIT_API_KEY, secret).verify(session.token);
    expect(claims.sub).toBe(participant.sub);
    expect(claims.name).toBe('Ana');
    expect(claims.video).toMatchObject({
      room: room.code,
      roomJoin: true,
      roomAdmin: false,
      roomRecord: false,
      canPublishData: true,
    });
    expect(session.url).toBe('wss://media.example.com');
    expect(session.participantLimit).toBe(6);
    expect(JSON.stringify(session)).not.toContain(secret);
    expect(JSON.stringify(session)).not.toContain('http://localhost:7880');
  });

  it('configura el cupo en LiveKit y el cierre por inactividad', async () => {
    await service.join(room.code, participant);
    expect(createRoom).toHaveBeenCalledWith({
      name: room.code,
      maxParticipants: 6,
      emptyTimeout: 300,
      departureTimeout: 30,
    });
  });

  it('dos invitados que entran a la misma sala al mismo tiempo no se pisan: quedan en la misma sala de LiveKit, pero cada uno con su propio token', async () => {
    const results = await Promise.all([
      service.join(room.code, participant),
      service.join(room.code, { ...participant, sub: 'guest-2', name: 'Ana' }),
    ]);
    expect(results[0].roomName).toBe(results[1].roomName);
    const verifier = new TokenVerifier(config.LIVEKIT_API_KEY, secret);
    expect((await verifier.verify(results[0].token)).sub).not.toBe(
      (await verifier.verify(results[1].token)).sub,
    );
  });

  it('rechaza un pase emitido para otra sala, sin llegar a contactar a LiveKit', async () => {
    await expect(service.join('other-room', participant)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(createRoom).not.toHaveBeenCalled();
  });

  it('rechaza una sala cerrada antes de contactar LiveKit', async () => {
    rooms.getByCodeOrThrow.mockResolvedValue({ ...room, isActive: false });
    await expect(service.join(room.code, participant)).rejects.toThrow('La sala está cerrada');
    expect(createRoom).not.toHaveBeenCalled();
  });

  it('informa si falta configuración sin contactar al servicio', async () => {
    service = new CallsService(
      rooms as unknown as RoomsService,
      new ConfigService({}),
      db as unknown as DrizzleDb,
    );
    await expect(service.join(room.code, participant)).rejects.toThrow(
      'Las llamadas todavía no están configuradas',
    );
    expect(createRoom).not.toHaveBeenCalled();
  });

  it('no convierte valores inválidos en un cupo ilimitado', async () => {
    service = new CallsService(
      rooms as unknown as RoomsService,
      new ConfigService({ ...config, MAX_ROOM_PARTICIPANTS: '0' }),
      db as unknown as DrizzleDb,
    );
    await expect(service.join(room.code, participant)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(createRoom).not.toHaveBeenCalled();
  });

  it('no expone el mensaje de error interno de LiveKit: lo reemplaza por un mensaje genérico para el cliente', async () => {
    createRoom.mockRejectedValueOnce(new Error('private server credentials'));
    await expect(service.join(room.code, participant)).rejects.toThrow(
      'El servidor de llamadas no está disponible. Intentá nuevamente.',
    );
  });

  it('registra el historial de la llamada cuando el participante es una cuenta registrada', async () => {
    const accountParticipant = { ...participant, userId: 'user-1' };
    await service.join(room.code, accountParticipant);
    expect(db.insert).toHaveBeenCalled();
    expect(db.insertValues).toHaveBeenCalledWith({ roomId: room.id, userId: 'user-1' });
  });

  it('no registra historial para invitados sin cuenta', async () => {
    await service.join(room.code, participant);
    expect(db.insertValues).not.toHaveBeenCalled();
  });

  it('no deja que un fallo al registrar el historial rompa la unión a la llamada', async () => {
    const accountParticipant = { ...participant, userId: 'user-1' };
    db.insertValues.mockRejectedValueOnce(new Error('db down'));
    await expect(service.join(room.code, accountParticipant)).resolves.toMatchObject({
      roomName: room.code,
    });
  });
});

describe('CallsService: correlación de identidad', () => {
  let rooms: { getByCodeOrThrow: jest.Mock<RoomsService['getByCodeOrThrow']> };
  let db: ReturnType<typeof createDbMock>;
  let service: CallsService;
  beforeEach(() => {
    rooms = {
      getByCodeOrThrow: jest.fn<RoomsService['getByCodeOrThrow']>().mockResolvedValue(room),
    };
    jest.spyOn(RoomServiceClient.prototype, 'createRoom').mockResolvedValue(
      {} as Awaited<ReturnType<RoomServiceClient['createRoom']>>,
    );
    db = createDbMock();
    service = new CallsService(
      rooms as unknown as RoomsService,
      new ConfigService(config),
      db as unknown as DrizzleDb,
    );
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('usuario registrado se une: persiste la correlación identity↔userId,roomId antes de emitir el token', async () => {
    const accountParticipant = { ...participant, userId: 'user-1' };
    await service.join(room.code, accountParticipant);
    expect(db.insert).toHaveBeenCalledWith(callParticipantIdentities);
    expect(db.identityValues).toHaveBeenCalledWith({
      livekitIdentity: accountParticipant.sub,
      roomId: room.id,
      userId: 'user-1',
      displayName: accountParticipant.name,
    });
  });

  it('upsertea por onConflictDoUpdate sobre livekitIdentity (reintento con el mismo identity de la JWT de 24h)', async () => {
    const accountParticipant = { ...participant, userId: 'user-1' };
    await service.join(room.code, accountParticipant);
    expect(db.identityOnConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ target: callParticipantIdentities.livekitIdentity }),
    );
  });

  it('invitado se une: persiste la correlación con displayName y sin userId', async () => {
    await service.join(room.code, participant);
    expect(db.identityValues).toHaveBeenCalledWith({
      livekitIdentity: participant.sub,
      roomId: room.id,
      userId: null,
      displayName: participant.name,
    });
  });

  it('misma cuenta se reconecta en la misma sesión: dos correlaciones con identity distinto, mismo userId', async () => {
    const accountParticipant = { ...participant, userId: 'user-1' };
    await service.join(room.code, accountParticipant);
    await service.join(room.code, { ...accountParticipant, sub: 'account-reconnect-2' });

    expect(db.identityValues).toHaveBeenNthCalledWith(1, {
      livekitIdentity: accountParticipant.sub,
      roomId: room.id,
      userId: 'user-1',
      displayName: accountParticipant.name,
    });
    expect(db.identityValues).toHaveBeenNthCalledWith(2, {
      livekitIdentity: 'account-reconnect-2',
      roomId: room.id,
      userId: 'user-1',
      displayName: accountParticipant.name,
    });
  });

  it('mismo invitado se reconecta en la misma sesión: dos correlaciones con identity distinto, mismo nombre', async () => {
    await service.join(room.code, participant);
    await service.join(room.code, { ...participant, sub: 'guest-reconnect-2' });

    expect(db.identityValues).toHaveBeenNthCalledWith(1, {
      livekitIdentity: participant.sub,
      roomId: room.id,
      userId: null,
      displayName: participant.name,
    });
    expect(db.identityValues).toHaveBeenNthCalledWith(2, {
      livekitIdentity: 'guest-reconnect-2',
      roomId: room.id,
      userId: null,
      displayName: participant.name,
    });
  });

  it('regresión: las condiciones actuales de callHistory no cambian por la correlación de identidad (registrado sí, invitado no)', async () => {
    const accountParticipant = { ...participant, userId: 'user-1' };
    await service.join(room.code, accountParticipant);
    expect(db.insertValues).toHaveBeenCalledWith({ roomId: room.id, userId: 'user-1' });

    db.insertValues.mockClear();
    await service.join(room.code, participant);
    expect(db.insertValues).not.toHaveBeenCalled();
  });
});

describe('CallsService: historial', () => {
  let rooms: { getByCodeOrThrow: jest.Mock<RoomsService['getByCodeOrThrow']> };
  let db: ReturnType<typeof createDbMock>;
  let service: CallsService;

  beforeEach(() => {
    rooms = {
      getByCodeOrThrow: jest.fn<RoomsService['getByCodeOrThrow']>().mockResolvedValue(room),
    };
    db = createDbMock();
    service = new CallsService(
      rooms as unknown as RoomsService,
      new ConfigService(config),
      db as unknown as DrizzleDb,
    );
  });

  it('lista el historial del usuario más reciente primero, limitado y con roomCode/roomName', async () => {
    const rows = [
      { roomCode: 'abc-defg-hij', roomName: 'Reunión 1', startedAt: new Date('2026-01-02') },
      { roomCode: 'xyz-uvwt-rst', roomName: 'Reunión 2', startedAt: new Date('2026-01-01') },
    ];
    db.limit.mockResolvedValue(rows);

    const result = await service.listHistory('user-1');

    expect(result).toEqual(rows);
    expect(db.where).toHaveBeenCalled();
    expect(db.orderBy).toHaveBeenCalled();
    expect(db.limit).toHaveBeenCalledWith(50);
  });
});

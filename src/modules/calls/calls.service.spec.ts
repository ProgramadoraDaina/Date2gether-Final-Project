import { beforeEach, afterEach, describe, expect, it, jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { RoomServiceClient, TokenVerifier, type ParticipantInfo } from 'livekit-server-sdk';
import type { DrizzleDb } from '../../db/drizzle.module';
import { callParticipantIdentities, roomMembers, type Room } from '../../db/schema';
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

  // select(...).from(callHistory).innerJoin(rooms, ...).where(...).orderBy(...).limit(...)
  // — cadena de listHistory(), sin cambios por este PR.
  const limit = jest
    .fn<(n: number) => Promise<{ roomCode: string; roomName: string; startedAt: Date }[]>>()
    .mockResolvedValue([]);
  const orderBy = jest.fn().mockReturnValue({ limit });
  const historyWhere = jest.fn().mockReturnValue({ orderBy });
  const innerJoin = jest.fn().mockReturnValue({ where: historyWhere });
  const historyFrom = jest.fn().mockReturnValue({ innerJoin });

  // select({role}).from(roomMembers).where(...).limit(1) — resolveLocalRole().
  // Default: ninguna fila (invitado, o cuenta sin rol admin/colaborador
  // registrado todavía) para no asumir admin por accidente en los tests
  // que no son del gate.
  const roleLimit = jest.fn<() => Promise<{ role: string }[]>>().mockResolvedValue([]);
  const roleWhere = jest.fn().mockReturnValue({ limit: roleLimit });
  const roleFrom = jest.fn().mockReturnValue({ where: roleWhere });

  // select({id}).from(callParticipantIdentities).where(...).limit(1) —
  // cruce de identities conectadas contra roleAtIssue='administrador' en
  // assertHostConnected(). Default: SÍ hay un admin conectado, para que los
  // tests de join() preexistentes (que no ejercitan el gate en sí) sigan
  // emitiendo token sin tener que mockear un anfitrión por separado.
  const adminLimit = jest
    .fn<() => Promise<{ id: string }[]>>()
    .mockResolvedValue([{ id: 'already-connected-admin-identity' }]);
  const adminWhere = jest.fn().mockReturnValue({ limit: adminLimit });
  const adminFrom = jest.fn().mockReturnValue({ where: adminWhere });

  const from = jest.fn((table: unknown) => {
    if (table === roomMembers) return roleFrom();
    if (table === callParticipantIdentities) return adminFrom();
    return historyFrom();
  });
  const select = jest.fn().mockReturnValue({ from });
  return {
    insert,
    insertValues,
    identityValues,
    identityOnConflictDoUpdate,
    select,
    from,
    innerJoin,
    where: historyWhere,
    orderBy,
    limit,
    roleLimit,
    adminLimit,
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
    // Gate de anfitrión (Fase 5): estos tests no son sobre el gate en sí,
    // así que por defecto se asume un anfitrión ya conectado (combinado con
    // el adminLimit por defecto de createDbMock) para que el invitado de
    // estos escenarios preexistentes pueda unirse sin tener que mockear la
    // presencia de un admin en cada test.
    jest
      .spyOn(RoomServiceClient.prototype, 'listParticipants')
      .mockResolvedValue([{ identity: 'already-connected-admin' } as ParticipantInfo]);
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
    // Ver el comentario equivalente en 'CallsService: LiveKit': estos tests
    // son sobre la correlación de identidad, no sobre el gate de admin en
    // sí, así que se asume un anfitrión ya conectado por defecto.
    jest
      .spyOn(RoomServiceClient.prototype, 'listParticipants')
      .mockResolvedValue([{ identity: 'already-connected-admin' } as ParticipantInfo]);
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
    // roleAtIssue: null porque este describe no configura ninguna fila en
    // roomMembers (resolveLocalRole no encuentra nada) — la población real
    // de roleAtIssue con un rol efectivo se cubre en el describe del gate
    // de administrador, más abajo (población pendiente desde PR2, Fase 5).
    expect(db.identityValues).toHaveBeenCalledWith({
      livekitIdentity: accountParticipant.sub,
      roomId: room.id,
      userId: 'user-1',
      displayName: accountParticipant.name,
      roleAtIssue: null,
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
      roleAtIssue: null,
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
      roleAtIssue: null,
    });
    expect(db.identityValues).toHaveBeenNthCalledWith(2, {
      livekitIdentity: 'account-reconnect-2',
      roomId: room.id,
      userId: 'user-1',
      displayName: accountParticipant.name,
      roleAtIssue: null,
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
      roleAtIssue: null,
    });
    expect(db.identityValues).toHaveBeenNthCalledWith(2, {
      livekitIdentity: 'guest-reconnect-2',
      roomId: room.id,
      userId: null,
      displayName: participant.name,
      roleAtIssue: null,
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

describe('CallsService: gate de administrador (host-gate)', () => {
  let rooms: { getByCodeOrThrow: jest.Mock<RoomsService['getByCodeOrThrow']> };
  let db: ReturnType<typeof createDbMock>;
  let service: CallsService;
  let listParticipants: jest.SpiedFunction<RoomServiceClient['listParticipants']>;

  beforeEach(() => {
    rooms = {
      getByCodeOrThrow: jest.fn<RoomsService['getByCodeOrThrow']>().mockResolvedValue(room),
    };
    jest
      .spyOn(RoomServiceClient.prototype, 'createRoom')
      .mockResolvedValue({} as Awaited<ReturnType<RoomServiceClient['createRoom']>>);
    listParticipants = jest.spyOn(RoomServiceClient.prototype, 'listParticipants');
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

  it('administrador se une a una sala vacía: se emite el token sin consultar listParticipants (spec host-gate/admin-siempre)', async () => {
    db.roleLimit.mockResolvedValueOnce([{ role: 'administrador' }]);
    const adminParticipant = { ...participant, sub: 'admin-sub', userId: 'admin-1' };

    const session = await service.join(room.code, adminParticipant);

    expect(session.token).toBeDefined();
    expect(listParticipants).not.toHaveBeenCalled();
  });

  it('no-admin con al menos un admin conectado: se emite el token (spec host-gate/con-admin)', async () => {
    listParticipants.mockResolvedValue([{ identity: 'admin-sub' } as ParticipantInfo]);
    db.adminLimit.mockResolvedValueOnce([{ id: 'identity-row-1' }]);

    const session = await service.join(room.code, participant);

    expect(session.token).toBeDefined();
  });

  it('no-admin sin ningún admin conectado (sala vacía): 403 NO_HOST_CONNECTED, sin emitir token (spec host-gate/sin-admin)', async () => {
    listParticipants.mockResolvedValue([]);

    const error = await service.join(room.code, participant).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).getResponse()).toMatchObject({
      code: 'NO_HOST_CONNECTED',
    });
    // Rechazado antes de llegar a escribir la correlación de identidad: no
    // se emitió ningún token.
    expect(db.identityValues).not.toHaveBeenCalled();
  });

  it('listParticipants falla: 503, no 403 (D2 — el error es del sistema, no del solicitante)', async () => {
    listParticipants.mockRejectedValue(new Error('livekit unreachable'));

    await expect(service.join(room.code, participant)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('solo invitados conectados, sin ningún admin: se rechaza igual que si no hubiera nadie (spec host-gate/invitados-no-admin)', async () => {
    listParticipants.mockResolvedValue([
      { identity: 'guest-x' } as ParticipantInfo,
      { identity: 'guest-y' } as ParticipantInfo,
    ]);
    db.adminLimit.mockResolvedValueOnce([]); // el cruce no encuentra ningún admin entre los invitados

    const error = await service.join(room.code, participant).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).getResponse()).toMatchObject({
      code: 'NO_HOST_CONNECTED',
    });
  });

  it('con un admin de varios aún conectado, un nuevo no-admin puede seguir uniéndose (spec host-gate/sostiene-con-uno)', async () => {
    listParticipants.mockResolvedValue([{ identity: 'admin-remaining' } as ParticipantInfo]);
    db.adminLimit.mockResolvedValueOnce([{ id: 'identity-row-1' }]);

    const session = await service.join(room.code, { ...participant, sub: 'newcomer' });

    expect(session.token).toBeDefined();
  });

  it('el rol resuelto se persiste como roleAtIssue en la correlación de identidad (cierra la deuda de PR2)', async () => {
    db.roleLimit.mockResolvedValueOnce([{ role: 'administrador' }]);
    const adminParticipant = { ...participant, sub: 'admin-sub', userId: 'admin-1' };

    await service.join(room.code, adminParticipant);

    expect(db.identityValues).toHaveBeenCalledWith(
      expect.objectContaining({ roleAtIssue: 'administrador' }),
    );
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

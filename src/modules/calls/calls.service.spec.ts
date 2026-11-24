import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { Mock, MockInstance } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { RoomServiceClient, TokenVerifier, type ParticipantInfo } from 'livekit-server-sdk';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { DrizzleDb } from '../../db/drizzle.module';
import {
  callHistory,
  callParticipantIdentities,
  callSessionParticipants,
  roomMembers,
  type Room,
} from '../../db/schema';
import type { RoomParticipant } from '../auth/room-access.service';
import type { RoomResolverService } from '../rooms/room-resolver.service';
import { RoomsService } from '../rooms/rooms.service';
import { CallsService, type CallHistoryEntry } from './calls.service';

const participant: RoomParticipant = {
  kind: 'room-participant',
  sub: 'guest-1',
  roomId: 'room-1',
  roomCode: 'abc-defg-hij',
  name: 'Ana',
};
const room = { id: participant.roomId, code: participant.roomCode, isActive: true } as Room;
const secret = 'test-secret-at-least-32-characters-long';
const config = {
  LIVEKIT_URL: 'wss://media.example.com',
  LIVEKIT_API_URL: 'http://localhost:7880',
  LIVEKIT_API_KEY: 'test-key',
  LIVEKIT_API_SECRET: secret,
  MAX_ROOM_PARTICIPANTS: '6',
};

function createDbMock() {
  const insertValues = vi
    .fn<(values: { roomId: string; userId: string }) => Promise<void>>()
    .mockResolvedValue(undefined);
  const historyInsert = vi.fn().mockReturnValue({ values: insertValues });
  // La correlación de identidad usa un upsert: insert().values().onConflictDoUpdate().
  const identityOnConflictDoUpdate = vi
    .fn<(config: unknown) => Promise<void>>()
    .mockResolvedValue(undefined);
  const identityValues = vi
    .fn()
    .mockReturnValue({ onConflictDoUpdate: identityOnConflictDoUpdate });
  const identityInsert = vi.fn().mockReturnValue({ values: identityValues });
  // Un solo db.insert(table) real: distingue por la tabla recibida, como hace Drizzle.
  const insert = vi.fn((table: unknown) =>
    table === callParticipantIdentities ? identityInsert() : historyInsert(),
  );

  const page = { id: callHistory.id, roomId: callHistory.roomId, startedAt: callHistory.startedAt };
  const limit = vi.fn().mockReturnValue({ as: () => page });
  const pageOrderBy = vi.fn().mockReturnValue({ limit });
  const orderBy = vi.fn<() => Promise<CallHistoryEntry[]>>().mockResolvedValue([]);
  const leftJoinLateral = vi.fn().mockReturnValue({ orderBy });
  const innerJoin = vi.fn().mockReturnValue({ leftJoinLateral });
  // Both the archive existence check and notes authorization look for one history row.
  const notesLimit = vi.fn<() => Promise<object[]>>().mockResolvedValue([]);
  const notesWhere = vi.fn().mockReturnValue({ limit: notesLimit, orderBy: pageOrderBy });
  const historyFrom = vi.fn().mockReturnValue({ where: notesWhere });

  const sessionAlias = { id: callSessionParticipants.sessionId };
  const participantSessionsLimit = vi.fn().mockReturnValue({ as: () => sessionAlias });
  const participantSessionsOrderBy = vi.fn().mockReturnValue({ limit: participantSessionsLimit });
  const participantSessionsWhere = vi
    .fn<(condition: SQL) => unknown>()
    .mockReturnValue({ orderBy: participantSessionsOrderBy });
  const participantSessionsInnerJoin = vi
    .fn()
    .mockReturnValue({ where: participantSessionsWhere });
  const participantSessionsFrom = vi
    .fn()
    .mockReturnValue({ innerJoin: participantSessionsInnerJoin });

  // select({role}).from(roomMembers).where(...).limit(1) — resolveLocalRole().
  // Default: ninguna fila (invitado, o cuenta sin rol admin/colaborador
  // registrado todavía) para no asumir admin por accidente en los tests
  // que no son del gate.
  const roleLimit = vi.fn<() => Promise<{ role: string }[]>>().mockResolvedValue([]);
  const roleWhere = vi.fn().mockReturnValue({ limit: roleLimit });
  const roleFrom = vi.fn().mockReturnValue({ where: roleWhere });

  // select({id}).from(callParticipantIdentities).innerJoin(roomMembers).where(...).limit(1) —
  // cruce de identities conectadas contra el rol actual de administrador en
  // assertHostConnected(). Default: SÍ hay un admin conectado, para que los
  // tests de join() preexistentes (que no ejercitan el gate en sí) sigan
  // emitiendo token sin tener que mockear un anfitrión por separado.
  const adminLimit = vi
    .fn<() => Promise<{ id: string }[]>>()
    .mockResolvedValue([{ id: 'already-connected-admin-identity' }]);
  const adminWhere = vi.fn().mockReturnValue({ limit: adminLimit });
  const adminInnerJoin = vi.fn().mockReturnValue({ where: adminWhere });
  const adminFrom = vi.fn().mockReturnValue({ innerJoin: adminInnerJoin });

  const from = vi.fn((table: unknown) => {
    if (table === page) return { innerJoin };
    if (table === roomMembers) return roleFrom();
    if (table === callParticipantIdentities) return adminFrom();
    if (table === callSessionParticipants) return participantSessionsFrom();
    return historyFrom();
  });
  const select = vi.fn().mockReturnValue({ from });
  return {
    insert,
    insertValues,
    identityValues,
    identityOnConflictDoUpdate,
    select,
    from,
    innerJoin,
    notesWhere,
    notesLimit,
    orderBy,
    limit,
    roleLimit,
    adminLimit,
    participantSessionsWhere,
    participantSessionsLimit,
  };
}

describe('CallsService: LiveKit', () => {
  let rooms: { getByCodeOrThrow: Mock<RoomsService['getByCodeOrThrow']> };
  let resolver: { touchEntry: ReturnType<typeof vi.fn> };
  let createRoom: MockInstance<RoomServiceClient['createRoom']>;
  let db: ReturnType<typeof createDbMock>;
  let service: CallsService;
  beforeEach(() => {
    rooms = {
      getByCodeOrThrow: vi.fn<RoomsService['getByCodeOrThrow']>().mockResolvedValue(room),
    };
    resolver = { touchEntry: vi.fn().mockResolvedValue(undefined) };
    createRoom = vi
      .spyOn(RoomServiceClient.prototype, 'createRoom')
      .mockResolvedValue({} as Awaited<ReturnType<RoomServiceClient['createRoom']>>);
    // Gate de anfitrión (Fase 5): estos tests no son sobre el gate en sí,
    // así que por defecto se asume un anfitrión ya conectado (combinado con
    // el adminLimit por defecto de createDbMock) para que el invitado de
    // estos escenarios preexistentes pueda unirse sin tener que mockear la
    // presencia de un admin en cada test.
    vi
      .spyOn(RoomServiceClient.prototype, 'listParticipants')
      .mockResolvedValue([{ identity: 'already-connected-admin' } as ParticipantInfo]);
    db = createDbMock();
    service = new CallsService(
      rooms as unknown as RoomsService,
      new ConfigService(config),
      db as unknown as DrizzleDb,
      resolver as unknown as RoomResolverService,
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
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

  it('[D5 2.19] join() marca la entrada (touchEntry) -- es uno de los tres sitios de "entrada"', async () => {
    await service.join(room.code, participant);
    expect(resolver.touchEntry).toHaveBeenCalledWith(room.id);
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

  it('rechaza un pase emitido para otra sala, sin llegar a contactar a LiveKit (D4: por roomId, el código puede reciclarse)', async () => {
    rooms.getByCodeOrThrow.mockResolvedValue({ ...room, id: 'room-2', code: 'other-room' });
    await expect(service.join('other-room', participant)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(createRoom).not.toHaveBeenCalled();
  });

  it('[Flujo 2, design.md] un token de R1 presentado contra R2 tras reciclar el código se rechaza por roomId, no por coincidencia de código', async () => {
    // El código "abc-defg-hij" ahora resuelve a R2 (id distinto): el token
    // del participante sigue siendo el de R1. La coincidencia de CÓDIGO ya
    // no prueba nada -- solo el roomId importa.
    rooms.getByCodeOrThrow.mockResolvedValue({ ...room, id: 'room-2-recycled' });
    await expect(service.join(room.code, participant)).rejects.toThrow(
      'El acceso pertenece a otra sala',
    );
    expect(createRoom).not.toHaveBeenCalled();
  });

  it('rechaza una sala cerrada antes de contactar LiveKit (el 403 ahora lo lanza RoomsService/el resolver, no join())', async () => {
    rooms.getByCodeOrThrow.mockRejectedValue(new ForbiddenException('La sala está cerrada'));
    await expect(service.join(room.code, participant)).rejects.toThrow('La sala está cerrada');
    expect(createRoom).not.toHaveBeenCalled();
  });

  it('informa si falta configuración sin contactar al servicio', async () => {
    service = new CallsService(
      rooms as unknown as RoomsService,
      new ConfigService({}),
      db as unknown as DrizzleDb,
      resolver as unknown as RoomResolverService,
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
      resolver as unknown as RoomResolverService,
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
  let rooms: { getByCodeOrThrow: Mock<RoomsService['getByCodeOrThrow']> };
  let resolver: { touchEntry: ReturnType<typeof vi.fn> };
  let db: ReturnType<typeof createDbMock>;
  let service: CallsService;
  beforeEach(() => {
    rooms = {
      getByCodeOrThrow: vi.fn<RoomsService['getByCodeOrThrow']>().mockResolvedValue(room),
    };
    resolver = { touchEntry: vi.fn().mockResolvedValue(undefined) };
    vi
      .spyOn(RoomServiceClient.prototype, 'createRoom')
      .mockResolvedValue({} as Awaited<ReturnType<RoomServiceClient['createRoom']>>);
    // Ver el comentario equivalente en 'CallsService: LiveKit': estos tests
    // son sobre la correlación de identidad, no sobre el gate de admin en
    // sí, así que se asume un anfitrión ya conectado por defecto.
    vi
      .spyOn(RoomServiceClient.prototype, 'listParticipants')
      .mockResolvedValue([{ identity: 'already-connected-admin' } as ParticipantInfo]);
    db = createDbMock();
    service = new CallsService(
      rooms as unknown as RoomsService,
      new ConfigService(config),
      db as unknown as DrizzleDb,
      resolver as unknown as RoomResolverService,
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
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
  let rooms: { getByCodeOrThrow: Mock<RoomsService['getByCodeOrThrow']> };
  let resolver: { touchEntry: ReturnType<typeof vi.fn> };
  let db: ReturnType<typeof createDbMock>;
  let service: CallsService;
  let listParticipants: MockInstance<RoomServiceClient['listParticipants']>;

  beforeEach(() => {
    rooms = {
      getByCodeOrThrow: vi.fn<RoomsService['getByCodeOrThrow']>().mockResolvedValue(room),
    };
    resolver = { touchEntry: vi.fn().mockResolvedValue(undefined) };
    vi
      .spyOn(RoomServiceClient.prototype, 'createRoom')
      .mockResolvedValue({} as Awaited<ReturnType<RoomServiceClient['createRoom']>>);
    listParticipants = vi.spyOn(RoomServiceClient.prototype, 'listParticipants');
    db = createDbMock();
    service = new CallsService(
      rooms as unknown as RoomsService,
      new ConfigService(config),
      db as unknown as DrizzleDb,
      resolver as unknown as RoomResolverService,
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
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
  let rooms: {
    getByCodeOrThrow: Mock<RoomsService['getByCodeOrThrow']>;
    getRoomNotesById: Mock<RoomsService['getRoomNotesById']>;
  };
  let resolver: { touchEntry: ReturnType<typeof vi.fn> };
  let db: ReturnType<typeof createDbMock>;
  let service: CallsService;

  beforeEach(() => {
    rooms = {
      getByCodeOrThrow: vi.fn<RoomsService['getByCodeOrThrow']>().mockResolvedValue(room),
      getRoomNotesById: vi.fn<RoomsService['getRoomNotesById']>(),
    };
    resolver = { touchEntry: vi.fn().mockResolvedValue(undefined) };
    db = createDbMock();
    service = new CallsService(
      rooms as unknown as RoomsService,
      new ConfigService(config),
      db as unknown as DrizzleDb,
      resolver as unknown as RoomResolverService,
    );
  });

  describe('getRoomNotesForHistory (D4-C: un solo identificador autoriza y recupera)', () => {
    it('devuelve las notas de la sala por roomId, sin resolver ni volver a resolver un código', async () => {
      db.notesLimit.mockResolvedValue([{ roomId: 'room-1' }]);
      const notes = { roomId: 'room-1', content: 'hola', revision: 2, updatedAt: new Date() };
      rooms.getRoomNotesById.mockResolvedValue(notes);

      const result = await service.getRoomNotesForHistory('user-1', 'room-1');

      expect(result).toBe(notes);
      // Estructuralmente imposible de romper: no hay innerJoin a `rooms` ni
      // una segunda resolución de código -- la vulnerabilidad original
      // (calls.service.ts:344-353 con rooms.code) ya no puede reaparecer
      // porque getRoomNotesById toma el roomId ya autorizado, no un código.
      expect(db.innerJoin).not.toHaveBeenCalled();
      expect(rooms.getRoomNotesById).toHaveBeenCalledWith('room-1');
    });

    it('rechaza si el usuario nunca estuvo en esa sala (por roomId)', async () => {
      db.notesLimit.mockResolvedValue([]);

      await expect(service.getRoomNotesForHistory('user-1', 'room-1')).rejects.toThrow(
        'No tenés historial en esta sala',
      );
      expect(rooms.getRoomNotesById).not.toHaveBeenCalled();
    });
  });

  it('lista una página del historial y ofrece un cursor si hay más filas', async () => {
    const rows = Array.from({ length: 51 }, (_, index) => ({
      id: `entry-${index}`,
      roomId: 'room-1',
      roomCode: 'abc-defg-hij',
      roomName: 'Reunión 1',
      startedAt: new Date('2026-01-02'),
      sessionId: null,
    }));
    db.orderBy.mockResolvedValue(rows);
    db.notesLimit.mockResolvedValue([{ id: 'archived-entry' }]);

    await expect(service.listHistory('user-1')).resolves.toEqual({
      entries: rows.slice(0, 50),
      nextCursor: 'entry-49',
      hasArchived: true,
    });
    expect(db.orderBy).toHaveBeenCalled();
    expect(db.limit).toHaveBeenCalledWith(51);
  });

  it('correlaciona cada intento con el primer ingreso del usuario en la sala dentro de cinco minutos', async () => {
    await service.listHistory('user-1');

    const condition = db.participantSessionsWhere.mock.calls[0][0];
    const { sql, params } = new PgDialect().sqlToQuery(condition);
    expect(params).toEqual(['user-1']);
    expect(sql).toContain('"call_sessions"."room_id" = "call_history"."room_id"');
    expect(sql).toContain('"first_joined_at" >= "call_history"."started_at"');
    expect(sql).toContain(
      `"first_joined_at" <= "call_history"."started_at" + interval '5 minutes'`,
    );
    expect(db.participantSessionsLimit).toHaveBeenCalledWith(1);
  });

  it('devuelve intentos sin sesión y evita consultar la disponibilidad del archivo desde el archivo', async () => {
    const row = {
      id: 'entry-1',
      roomId: 'room-1',
      roomCode: 'abc-defg-hij',
      roomName: 'Reunión 1',
      startedAt: new Date('2026-01-05T10:00:00.000Z'),
      sessionId: null,
    };
    db.orderBy.mockResolvedValue([row]);

    await expect(service.listHistory('user-1', { view: 'archive' })).resolves.toEqual({
      entries: [row],
      nextCursor: null,
      hasArchived: false,
    });
    expect(db.notesLimit).not.toHaveBeenCalled();
  });
});

describe('CallsService: reportTrackState (mute/unmute reportado por el cliente)', () => {
  let rooms: { getByCodeOrThrow: Mock<RoomsService['getByCodeOrThrow']> };
  let resolver: { touchEntry: ReturnType<typeof vi.fn> };
  let service: CallsService;
  let listRooms: MockInstance<RoomServiceClient['listRooms']>;
  let onConflictDoNothing: Mock<() => Promise<void>>;
  let insertValues: Mock<
    (values: unknown) => { onConflictDoNothing: typeof onConflictDoNothing }
  >;
  let insert: Mock<(table: unknown) => { values: typeof insertValues }>;
  let db: { insert: typeof insert };

  beforeEach(() => {
    rooms = {
      getByCodeOrThrow: vi.fn<RoomsService['getByCodeOrThrow']>().mockResolvedValue(room),
    };
    resolver = { touchEntry: vi.fn().mockResolvedValue(undefined) };
    listRooms = vi
      .spyOn(RoomServiceClient.prototype, 'listRooms')
      .mockResolvedValue([{ sid: 'RM_live_sid' }] as Awaited<
        ReturnType<RoomServiceClient['listRooms']>
      >);
    onConflictDoNothing = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    insertValues = vi.fn().mockReturnValue({ onConflictDoNothing });
    insert = vi.fn().mockReturnValue({ values: insertValues });
    db = { insert };
    service = new CallsService(
      rooms as unknown as RoomsService,
      new ConfigService(config),
      db as unknown as DrizzleDb,
      resolver as unknown as RoomResolverService,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('inserta un evento track_unmuted con la identity del pase y el sid real de LiveKit', async () => {
    await service.reportTrackState(room.code, participant, { source: 'microphone', enabled: true });

    expect(listRooms).toHaveBeenCalledWith([room.code]);
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        livekitRoomSid: 'RM_live_sid',
        roomCode: room.code,
        eventType: 'track_unmuted',
        livekitIdentity: participant.sub,
        trackSource: 'microphone',
      }),
    );
  });

  it('enabled: false inserta track_muted', async () => {
    await service.reportTrackState(room.code, participant, { source: 'camera', enabled: false });

    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'track_muted', trackSource: 'camera' }),
    );
  });

  it('la sala ya no existe en LiveKit (la llamada ya terminó): no inserta nada, sin tirar', async () => {
    listRooms.mockResolvedValue([]);

    await expect(
      service.reportTrackState(room.code, participant, { source: 'microphone', enabled: true }),
    ).resolves.toBeUndefined();
    expect(insert).not.toHaveBeenCalled();
  });

  it('LiveKit no responde: no tira, es un reporte secundario best-effort', async () => {
    listRooms.mockRejectedValue(new Error('livekit unreachable'));

    await expect(
      service.reportTrackState(room.code, participant, { source: 'microphone', enabled: true }),
    ).resolves.toBeUndefined();
    expect(insert).not.toHaveBeenCalled();
  });

  it('el pase es de otra sala: rechaza en silencio, sin consultar LiveKit', async () => {
    await service.reportTrackState('otra-sala', participant, {
      source: 'microphone',
      enabled: true,
    });

    expect(listRooms).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });
});

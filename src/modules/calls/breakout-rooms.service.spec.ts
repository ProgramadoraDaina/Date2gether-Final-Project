import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RoomServiceClient, type ParticipantInfo } from 'livekit-server-sdk';
import type { DrizzleDb } from '../../db/drizzle.module';
import {
  callBreakoutOccupants,
  callBreakoutRooms,
  callParticipantIdentities,
  roomMembers,
  type CallBreakoutRoom,
} from '../../db/schema';
import { chain } from '../../test-support/fake-drizzle';
import type { RoomParticipant } from '../auth/room-access.service';
import type { RoomEventsService } from '../rooms/room-events.service';
import type { CallGroupResolverService } from './call-group-resolver.service';
import { BreakoutRoomsService } from './breakout-rooms.service';

const secret = 'test-secret-at-least-32-characters-long';
const config = {
  LIVEKIT_URL: 'wss://media.example.com',
  LIVEKIT_API_URL: 'http://localhost:7880',
  LIVEKIT_API_KEY: 'test-key',
  LIVEKIT_API_SECRET: secret,
  MAX_ROOM_PARTICIPANTS: '6',
  MAX_BREAKOUT_ROOMS: '3',
};

const roomId = 'room-1';
const roomCode = 'abc-defg-hij';

const admin: RoomParticipant = {
  kind: 'room-participant',
  sub: 'admin-sub',
  roomId,
  roomCode,
  name: 'Admin',
  userId: 'admin-user-1',
};
const guest: RoomParticipant = {
  kind: 'room-participant',
  sub: 'guest-sub',
  roomId,
  roomCode,
  name: 'Invitado',
};

function buildBreakoutRow(overrides: Partial<CallBreakoutRoom> = {}): CallBreakoutRoom {
  return {
    id: 'breakout-1',
    roomId,
    livekitRoomName: `${roomCode}::breakout-1`,
    parentLivekitRoomSid: 'RM_parent',
    label: 'Mini sala 1',
    leavePolicy: 'locked',
    autoCloseAt: null,
    closedAt: null,
    createdAt: new Date('2026-11-20T10:00:00Z'),
    ...overrides,
  };
}

function createDbMock() {
  // --- select: roomMembers (resolveRole) ---
  const roomMembersWhere = vi.fn().mockReturnValue(chain([] as { role: string }[]));
  const roomMembersFrom = vi.fn().mockReturnValue({ where: roomMembersWhere });

  // --- select: callBreakoutRooms (fetchOpenRows / getOpenRowOrThrow / close()'s lookup) ---
  const breakoutRoomsSelectWhere = vi.fn().mockReturnValue(chain([] as CallBreakoutRoom[]));
  const breakoutRoomsFrom = vi.fn().mockReturnValue({ where: breakoutRoomsSelectWhere });

  // --- select: callBreakoutOccupants (findOpenOccupantBy*/fetchOccupantsByBreakoutIds) ---
  const breakoutOccupantsSelectWhere = vi.fn().mockReturnValue(chain([] as unknown[]));
  const breakoutOccupantsFrom = vi.fn().mockReturnValue({ where: breakoutOccupantsSelectWhere });

  // --- select: callParticipantIdentities (moveIn: identity origen) ---
  const identitiesSelectWhere = vi.fn().mockReturnValue(chain([] as unknown[]));
  const identitiesSelectFrom = vi.fn().mockReturnValue({ where: identitiesSelectWhere });

  const from = vi.fn((table: unknown): unknown => {
    if (table === roomMembers) return roomMembersFrom();
    if (table === callBreakoutRooms) return breakoutRoomsFrom();
    if (table === callBreakoutOccupants) return breakoutOccupantsFrom();
    if (table === callParticipantIdentities) return identitiesSelectFrom();
    return chain([]);
  });
  const select = vi.fn().mockReturnValue({ from });

  // --- insert ---
  const breakoutRoomsInsertReturning = vi
    .fn<() => Promise<CallBreakoutRoom[]>>()
    .mockImplementation(() => Promise.resolve([buildBreakoutRow()]));
  const breakoutRoomsInsertValues = vi
    .fn()
    .mockReturnValue({ returning: breakoutRoomsInsertReturning });
  const breakoutOccupantsInsertValues = vi.fn().mockReturnValue(chain(undefined));
  const identitiesInsertValues = vi.fn().mockReturnValue(chain(undefined));
  const insert = vi.fn((table: unknown) => {
    if (table === callBreakoutRooms) return { values: breakoutRoomsInsertValues };
    if (table === callBreakoutOccupants) return { values: breakoutOccupantsInsertValues };
    if (table === callParticipantIdentities) return { values: identitiesInsertValues };
    return { values: vi.fn().mockReturnValue(chain(undefined)) };
  });

  // --- update ---
  const breakoutRoomsUpdateReturning = vi
    .fn<() => Promise<CallBreakoutRoom[]>>()
    .mockResolvedValue([buildBreakoutRow()]);
  const breakoutRoomsUpdateWhere = vi
    .fn()
    .mockReturnValue({ returning: breakoutRoomsUpdateReturning });
  const breakoutRoomsUpdateSet = vi.fn().mockReturnValue({ where: breakoutRoomsUpdateWhere });
  const breakoutOccupantsUpdateWhere = vi.fn().mockReturnValue(chain(undefined));
  const breakoutOccupantsUpdateSet = vi
    .fn()
    .mockReturnValue({ where: breakoutOccupantsUpdateWhere });
  const update = vi.fn((table: unknown) => {
    if (table === callBreakoutRooms) return { set: breakoutRoomsUpdateSet };
    if (table === callBreakoutOccupants) return { set: breakoutOccupantsUpdateSet };
    return { set: vi.fn().mockReturnValue(chain(undefined)) };
  });

  return {
    select,
    from,
    insert,
    update,
    roomMembersWhere,
    breakoutRoomsSelectWhere,
    breakoutOccupantsSelectWhere,
    identitiesSelectWhere,
    breakoutRoomsInsertValues,
    breakoutRoomsInsertReturning,
    breakoutOccupantsInsertValues,
    identitiesInsertValues,
    breakoutRoomsUpdateSet,
    breakoutRoomsUpdateWhere,
    breakoutRoomsUpdateReturning,
    breakoutOccupantsUpdateSet,
    breakoutOccupantsUpdateWhere,
  };
}

function createGroupResolverMock() {
  return {
    resolveCallGroupRoomNames: vi.fn().mockResolvedValue([roomCode]),
    resolveGroupAnchor: vi.fn(),
    findExpiredBreakouts: vi.fn().mockResolvedValue([]),
  };
}

// Puente hacia ChatGateway (D12, design.md): se verifica que el servicio
// emita la señal, no que ChatGateway la reciba (eso lo cubre
// chat.gateway.spec.ts).
function createRoomEventsMock() {
  return {
    emitBreakoutAssigned: vi.fn(),
    emitBreakoutClosed: vi.fn(),
  };
}

describe('BreakoutRoomsService', () => {
  let db: ReturnType<typeof createDbMock>;
  let groupResolver: ReturnType<typeof createGroupResolverMock>;
  let roomEvents: ReturnType<typeof createRoomEventsMock>;
  let service: BreakoutRoomsService;
  let createRoom: MockInstance<RoomServiceClient['createRoom']>;
  let listParticipants: MockInstance<RoomServiceClient['listParticipants']>;
  let removeParticipant: MockInstance<RoomServiceClient['removeParticipant']>;
  let deleteRoom: MockInstance<RoomServiceClient['deleteRoom']>;

  beforeEach(() => {
    db = createDbMock();
    groupResolver = createGroupResolverMock();
    roomEvents = createRoomEventsMock();
    service = new BreakoutRoomsService(
      new ConfigService(config),
      db as unknown as DrizzleDb,
      groupResolver as unknown as CallGroupResolverService,
      roomEvents as unknown as RoomEventsService,
    );
    vi.spyOn(RoomServiceClient.prototype, 'listRooms').mockResolvedValue([
      { sid: 'RM_parent', name: roomCode },
    ] as Awaited<ReturnType<RoomServiceClient['listRooms']>>);
    createRoom = vi
      .spyOn(RoomServiceClient.prototype, 'createRoom')
      .mockResolvedValue({} as Awaited<ReturnType<RoomServiceClient['createRoom']>>);
    listParticipants = vi
      .spyOn(RoomServiceClient.prototype, 'listParticipants')
      .mockResolvedValue([]);
    removeParticipant = vi
      .spyOn(RoomServiceClient.prototype, 'removeParticipant')
      .mockResolvedValue(undefined);
    deleteRoom = vi.spyOn(RoomServiceClient.prototype, 'deleteRoom').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function asAdmin() {
    db.roomMembersWhere.mockReturnValueOnce(chain([{ role: 'administrador' }]));
  }

  // --- 5.1: MAX_BREAKOUT_ROOMS fail-fast ------------------------------

  describe('5.1 — MAX_BREAKOUT_ROOMS fail-fast', () => {
    it('[5.1.1] no definido -> se usa 3 (el cuarto intento de creación rechaza con 409, no con 503)', async () => {
      const bare = new ConfigService({ ...config, MAX_BREAKOUT_ROOMS: undefined });
      service = new BreakoutRoomsService(
        bare,
        db as unknown as DrizzleDb,
        groupResolver as unknown as CallGroupResolverService,
        roomEvents as unknown as RoomEventsService,
      );
      asAdmin();
      db.breakoutRoomsSelectWhere.mockReturnValueOnce(
        chain([buildBreakoutRow(), buildBreakoutRow({ id: 'b2' }), buildBreakoutRow({ id: 'b3' })]),
      );

      await expect(service.create(roomId, roomCode, admin, {})).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it.each(['abc', '4', '-1'])(
      '[5.1.2] MAX_BREAKOUT_ROOMS=%s fuera de rango o no entero -> 503, sin crear ninguna fila',
      async (value) => {
        const bad = new ConfigService({ ...config, MAX_BREAKOUT_ROOMS: value });
        service = new BreakoutRoomsService(
          bad,
          db as unknown as DrizzleDb,
          groupResolver as unknown as CallGroupResolverService,
          roomEvents as unknown as RoomEventsService,
        );
        asAdmin();

        await expect(service.create(roomId, roomCode, admin, {})).rejects.toBeInstanceOf(
          ServiceUnavailableException,
        );
        expect(db.breakoutRoomsInsertValues).not.toHaveBeenCalled();
      },
    );

    it('[5.1.3] MAX_BREAKOUT_ROOMS=0 -> cualquier intento de creación se rechaza explícitamente', async () => {
      const zero = new ConfigService({ ...config, MAX_BREAKOUT_ROOMS: '0' });
      service = new BreakoutRoomsService(
        zero,
        db as unknown as DrizzleDb,
        groupResolver as unknown as CallGroupResolverService,
        roomEvents as unknown as RoomEventsService,
      );
      asAdmin();

      await expect(service.create(roomId, roomCode, admin, {})).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(db.breakoutRoomsInsertValues).not.toHaveBeenCalled();
    });
  });

  // --- 5.2: create() + slot/tope ---------------------------------------

  describe('5.2 — create()', () => {
    it('[5.2.1] crear dentro del tope: fila activa, createRoom invocado con el nombre del primer slot libre', async () => {
      asAdmin();
      db.breakoutRoomsSelectWhere.mockReturnValueOnce(chain([]));

      const view = await service.create(roomId, roomCode, admin, {});

      expect(view.livekitRoomName).toBe(`${roomCode}::breakout-1`);
      expect(createRoom).toHaveBeenCalledWith(
        expect.objectContaining({ name: `${roomCode}::breakout-1`, maxParticipants: 6 }),
      );
    });

    it('[5.2.2] crear en el tope exacto: 409 explícito, ninguna fila nueva', async () => {
      asAdmin();
      db.breakoutRoomsSelectWhere.mockReturnValueOnce(
        chain([
          buildBreakoutRow({ id: 'b1' }),
          buildBreakoutRow({ id: 'b2', livekitRoomName: `${roomCode}::breakout-2` }),
          buildBreakoutRow({ id: 'b3', livekitRoomName: `${roomCode}::breakout-3` }),
        ]),
      );

      await expect(service.create(roomId, roomCode, admin, {})).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(db.breakoutRoomsInsertValues).not.toHaveBeenCalled();
    });

    it('[5.2.3] solicitante no-administrador: 403, ninguna fila nueva', async () => {
      db.breakoutRoomsSelectWhere.mockReturnValueOnce(chain([]));

      await expect(service.create(roomId, roomCode, guest, {})).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(db.breakoutRoomsInsertValues).not.toHaveBeenCalled();
    });

    it('[5.2.4] carrera de slot (unique(livekit_room_name) violado): reintenta con N+1', async () => {
      asAdmin();
      db.breakoutRoomsSelectWhere.mockReturnValueOnce(chain([]));
      db.breakoutRoomsInsertReturning
        .mockRejectedValueOnce(new Error('duplicate key value violates unique constraint'))
        .mockResolvedValueOnce([buildBreakoutRow({ livekitRoomName: `${roomCode}::breakout-2` })]);

      const view = await service.create(roomId, roomCode, admin, {});

      expect(view.livekitRoomName).toBe(`${roomCode}::breakout-2`);
      expect(createRoom).toHaveBeenCalledTimes(1);
      expect(createRoom).toHaveBeenCalledWith(
        expect.objectContaining({ name: `${roomCode}::breakout-2` }),
      );
    });
  });

  // --- 5.3: política de salida -------------------------------------------

  describe('5.3 — política de salida', () => {
    it('[5.3.1] crear sin indicar política -> locked', async () => {
      asAdmin();
      db.breakoutRoomsSelectWhere.mockReturnValueOnce(chain([]));

      await service.create(roomId, roomCode, admin, {});

      expect(db.breakoutRoomsInsertValues).toHaveBeenCalledWith(
        expect.objectContaining({ leavePolicy: 'locked' }),
      );
    });

    it('[5.3.2] crear con free_return explícito -> persiste free_return', async () => {
      asAdmin();
      db.breakoutRoomsSelectWhere.mockReturnValueOnce(chain([]));

      await service.create(roomId, roomCode, admin, { leavePolicy: 'free_return' });

      expect(db.breakoutRoomsInsertValues).toHaveBeenCalledWith(
        expect.objectContaining({ leavePolicy: 'free_return' }),
      );
    });

    it('[5.3.3] updatePolicy de locked a free_return en una mini sala abierta', async () => {
      asAdmin();
      const row = buildBreakoutRow({ leavePolicy: 'locked' });
      db.breakoutRoomsSelectWhere.mockReturnValueOnce(chain([row]));
      db.breakoutRoomsUpdateReturning.mockResolvedValueOnce([
        { ...row, leavePolicy: 'free_return' },
      ]);

      const view = await service.updatePolicy(row.id, roomId, admin, {
        leavePolicy: 'free_return',
      });

      expect(view.leavePolicy).toBe('free_return');
      expect(db.breakoutRoomsUpdateSet).toHaveBeenCalledWith(
        expect.objectContaining({ leavePolicy: 'free_return' }),
      );
    });
  });

  // --- 5.4: moveIn() -------------------------------------------------------

  describe('5.4 — moveIn()', () => {
    const sourceIdentityRow = {
      roomId,
      userId: 'guest-user-1',
      displayName: 'Invitado',
      roleAtIssue: null,
    };

    it('[5.4.1] traslado válido con capacidad disponible: identity nueva distinta de sub, fila de correlación con mismo roomId/userId/displayName/roleAtIssue', async () => {
      asAdmin();
      db.breakoutRoomsSelectWhere.mockReturnValueOnce(chain([buildBreakoutRow()]));
      listParticipants.mockResolvedValueOnce([]);
      db.identitiesSelectWhere.mockReturnValueOnce(chain([sourceIdentityRow]));

      const result = await service.moveIn('breakout-1', roomId, admin, {
        livekitIdentity: 'guest-sub',
      });

      expect(result.targetIdentity).not.toBe('guest-sub');
      expect(db.identitiesInsertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          livekitIdentity: result.targetIdentity,
          roomId: sourceIdentityRow.roomId,
          userId: sourceIdentityRow.userId,
          displayName: sourceIdentityRow.displayName,
          roleAtIssue: sourceIdentityRow.roleAtIssue,
        }),
      );
    });

    it('[5.4.2] destino lleno: 409, ningún token/identity nueva', async () => {
      asAdmin();
      db.breakoutRoomsSelectWhere.mockReturnValueOnce(chain([buildBreakoutRow()]));
      listParticipants.mockResolvedValueOnce(
        Array.from({ length: 6 }, (_, i) => ({ identity: `p${i}` }) as ParticipantInfo),
      );

      await expect(
        service.moveIn('breakout-1', roomId, admin, { livekitIdentity: 'guest-sub' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(db.identitiesInsertValues).not.toHaveBeenCalled();
    });

    it('[5.4.3] solicitante no-administrador: 403, ninguna identity nueva', async () => {
      await expect(
        service.moveIn('breakout-1', roomId, guest, { livekitIdentity: 'other-sub' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(db.identitiesInsertValues).not.toHaveBeenCalled();
    });

    it('[5.4.4] destino de otro grupo (roomId distinto): 403', async () => {
      asAdmin();
      db.breakoutRoomsSelectWhere.mockReturnValueOnce(
        chain([buildBreakoutRow({ roomId: 'other-room' })]),
      );

      await expect(
        service.moveIn('breakout-1', roomId, admin, { livekitIdentity: 'guest-sub' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('[5.4.5] la fila de correlación (call_participant_identities) se escribe antes de removeParticipant (orden observable)', async () => {
      asAdmin();
      db.breakoutRoomsSelectWhere.mockReturnValueOnce(chain([buildBreakoutRow()]));
      listParticipants.mockResolvedValueOnce([]);
      db.identitiesSelectWhere.mockReturnValueOnce(chain([sourceIdentityRow]));

      const callOrder: string[] = [];
      db.identitiesInsertValues.mockImplementationOnce(() => {
        callOrder.push('insert-identity');
        return chain(undefined);
      });
      removeParticipant.mockImplementationOnce(() => {
        callOrder.push('removeParticipant');
        return Promise.resolve(undefined);
      });

      await service.moveIn('breakout-1', roomId, admin, { livekitIdentity: 'guest-sub' });

      expect(callOrder).toEqual(['insert-identity', 'removeParticipant']);
    });

    it('[5.4.7] dos traslados de la misma persona producen dos correlaciones distintas (identities distintas)', async () => {
      db.roomMembersWhere.mockReturnValue(chain([{ role: 'administrador' }]));
      db.breakoutRoomsSelectWhere.mockReturnValue(chain([buildBreakoutRow()]));
      listParticipants.mockResolvedValue([]);
      db.identitiesSelectWhere.mockReturnValue(chain([sourceIdentityRow]));

      const first = await service.moveIn('breakout-1', roomId, admin, {
        livekitIdentity: 'guest-sub',
      });
      const second = await service.moveIn('breakout-1', roomId, admin, {
        livekitIdentity: 'guest-sub',
      });

      expect(first.targetIdentity).not.toBe(second.targetIdentity);
    });
  });

  // --- 5.5: retorno a la sala principal -----------------------------------

  describe('5.5 — selfReturn()', () => {
    it('[5.5.1] administrador devuelve a un ocupante, cualquier política: marca returnedAt y desconecta de la mini sala', async () => {
      asAdmin();
      const row = buildBreakoutRow({ leavePolicy: 'locked' });
      db.breakoutRoomsSelectWhere.mockReturnValueOnce(chain([row]));
      db.breakoutOccupantsSelectWhere.mockReturnValueOnce(chain([{ id: 'occ-1' }]));

      await service.selfReturn(row.id, roomId, admin, 'occupant-identity');

      expect(db.breakoutOccupantsUpdateSet).toHaveBeenCalledWith(
        expect.objectContaining({ returnedAt: expect.any(Date) as unknown as Date }),
      );
      expect(removeParticipant).toHaveBeenCalledWith(row.livekitRoomName, 'occupant-identity');
    });

    it('[5.5.2] ocupante en free_return pide volver por cuenta propia: se cierra la asignación', async () => {
      const row = buildBreakoutRow({ leavePolicy: 'free_return' });
      db.breakoutRoomsSelectWhere.mockReturnValueOnce(chain([row]));
      db.breakoutOccupantsSelectWhere.mockReturnValueOnce(chain([{ id: 'occ-1' }]));

      await expect(service.selfReturn(row.id, roomId, guest)).resolves.toBeUndefined();
      expect(db.breakoutOccupantsUpdateSet).toHaveBeenCalledWith(
        expect.objectContaining({ returnedAt: expect.any(Date) as unknown as Date }),
      );
    });

    it('[5.5.3] ocupante en locked pide volver por cuenta propia: 403 BREAKOUT_RETURN_LOCKED, sin efecto', async () => {
      const row = buildBreakoutRow({ leavePolicy: 'locked' });
      db.breakoutRoomsSelectWhere.mockReturnValueOnce(chain([row]));
      db.breakoutOccupantsSelectWhere.mockReturnValueOnce(chain([{ id: 'occ-1' }]));

      const error = await service.selfReturn(row.id, roomId, guest).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).getResponse()).toMatchObject({
        code: 'BREAKOUT_RETURN_LOCKED',
      });
      expect(db.breakoutOccupantsUpdateSet).not.toHaveBeenCalled();
    });

    it('administrador sin indicar a quién devolver: 400 explícito', async () => {
      asAdmin();
      const row = buildBreakoutRow();
      db.breakoutRoomsSelectWhere.mockReturnValueOnce(chain([row]));

      await expect(service.selfReturn(row.id, roomId, admin)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  // --- 5.6: token de mini sala y listado ---------------------------------

  describe('5.6 — issueBreakoutToken() / list()', () => {
    it('[5.6.1] ocupante con asignación abierta: token válido para la mini sala', async () => {
      const row = buildBreakoutRow();
      db.breakoutRoomsSelectWhere.mockReturnValueOnce(chain([row]));
      db.breakoutOccupantsSelectWhere.mockReturnValueOnce(
        chain([{ id: 'occ-1', livekitIdentity: 'new-identity', displayName: 'Invitado' }]),
      );

      const result = await service.issueBreakoutToken(row.id, roomId, guest);

      expect(result.roomName).toBe(row.livekitRoomName);
      expect(result.token).toBeDefined();
    });

    it('[5.6.2] admin del grupo sin asignación: también emite token (monitoreo)', async () => {
      asAdmin();
      const row = buildBreakoutRow();
      db.breakoutRoomsSelectWhere.mockReturnValueOnce(chain([row]));
      db.breakoutOccupantsSelectWhere.mockReturnValueOnce(chain([]));

      const result = await service.issueBreakoutToken(row.id, roomId, admin);

      expect(result.token).toBeDefined();
    });

    it('[5.6.3] sin asignación y sin ser admin: 403', async () => {
      const row = buildBreakoutRow();
      db.breakoutRoomsSelectWhere.mockReturnValueOnce(chain([row]));
      db.breakoutOccupantsSelectWhere.mockReturnValueOnce(chain([]));

      await expect(service.issueBreakoutToken(row.id, roomId, guest)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('[5.6.5] list() devuelve las mini salas abiertas del room_id con sus ocupantes', async () => {
      const row = buildBreakoutRow();
      db.breakoutRoomsSelectWhere.mockReturnValueOnce(chain([row]));
      db.breakoutOccupantsSelectWhere.mockReturnValueOnce(
        chain([
          {
            breakoutRoomId: row.id,
            livekitIdentity: 'new-identity',
            displayName: 'Invitado',
            userId: null,
          },
        ]),
      );

      const views = await service.list(roomId, guest);

      expect(views).toHaveLength(1);
      expect(views[0].occupants).toEqual([
        { livekitIdentity: 'new-identity', displayName: 'Invitado', userId: null },
      ]);
    });
  });

  // --- 5.7: cierre manual, cascada, autoCloseAt, reconciliación ----------

  describe('5.7 — close() / closeAll() / closeGroupBreakouts() / reconcileGroup()', () => {
    it('[5.7.1] close() de una mini sala con ocupantes: cierre inmediato, ocupantes devueltos sin demora', async () => {
      asAdmin();
      const row = buildBreakoutRow();
      db.breakoutRoomsSelectWhere.mockReturnValueOnce(chain([row]));
      db.breakoutRoomsUpdateReturning.mockResolvedValueOnce([row]);

      await service.close(row.id, roomId, admin, 'manual');

      expect(db.breakoutOccupantsUpdateSet).toHaveBeenCalledWith(
        expect.objectContaining({ returnedAt: expect.any(Date) as unknown as Date }),
      );
      expect(deleteRoom).toHaveBeenCalledWith(row.livekitRoomName);
    });

    it('[5.7.2] close() de una mini sala ya cerrada: rechazo explícito, sin efecto duplicado', async () => {
      asAdmin();
      const row = buildBreakoutRow();
      db.breakoutRoomsSelectWhere.mockReturnValueOnce(chain([row]));
      db.breakoutRoomsUpdateReturning.mockResolvedValueOnce([]); // compare-and-set: 0 filas

      await expect(service.close(row.id, roomId, admin, 'manual')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(deleteRoom).not.toHaveBeenCalled();
    });

    it('[5.7.3] close() de un id inexistente: rechazo explícito', async () => {
      asAdmin();
      db.breakoutRoomsSelectWhere.mockReturnValueOnce(chain([]));

      await expect(service.close('no-existe', roomId, admin, 'manual')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('[5.7.5] closeGroupBreakouts: cierra todas las mini salas abiertas del grupo; deleteRoom tolerante a error', async () => {
      const rowA = buildBreakoutRow({ id: 'b1', livekitRoomName: `${roomCode}::breakout-1` });
      const rowB = buildBreakoutRow({ id: 'b2', livekitRoomName: `${roomCode}::breakout-2` });
      db.breakoutRoomsSelectWhere.mockReturnValueOnce(chain([rowA, rowB]));
      db.breakoutRoomsUpdateReturning.mockResolvedValueOnce([rowA]).mockResolvedValueOnce([rowB]);
      deleteRoom.mockRejectedValueOnce(new Error('room not found'));

      await expect(service.closeGroupBreakouts(roomId, roomCode)).resolves.toBeUndefined();
      expect(deleteRoom).toHaveBeenCalledTimes(2);
    });

    it('[5.7.5] cascada duplicada: cero deleteRoom nuevos (ya no quedan filas abiertas)', async () => {
      db.breakoutRoomsSelectWhere.mockReturnValueOnce(chain([])); // ya cerradas -> fetchOpenRows vacío

      await service.closeGroupBreakouts(roomId, roomCode);

      expect(deleteRoom).not.toHaveBeenCalled();
    });

    it('closeGroupBreakouts con roomId null: no-op, sin ninguna consulta', async () => {
      await service.closeGroupBreakouts(null, roomCode);
      expect(db.select).not.toHaveBeenCalled();
      expect(deleteRoom).not.toHaveBeenCalled();
    });

    it('[5.7.9] autoCloseAt definido y transcurrido: ocupantes devueltos sin acción del admin', async () => {
      vi.useFakeTimers();
      asAdmin();
      db.breakoutRoomsSelectWhere.mockReturnValueOnce(chain([]));
      const row = buildBreakoutRow({ autoCloseAt: new Date(Date.now() + 60_000) });
      db.breakoutRoomsInsertReturning.mockResolvedValueOnce([row]);
      db.breakoutRoomsUpdateReturning.mockResolvedValueOnce([row]);

      await service.create(roomId, roomCode, admin, { autoCloseInMinutes: 1 });
      await vi.advanceTimersByTimeAsync(60_000);

      expect(deleteRoom).toHaveBeenCalledWith(row.livekitRoomName);
    });

    it('[5.7.10] mini sala sin autoCloseAt: permanece abierta indefinidamente', async () => {
      vi.useFakeTimers();
      asAdmin();
      db.breakoutRoomsSelectWhere.mockReturnValueOnce(chain([]));
      const row = buildBreakoutRow({ autoCloseAt: null });
      db.breakoutRoomsInsertReturning.mockResolvedValueOnce([row]);

      await service.create(roomId, roomCode, admin, {});
      await vi.advanceTimersByTimeAsync(10 * 60_000);

      expect(deleteRoom).not.toHaveBeenCalled();
    });

    it('[5.7.12] reconcileGroup() cierra mini salas vencidas sin que haya corrido ningún timer', async () => {
      const expired = { id: 'breakout-expired', livekitRoomName: `${roomCode}::breakout-9` };
      groupResolver.findExpiredBreakouts.mockResolvedValueOnce([expired]);
      db.breakoutRoomsUpdateReturning.mockResolvedValueOnce([
        buildBreakoutRow({ id: expired.id, livekitRoomName: expired.livekitRoomName }),
      ]);

      await service.reconcileGroup(roomId);

      expect(deleteRoom).toHaveBeenCalledWith(expired.livekitRoomName);
    });

    it('[5.7.12] reconcileGroup() nunca tira, incluso si el resolver falla', async () => {
      groupResolver.findExpiredBreakouts.mockRejectedValueOnce(new Error('db unreachable'));

      await expect(service.reconcileGroup(roomId)).resolves.toBeUndefined();
    });
  });

  // --- Fase 6: señal breakout:assigned / breakout:closed hacia ChatGateway
  // vía RoomEventsService (D12, design.md) -----------------------------

  describe('6.8 — señal hacia ChatGateway vía RoomEventsService (D12)', () => {
    it('[6.8.1] moveIn() emite breakoutAssigned con el código PADRE, la identity VIEJA y los datos de la mini sala, antes de removeParticipant', async () => {
      asAdmin();
      const row = buildBreakoutRow();
      db.breakoutRoomsSelectWhere.mockReturnValueOnce(chain([row]));
      listParticipants.mockResolvedValueOnce([]);
      db.identitiesSelectWhere.mockReturnValueOnce(
        chain([{ roomId, userId: 'guest-user-1', displayName: 'Invitado', roleAtIssue: null }]),
      );
      const callOrder: string[] = [];
      roomEvents.emitBreakoutAssigned.mockImplementationOnce(() => {
        callOrder.push('emitBreakoutAssigned');
      });
      removeParticipant.mockImplementationOnce(() => {
        callOrder.push('removeParticipant');
        return Promise.resolve(undefined);
      });

      await service.moveIn(row.id, roomId, admin, { livekitIdentity: 'guest-sub' });

      expect(roomEvents.emitBreakoutAssigned).toHaveBeenCalledWith({
        roomCode,
        targetIdentity: 'guest-sub',
        breakoutId: row.id,
        label: row.label,
        leavePolicy: row.leavePolicy,
      });
      expect(callOrder).toEqual(['emitBreakoutAssigned', 'removeParticipant']);
    });

    it('[6.8.2] close() emite breakoutClosed con el código PADRE y el id de la mini sala', async () => {
      asAdmin();
      const row = buildBreakoutRow();
      db.breakoutRoomsSelectWhere.mockReturnValueOnce(chain([row]));
      db.breakoutRoomsUpdateReturning.mockResolvedValueOnce([row]);

      await service.close(row.id, roomId, admin, 'manual');

      expect(roomEvents.emitBreakoutClosed).toHaveBeenCalledWith({
        roomCode,
        breakoutId: row.id,
      });
    });

    it('[6.8.3] closeGroupBreakouts() emite breakoutClosed por cada mini sala cerrada de la cascada', async () => {
      const rowA = buildBreakoutRow({ id: 'b1', livekitRoomName: `${roomCode}::breakout-1` });
      const rowB = buildBreakoutRow({ id: 'b2', livekitRoomName: `${roomCode}::breakout-2` });
      db.breakoutRoomsSelectWhere.mockReturnValueOnce(chain([rowA, rowB]));
      db.breakoutRoomsUpdateReturning.mockResolvedValueOnce([rowA]).mockResolvedValueOnce([rowB]);

      await service.closeGroupBreakouts(roomId, roomCode);

      expect(roomEvents.emitBreakoutClosed).toHaveBeenCalledWith({ roomCode, breakoutId: 'b1' });
      expect(roomEvents.emitBreakoutClosed).toHaveBeenCalledWith({ roomCode, breakoutId: 'b2' });
    });

    it('[6.8.4] cierre ya reclamado (compare-and-set en 0 filas): no emite ninguna señal', async () => {
      asAdmin();
      const row = buildBreakoutRow();
      db.breakoutRoomsSelectWhere.mockReturnValueOnce(chain([row]));
      db.breakoutRoomsUpdateReturning.mockResolvedValueOnce([]);

      await expect(service.close(row.id, roomId, admin, 'manual')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(roomEvents.emitBreakoutClosed).not.toHaveBeenCalled();
    });
  });
});

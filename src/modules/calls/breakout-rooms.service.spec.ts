import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import {
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
import { BREAKOUT_RETURN_LOCKED_CODE, BreakoutRoomsService } from './breakout-rooms.service';

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
    joinPolicy: 'admin_only',
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
    emitBreakoutRemoval: vi.fn(),
    emitBreakoutBroadcast: vi.fn(),
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

  // --- Decisión 3 (design.md "joinPolicy: esquema, migración y
  // autorización", tasks.md 3.2): joinPolicy, separado y aislado de
  // leavePolicy. ---------------------------------------------------------

  describe('[3.2] joinPolicy', () => {
    it('crear sin indicar joinPolicy -> admin_only', async () => {
      asAdmin();
      db.breakoutRoomsSelectWhere.mockReturnValueOnce(chain([]));

      await service.create(roomId, roomCode, admin, {});

      expect(db.breakoutRoomsInsertValues).toHaveBeenCalledWith(
        expect.objectContaining({ joinPolicy: 'admin_only' }),
      );
    });

    it('crear con joinPolicy=open explícito -> persiste open', async () => {
      asAdmin();
      db.breakoutRoomsSelectWhere.mockReturnValueOnce(chain([]));

      await service.create(roomId, roomCode, admin, { joinPolicy: 'open' });

      expect(db.breakoutRoomsInsertValues).toHaveBeenCalledWith(
        expect.objectContaining({ joinPolicy: 'open' }),
      );
    });

    it('updatePolicy cambia joinPolicy de admin_only a open en una mini sala abierta', async () => {
      asAdmin();
      const row = buildBreakoutRow({ joinPolicy: 'admin_only' });
      db.breakoutRoomsSelectWhere.mockReturnValueOnce(chain([row]));
      db.breakoutRoomsUpdateReturning.mockResolvedValueOnce([{ ...row, joinPolicy: 'open' }]);

      const view = await service.updatePolicy(row.id, roomId, admin, { joinPolicy: 'open' });

      expect(view.joinPolicy).toBe('open');
      expect(db.breakoutRoomsUpdateSet).toHaveBeenCalledWith(
        expect.objectContaining({ joinPolicy: 'open' }),
      );
    });

    it('cambiar joinPolicy NO incluye leavePolicy en el patch de actualización (aislamiento)', async () => {
      asAdmin();
      const row = buildBreakoutRow({ leavePolicy: 'free_return', joinPolicy: 'admin_only' });
      db.breakoutRoomsSelectWhere.mockReturnValueOnce(chain([row]));
      db.breakoutRoomsUpdateReturning.mockResolvedValueOnce([{ ...row, joinPolicy: 'open' }]);

      await service.updatePolicy(row.id, roomId, admin, { joinPolicy: 'open' });

      expect(db.breakoutRoomsUpdateSet).toHaveBeenCalledWith(
        expect.not.objectContaining({ leavePolicy: expect.anything() }),
      );
    });

    it('cambiar leavePolicy NO incluye joinPolicy en el patch de actualización (aislamiento)', async () => {
      asAdmin();
      const row = buildBreakoutRow({ leavePolicy: 'locked', joinPolicy: 'open' });
      db.breakoutRoomsSelectWhere.mockReturnValueOnce(chain([row]));
      db.breakoutRoomsUpdateReturning.mockResolvedValueOnce([
        { ...row, leavePolicy: 'free_return' },
      ]);

      await service.updatePolicy(row.id, roomId, admin, { leavePolicy: 'free_return' });

      expect(db.breakoutRoomsUpdateSet).toHaveBeenCalledWith(
        expect.not.objectContaining({ joinPolicy: expect.anything() }),
      );
    });

    it('toView() proyecta joinPolicy en list()', async () => {
      const row = buildBreakoutRow({ joinPolicy: 'open' });
      db.breakoutRoomsSelectWhere.mockReturnValueOnce(chain([row]));

      const [view] = await service.list(roomId, admin);

      expect(view.joinPolicy).toBe('open');
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
      // Decisión 3 (design.md): moveIn ahora busca la fila de la mini sala
      // ANTES de resolver el rol (joinPolicy vive ahí) -- a diferencia del
      // código anterior a este cambio, que resolvía el rol primero y nunca
      // llegaba a tocar esta tabla para un no-admin. buildBreakoutRow()
      // default es joinPolicy='admin_only', así que un no-admin igual
      // queda rechazado.
      db.breakoutRoomsSelectWhere.mockReturnValueOnce(chain([buildBreakoutRow()]));

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

    // --- Decisión 3 (design.md "Autorización de moveIn", tasks.md 3.4):
    // matriz de autorización [spec: call-breakout-rooms "Traslado de un
    // participante hacia una mini sala" todos los escenarios]. -----------

    describe('[3.4] matriz de autorización', () => {
      it('administrador se traslada a sí misma bajo admin_only: autorizado', async () => {
        asAdmin();
        db.breakoutRoomsSelectWhere.mockReturnValueOnce(chain([buildBreakoutRow()]));
        listParticipants.mockResolvedValueOnce([]);
        db.identitiesSelectWhere.mockReturnValueOnce(chain([sourceIdentityRow]));

        const result = await service.moveIn('breakout-1', roomId, admin, {
          livekitIdentity: admin.sub,
        });

        expect(result.targetIdentity).not.toBe(admin.sub);
        expect(db.identitiesInsertValues).toHaveBeenCalled();
      });

      it('no-administrador se auto-traslada bajo admin_only: 403, sin consultar asignaciones del grupo', async () => {
        db.breakoutRoomsSelectWhere.mockReturnValueOnce(chain([buildBreakoutRow()]));

        await expect(
          service.moveIn('breakout-1', roomId, guest, { livekitIdentity: guest.sub }),
        ).rejects.toBeInstanceOf(ForbiddenException);
        expect(db.identitiesInsertValues).not.toHaveBeenCalled();
      });

      it('no-administrador se auto-traslada bajo open: autorizado', async () => {
        db.breakoutRoomsSelectWhere.mockReturnValueOnce(
          chain([buildBreakoutRow({ joinPolicy: 'open' })]),
        );
        listParticipants.mockResolvedValueOnce([]);
        db.identitiesSelectWhere.mockReturnValueOnce(chain([sourceIdentityRow]));

        const result = await service.moveIn('breakout-1', roomId, guest, {
          livekitIdentity: guest.sub,
        });

        expect(result.targetIdentity).not.toBe(guest.sub);
        expect(db.identitiesInsertValues).toHaveBeenCalled();
      });

      it('no-administrador bajo open intenta trasladar a un tercero: 403, ninguna identity nueva', async () => {
        db.breakoutRoomsSelectWhere.mockReturnValueOnce(
          chain([buildBreakoutRow({ joinPolicy: 'open' })]),
        );

        await expect(
          service.moveIn('breakout-1', roomId, guest, { livekitIdentity: 'third-party-sub' }),
        ).rejects.toBeInstanceOf(ForbiddenException);
        expect(db.identitiesInsertValues).not.toHaveBeenCalled();
      });

      // Bugfix (breakout-rooms-ux-fix, issue #2): joinPolicy='open' del
      // destino nunca debe ser una puerta trasera para escapar de un ORIGEN
      // con leavePolicy='locked' -- esa garantía existe específicamente
      // para que nadie salga sin que el admin actúe.
      it('[bugfix] no-administrador confinado en una mini sala locked intenta auto-trasladarse a una mini sala open: 403 BREAKOUT_RETURN_LOCKED, ninguna identity nueva', async () => {
        const destinationRow = buildBreakoutRow({ id: 'breakout-1', joinPolicy: 'open' });
        const lockedOriginRow = buildBreakoutRow({
          id: 'breakout-locked-origin',
          livekitRoomName: `${roomCode}::breakout-locked-origin`,
          leavePolicy: 'locked',
        });
        db.breakoutRoomsSelectWhere
          .mockReturnValueOnce(chain([destinationRow])) // getOpenRowOrThrow (destino)
          .mockReturnValueOnce(chain([lockedOriginRow])); // fetchOpenRows (autorización: assignment del actor)
        db.breakoutOccupantsSelectWhere.mockReturnValueOnce(
          chain([
            {
              id: 'occ-locked',
              livekitIdentity: 'locked-origin-identity',
              breakoutRoomId: lockedOriginRow.id,
            },
          ]),
        );

        const error = await service
          .moveIn(destinationRow.id, roomId, guest, { livekitIdentity: 'locked-origin-identity' })
          .catch((e: unknown) => e);

        expect(error).toBeInstanceOf(ForbiddenException);
        expect((error as ForbiddenException).getResponse()).toMatchObject({
          code: BREAKOUT_RETURN_LOCKED_CODE,
        });
        expect(db.identitiesInsertValues).not.toHaveBeenCalled();
      });

      it('[bugfix] no-administrador en una mini sala free_return se auto-traslada a una mini sala open: autorizado (sin regresión)', async () => {
        const destinationRow = buildBreakoutRow({ id: 'breakout-1', joinPolicy: 'open' });
        const freeReturnOriginRow = buildBreakoutRow({
          id: 'breakout-free-origin',
          livekitRoomName: `${roomCode}::breakout-free-origin`,
          leavePolicy: 'free_return',
        });
        db.breakoutRoomsSelectWhere
          .mockReturnValueOnce(chain([destinationRow])) // getOpenRowOrThrow (destino)
          .mockReturnValueOnce(chain([freeReturnOriginRow])); // fetchOpenRows (autorización)
        db.breakoutOccupantsSelectWhere.mockReturnValueOnce(
          chain([
            {
              id: 'occ-free',
              livekitIdentity: 'free-origin-identity',
              breakoutRoomId: freeReturnOriginRow.id,
            },
          ]),
        );
        listParticipants.mockResolvedValueOnce([]);
        db.identitiesSelectWhere.mockReturnValueOnce(chain([sourceIdentityRow]));

        const result = await service.moveIn(destinationRow.id, roomId, guest, {
          livekitIdentity: 'free-origin-identity',
        });

        expect(result.targetIdentity).toBeDefined();
        expect(db.identitiesInsertValues).toHaveBeenCalled();
      });
    });

    // --- Decisión 3 (tasks.md 3.5): salto mini-sala -> mini-sala hereda
    // sourceIdentity y cierra la asignación previa antes de insertar la
    // nueva. ---------------------------------------------------------------

    it('[3.5] salto de mini sala a mini sala: hereda sourceIdentity de la asignación abierta existente y la cierra antes de insertar la nueva', async () => {
      asAdmin();
      const destinationRow = buildBreakoutRow({ id: 'breakout-dest' });
      db.breakoutRoomsSelectWhere.mockReturnValueOnce(chain([destinationRow]));
      listParticipants.mockResolvedValueOnce([]);
      db.identitiesSelectWhere.mockReturnValueOnce(
        chain([{ roomId, userId: 'guest-user-1', displayName: 'Invitado', roleAtIssue: null }]),
      );
      // La identity que se traslada YA tiene una asignación abierta en otra
      // mini sala (el origen), con sourceIdentity = el sujeto estable real.
      db.breakoutOccupantsSelectWhere.mockReturnValueOnce(
        chain([{ id: 'occ-origin', sourceIdentity: 'original-sub' }]),
      );
      const callOrder: string[] = [];
      db.breakoutOccupantsUpdateWhere.mockImplementationOnce(() => {
        callOrder.push('close-previous');
        return chain(undefined);
      });
      db.breakoutOccupantsInsertValues.mockImplementationOnce(() => {
        callOrder.push('insert-new');
        return chain(undefined);
      });

      await service.moveIn(destinationRow.id, roomId, admin, {
        livekitIdentity: 'mini-room-a-identity',
      });

      expect(db.breakoutOccupantsUpdateSet).toHaveBeenCalledWith(
        expect.objectContaining({ returnedAt: expect.any(Date) as unknown as Date }),
      );
      expect(db.breakoutOccupantsInsertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceIdentity: 'original-sub',
          breakoutRoomId: destinationRow.id,
        }),
      );
      expect(callOrder).toEqual(['close-previous', 'insert-new']);
    });

    it('[3.5] traslado desde la principal (sin asignación previa): sourceIdentity es el livekitIdentity recibido, sin cerrar nada', async () => {
      asAdmin();
      db.breakoutRoomsSelectWhere.mockReturnValueOnce(chain([buildBreakoutRow()]));
      listParticipants.mockResolvedValueOnce([]);
      db.identitiesSelectWhere.mockReturnValueOnce(chain([sourceIdentityRow]));
      db.breakoutOccupantsSelectWhere.mockReturnValueOnce(chain([])); // sin asignación abierta

      await service.moveIn('breakout-1', roomId, admin, { livekitIdentity: 'guest-sub' });

      expect(db.breakoutOccupantsInsertValues).toHaveBeenCalledWith(
        expect.objectContaining({ sourceIdentity: 'guest-sub' }),
      );
      expect(db.breakoutOccupantsUpdateSet).not.toHaveBeenCalled();
    });

    // Bugfix (breakout-rooms-ux-fix, issue #1): el admin elige del dropdown
    // "Trasladar" (armado sobre presencia cruda de la principal) a alguien
    // que YA está en OTRA mini sala -- el cliente envía su sub ESTABLE
    // (identity de la dropdown), no la identity minteada bajo la que esa
    // persona está conectada actualmente en su mini sala de origen.
    it('[bugfix] traslado de alguien ya asignado a OTRA mini sala, enviando su sub estable (no su identity de mini sala actual): cierra la asignación previa, sin duplicar fila abierta, y remueve de la sala de ORIGEN con su identity real', async () => {
      asAdmin();
      const destinationRow = buildBreakoutRow({
        id: 'breakout-dest',
        livekitRoomName: `${roomCode}::breakout-2`,
      });
      const originRow = buildBreakoutRow({
        id: 'breakout-origin',
        livekitRoomName: `${roomCode}::breakout-3`,
      });
      db.breakoutRoomsSelectWhere
        .mockReturnValueOnce(chain([destinationRow])) // getOpenRowOrThrow (destino)
        .mockReturnValueOnce(chain([originRow])); // fetchOpenRows (resolución por sourceIdentity a través del grupo)
      listParticipants.mockResolvedValueOnce([]);
      db.identitiesSelectWhere.mockReturnValueOnce(chain([sourceIdentityRow]));
      db.breakoutOccupantsSelectWhere
        .mockReturnValueOnce(chain([])) // findOpenOccupantByLivekitIdentityAnyRoom('guest-sub') -- no coincide: la fila real tiene la identity minteada, no el sub
        .mockReturnValueOnce(
          chain([
            {
              id: 'occ-origin',
              livekitIdentity: 'origin-minted-identity',
              breakoutRoomId: originRow.id,
            },
          ]),
        ); // findOpenOccupantBySourceAcrossGroup('guest-sub') -- sí coincide por sourceIdentity

      await service.moveIn(destinationRow.id, roomId, admin, { livekitIdentity: 'guest-sub' });

      // Consecuencia 1 del bugfix: la asignación previa se cierra (sin ella,
      // quedarían dos filas abiertas para el mismo sourceIdentity).
      expect(db.breakoutOccupantsUpdateSet).toHaveBeenCalledWith(
        expect.objectContaining({ returnedAt: expect.any(Date) as unknown as Date }),
      );
      // La fila nueva hereda el sub estable como sourceIdentity (no se
      // duplica bajo ninguna otra identity).
      expect(db.breakoutOccupantsInsertValues).toHaveBeenCalledWith(
        expect.objectContaining({ sourceIdentity: 'guest-sub', breakoutRoomId: destinationRow.id }),
      );
      // Consecuencia 2: removeParticipant apunta a la sala de ORIGEN con la
      // identity REAL bajo la que esa persona está conectada ahí -- nunca a
      // la principal con el sub (eso tiraría o sería un no-op en LiveKit).
      expect(removeParticipant).toHaveBeenCalledWith(
        originRow.livekitRoomName,
        'origin-minted-identity',
      );
      expect(removeParticipant).not.toHaveBeenCalledWith(roomCode, 'guest-sub');
    });

    // --- Decisión 3 (tasks.md 3.6): guardia de capacidad con listRooms
    // primero -- sala ausente de LiveKit se trata como vacía, sin 500. ----

    it('[3.6] mini sala ausente de LiveKit (ya reapeada por emptyTimeout): se trata como vacía, no tira 500, el traslado continúa', async () => {
      asAdmin();
      const row = buildBreakoutRow();
      db.breakoutRoomsSelectWhere.mockReturnValueOnce(chain([row]));
      db.identitiesSelectWhere.mockReturnValueOnce(chain([sourceIdentityRow]));
      db.breakoutOccupantsSelectWhere.mockReturnValueOnce(chain([]));
      vi.spyOn(RoomServiceClient.prototype, 'listRooms').mockResolvedValueOnce([]);

      const result = await service.moveIn(row.id, roomId, admin, { livekitIdentity: 'guest-sub' });

      expect(result.targetIdentity).toBeDefined();
      expect(listParticipants).not.toHaveBeenCalled();
    });

    it('[3.6] mini sala existente en LiveKit pero llena: listRooms confirma existencia, listParticipants se consulta y el traslado se rechaza', async () => {
      asAdmin();
      const row = buildBreakoutRow();
      db.breakoutRoomsSelectWhere.mockReturnValueOnce(chain([row]));
      vi.spyOn(RoomServiceClient.prototype, 'listRooms').mockResolvedValueOnce([
        { sid: 'RM_breakout', name: row.livekitRoomName },
      ] as Awaited<ReturnType<RoomServiceClient['listRooms']>>);
      listParticipants.mockResolvedValueOnce(
        Array.from({ length: 6 }, (_, i) => ({ identity: `p${i}` }) as ParticipantInfo),
      );

      await expect(
        service.moveIn(row.id, roomId, admin, { livekitIdentity: 'guest-sub' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(db.identitiesInsertValues).not.toHaveBeenCalled();
    });
  });

  // --- 5.5: retorno a la sala principal -----------------------------------

  describe('5.5 — selfReturn()', () => {
    it('[5.5.1] administrador devuelve a un ocupante, cualquier política: marca returnedAt y desconecta de la mini sala', async () => {
      asAdmin();
      const row = buildBreakoutRow({ leavePolicy: 'locked' });
      db.breakoutRoomsSelectWhere.mockReturnValueOnce(chain([row]));
      db.breakoutOccupantsSelectWhere.mockReturnValueOnce(
        chain([{ id: 'occ-1', sourceIdentity: 'occupant-sub' }]),
      );

      await service.selfReturn(row.id, roomId, admin, 'occupant-identity');

      expect(db.breakoutOccupantsUpdateSet).toHaveBeenCalledWith(
        expect.objectContaining({ returnedAt: expect.any(Date) as unknown as Date }),
      );
      expect(removeParticipant).toHaveBeenCalledWith(row.livekitRoomName, 'occupant-identity');
    });

    // Decisión 2 (design.md "Señal de motivo de remoción", tasks.md 2.2):
    // findOpenOccupantByLivekitIdentity debe proyectar sourceIdentity --
    // sin eso, selfReturn no puede direccionar la señal de remoción al
    // socket correcto (el bug descubierto al diseñar esto, ver design.md).
    it('[2.2] findOpenOccupantByLivekitIdentity proyecta sourceIdentity además de id', async () => {
      asAdmin();
      const row = buildBreakoutRow();
      db.breakoutRoomsSelectWhere.mockReturnValueOnce(chain([row]));
      db.breakoutOccupantsSelectWhere.mockReturnValueOnce(
        chain([{ id: 'occ-1', sourceIdentity: 'occupant-sub' }]),
      );

      await service.selfReturn(row.id, roomId, admin, 'occupant-identity');

      expect(db.select).toHaveBeenCalledWith(
        expect.objectContaining({ sourceIdentity: callBreakoutOccupants.sourceIdentity }),
      );
    });

    it('[5.5.2] ocupante en free_return pide volver por cuenta propia: se cierra la asignación, emite BREAKOUT_FORCED_RETURN y desconecta de la mini sala', async () => {
      const row = buildBreakoutRow({ leavePolicy: 'free_return' });
      db.breakoutRoomsSelectWhere.mockReturnValueOnce(chain([row]));
      db.breakoutOccupantsSelectWhere.mockReturnValueOnce(
        chain([{ id: 'occ-1', livekitIdentity: 'guest-minted-identity', displayName: 'Invitado' }]),
      );

      await expect(service.selfReturn(row.id, roomId, guest)).resolves.toBeUndefined();
      expect(db.breakoutOccupantsUpdateSet).toHaveBeenCalledWith(
        expect.objectContaining({ returnedAt: expect.any(Date) as unknown as Date }),
      );
      expect(roomEvents.emitBreakoutRemoval).toHaveBeenCalledWith({
        roomCode,
        targetIdentity: guest.sub,
        reason: 'BREAKOUT_FORCED_RETURN',
      });
      expect(removeParticipant).toHaveBeenCalledWith(row.livekitRoomName, 'guest-minted-identity');
    });

    it('[5.5.3] ocupante en locked (joinPolicy admin_only) pide volver por cuenta propia: 403 BREAKOUT_RETURN_LOCKED, sin efecto', async () => {
      const row = buildBreakoutRow({ leavePolicy: 'locked', joinPolicy: 'admin_only' });
      db.breakoutRoomsSelectWhere.mockReturnValueOnce(chain([row]));
      db.breakoutOccupantsSelectWhere.mockReturnValueOnce(chain([{ id: 'occ-1' }]));

      const error = await service.selfReturn(row.id, roomId, guest).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).getResponse()).toMatchObject({
        code: 'BREAKOUT_RETURN_LOCKED',
      });
      expect(db.breakoutOccupantsUpdateSet).not.toHaveBeenCalled();
      expect(removeParticipant).not.toHaveBeenCalled();
    });

    it('[bugfix] ocupante no-admin en locked + joinPolicy open (se auto-unió) pide volver por cuenta propia: se permite, se cierra la asignación', async () => {
      const row = buildBreakoutRow({ leavePolicy: 'locked', joinPolicy: 'open' });
      db.breakoutRoomsSelectWhere.mockReturnValueOnce(chain([row]));
      db.breakoutOccupantsSelectWhere.mockReturnValueOnce(
        chain([{ id: 'occ-1', livekitIdentity: 'guest-minted-identity', displayName: 'Invitado' }]),
      );

      await expect(service.selfReturn(row.id, roomId, guest)).resolves.toBeUndefined();
      expect(db.breakoutOccupantsUpdateSet).toHaveBeenCalledWith(
        expect.objectContaining({ returnedAt: expect.any(Date) as unknown as Date }),
      );
      expect(roomEvents.emitBreakoutRemoval).toHaveBeenCalledWith({
        roomCode,
        targetIdentity: guest.sub,
        reason: 'BREAKOUT_FORCED_RETURN',
      });
      expect(removeParticipant).toHaveBeenCalledWith(row.livekitRoomName, 'guest-minted-identity');
    });

    // Bugfix (confirmado por product owner, deploy 2026-11-23): el self-join
    // de admin habilitó por primera vez que una administradora termine como
    // OCUPANTE de su propia mini sala -- al pedir "Volver" sin
    // targetLivekitIdentity (así lo hace siempre el self-return del
    // cliente, ver breakouts.ts), el código previo asumía rol admin =
    // devolviendo a un tercero y exigía targetLivekitIdentity con 400. El
    // propio doc comment de la función ya declaraba que admin está exenta
    // del chequeo de leavePolicy -- esto implementa esa exención también
    // para el camino de autorretorno.
    it('[bugfix] administradora que se auto-unió a su propia mini sala puede autodevolverse sin targetLivekitIdentity, en cualquier leavePolicy (locked)', async () => {
      asAdmin();
      const row = buildBreakoutRow({ leavePolicy: 'locked' });
      db.breakoutRoomsSelectWhere.mockReturnValueOnce(chain([row]));
      db.breakoutOccupantsSelectWhere.mockReturnValueOnce(
        chain([
          { id: 'occ-admin', livekitIdentity: 'admin-minted-identity', displayName: 'Admin' },
        ]),
      );

      await expect(service.selfReturn(row.id, roomId, admin)).resolves.toBeUndefined();
      expect(db.breakoutOccupantsUpdateSet).toHaveBeenCalledWith(
        expect.objectContaining({ returnedAt: expect.any(Date) as unknown as Date }),
      );
      expect(roomEvents.emitBreakoutRemoval).toHaveBeenCalledWith({
        roomCode,
        targetIdentity: admin.sub,
        reason: 'BREAKOUT_FORCED_RETURN',
      });
      expect(removeParticipant).toHaveBeenCalledWith(row.livekitRoomName, 'admin-minted-identity');
    });

    it('[bugfix] administradora que se auto-unió a su propia mini sala puede autodevolverse sin targetLivekitIdentity (free_return, sin regresión)', async () => {
      asAdmin();
      const row = buildBreakoutRow({ leavePolicy: 'free_return' });
      db.breakoutRoomsSelectWhere.mockReturnValueOnce(chain([row]));
      db.breakoutOccupantsSelectWhere.mockReturnValueOnce(
        chain([
          { id: 'occ-admin', livekitIdentity: 'admin-minted-identity', displayName: 'Admin' },
        ]),
      );

      await expect(service.selfReturn(row.id, roomId, admin)).resolves.toBeUndefined();
      expect(removeParticipant).toHaveBeenCalledWith(row.livekitRoomName, 'admin-minted-identity');
    });

    it('administrador sin indicar a quién devolver y sin asignación propia abierta: 403 (no 400 -- ya no asume que siempre es un tercero)', async () => {
      asAdmin();
      const row = buildBreakoutRow();
      db.breakoutRoomsSelectWhere.mockReturnValueOnce(chain([row]));
      db.breakoutOccupantsSelectWhere.mockReturnValueOnce(chain([]));

      await expect(service.selfReturn(row.id, roomId, admin)).rejects.toBeInstanceOf(
        ForbiddenException,
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

    it('el token de la mini sala lleva la identity de la principal en la metadata (para mostrar el mismo avatar)', async () => {
      const row = buildBreakoutRow();
      db.breakoutRoomsSelectWhere.mockReturnValueOnce(chain([row]));
      db.breakoutOccupantsSelectWhere.mockReturnValueOnce(
        chain([{ id: 'occ-1', livekitIdentity: 'new-identity', displayName: 'Invitado' }]),
      );

      const result = await service.issueBreakoutToken(row.id, roomId, guest);

      const payload = JSON.parse(
        Buffer.from(result.token.split('.')[1], 'base64url').toString('utf8'),
      ) as { sub: string; metadata: string };
      expect(payload.sub).toBe('new-identity');
      expect(JSON.parse(payload.metadata)).toEqual({ sourceIdentity: guest.sub });
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

    it('[5.6.5] list() (administrador) devuelve las mini salas abiertas del room_id con sus ocupantes', async () => {
      asAdmin();
      const row = buildBreakoutRow();
      db.breakoutRoomsSelectWhere.mockReturnValueOnce(chain([row]));
      db.breakoutOccupantsSelectWhere.mockReturnValueOnce(
        chain([
          {
            breakoutRoomId: row.id,
            livekitIdentity: 'new-identity',
            sourceIdentity: 'guest-sub',
            displayName: 'Invitado',
            userId: null,
          },
        ]),
      );

      const views = await service.list(roomId, admin);

      expect(views).toHaveLength(1);
      expect(views[0]).toMatchObject({
        livekitRoomName: row.livekitRoomName,
        occupants: [
          {
            livekitIdentity: 'new-identity',
            sourceIdentity: 'guest-sub',
            displayName: 'Invitado',
            userId: null,
          },
        ],
      });
    });
  });

  // --- Decisión 4 (design.md "Proyección de list por rol", tasks.md
  // 4.1/4.2): list() discrimina por rol -- admin recibe el roster completo
  // (incluido sourceIdentity); no-admin recibe solo ocupación agregada, sin
  // livekitRoomName ni identidad de ningún ocupante. [spec:
  // call-breakout-rooms "Proyección de roster por rol al listar mini
  // salas"] -------------------------------------------------------------

  describe('[4.1] list(): proyección por rol', () => {
    function occupantRow(overrides: Partial<Record<string, unknown>> = {}) {
      return {
        breakoutRoomId: 'breakout-1',
        livekitIdentity: 'mini-room-identity-1',
        sourceIdentity: 'guest-sub',
        displayName: 'Invitado',
        userId: null,
        ...overrides,
      };
    }

    it('administrador recibe el roster completo con sourceIdentity por cada mini sala', async () => {
      asAdmin();
      const row = buildBreakoutRow();
      db.breakoutRoomsSelectWhere.mockReturnValueOnce(chain([row]));
      db.breakoutOccupantsSelectWhere.mockReturnValueOnce(chain([occupantRow()]));

      const [view] = await service.list(roomId, admin);

      expect(view).toMatchObject({
        id: row.id,
        livekitRoomName: row.livekitRoomName,
        label: row.label,
        leavePolicy: row.leavePolicy,
        joinPolicy: row.joinPolicy,
        autoCloseAt: row.autoCloseAt,
        occupants: [
          {
            livekitIdentity: 'mini-room-identity-1',
            sourceIdentity: 'guest-sub',
            displayName: 'Invitado',
            userId: null,
          },
        ],
      });
      expect(view).not.toHaveProperty('occupantCount');
      expect(view).not.toHaveProperty('selfAssigned');
    });

    it('no-administrador recibe solo etiqueta + cantidad de ocupantes, sin livekitRoomName ni identidad de ningún ocupante', async () => {
      const row = buildBreakoutRow();
      db.breakoutRoomsSelectWhere.mockReturnValueOnce(chain([row]));
      db.breakoutOccupantsSelectWhere.mockReturnValueOnce(
        chain([
          occupantRow({ sourceIdentity: 'other-sub' }),
          occupantRow({ sourceIdentity: 'yet-another-sub' }),
        ]),
      );

      const [view] = await service.list(roomId, guest);

      expect(view).toEqual({
        id: row.id,
        label: row.label,
        leavePolicy: row.leavePolicy,
        joinPolicy: row.joinPolicy,
        autoCloseAt: row.autoCloseAt,
        occupantCount: 2,
        selfAssigned: false,
      });
      expect(view).not.toHaveProperty('livekitRoomName');
      expect(view).not.toHaveProperty('occupants');
    });

    it('no-administrador con asignación abierta en esa mini sala: selfAssigned=true', async () => {
      const row = buildBreakoutRow();
      db.breakoutRoomsSelectWhere.mockReturnValueOnce(chain([row]));
      db.breakoutOccupantsSelectWhere.mockReturnValueOnce(
        chain([occupantRow({ sourceIdentity: guest.sub })]),
      );

      const [view] = await service.list(roomId, guest);

      expect(view).toMatchObject({ occupantCount: 1, selfAssigned: true });
    });

    it('mini sala sin ocupantes: occupantCount=0, selfAssigned=false', async () => {
      const row = buildBreakoutRow();
      db.breakoutRoomsSelectWhere.mockReturnValueOnce(chain([row]));
      db.breakoutOccupantsSelectWhere.mockReturnValueOnce(chain([]));

      const [view] = await service.list(roomId, guest);

      expect(view).toMatchObject({ occupantCount: 0, selfAssigned: false });
    });

    it('sin mini salas abiertas: lista vacía para cualquier rol', async () => {
      db.breakoutRoomsSelectWhere.mockReturnValueOnce(chain([]));

      await expect(service.list(roomId, guest)).resolves.toEqual([]);
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
        closesAt: null,
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

    // Decisión 2 (design.md "Señal de motivo de remoción", tasks.md 2.5):
    // moveIn y selfReturn (camino admin) emiten la señal explícita de
    // motivo ANTES de removeParticipant -- mismo orden que ya usa
    // emitBreakoutAssigned (D12).

    it('[2.5] moveIn() emite breakout:removal con motivo BREAKOUT_MOVE_IN antes de removeParticipant', async () => {
      asAdmin();
      const row = buildBreakoutRow();
      db.breakoutRoomsSelectWhere.mockReturnValueOnce(chain([row]));
      listParticipants.mockResolvedValueOnce([]);
      db.identitiesSelectWhere.mockReturnValueOnce(
        chain([{ roomId, userId: 'guest-user-1', displayName: 'Invitado', roleAtIssue: null }]),
      );
      const callOrder: string[] = [];
      roomEvents.emitBreakoutRemoval.mockImplementationOnce(() => {
        callOrder.push('emitBreakoutRemoval');
      });
      removeParticipant.mockImplementationOnce(() => {
        callOrder.push('removeParticipant');
        return Promise.resolve(undefined);
      });

      await service.moveIn(row.id, roomId, admin, { livekitIdentity: 'guest-sub' });

      expect(roomEvents.emitBreakoutRemoval).toHaveBeenCalledWith({
        roomCode,
        targetIdentity: 'guest-sub',
        reason: 'BREAKOUT_MOVE_IN',
      });
      expect(callOrder).toEqual(['emitBreakoutRemoval', 'removeParticipant']);
    });

    // Bugfix (breakout-rooms-ux-fix, Judgment Day Round 2): salto
    // mini-sala -> mini-sala auto-iniciado bajo joinPolicy=open -- el
    // cliente envía su identity MINTEADA actual (de la mini sala de
    // origen) como target.livekitIdentity (así pasa la autorización de
    // "self move", ver [3.4]), pero ChatGateway.emitToParticipant solo
    // resuelve sockets por participantId === sub ESTABLE. Si las señales
    // seguían direccionadas por target.livekitIdentity, nunca llegaban al
    // socket real de quien se traslada.
    it('[bugfix] moveIn() self-move mini-sala -> mini-sala bajo joinPolicy=open: ambas señales usan el sourceIdentity estable, no la identity minteada enviada como target', async () => {
      const destinationRow = buildBreakoutRow({
        id: 'breakout-dest',
        livekitRoomName: `${roomCode}::breakout-2`,
        joinPolicy: 'open',
      });
      const originRow = buildBreakoutRow({
        id: 'breakout-origin',
        livekitRoomName: `${roomCode}::breakout-3`,
        leavePolicy: 'free_return',
      });
      db.breakoutRoomsSelectWhere
        .mockReturnValueOnce(chain([destinationRow])) // getOpenRowOrThrow (destino)
        .mockReturnValueOnce(chain([originRow])) // fetchOpenRows (autorización: self-move)
        .mockReturnValueOnce(chain([{ livekitRoomName: originRow.livekitRoomName }])); // getBreakoutRoomNameById
      db.breakoutOccupantsSelectWhere
        .mockReturnValueOnce(
          chain([
            {
              id: 'occ-origin',
              livekitIdentity: 'origin-minted-identity',
              breakoutRoomId: originRow.id,
            },
          ]),
        ) // findOpenOccupantBySourceAcrossGroup(actor.sub) -- resuelve actorGroupIdentity
        .mockReturnValueOnce(
          chain([{ id: 'occ-origin', sourceIdentity: guest.sub, breakoutRoomId: originRow.id }]),
        ); // findOpenOccupantByLivekitIdentityAnyRoom(target.livekitIdentity)
      db.identitiesSelectWhere.mockReturnValueOnce(
        chain([{ roomId, userId: 'guest-user-1', displayName: 'Invitado', roleAtIssue: null }]),
      );
      listParticipants.mockResolvedValueOnce([]);

      await service.moveIn(destinationRow.id, roomId, guest, {
        livekitIdentity: 'origin-minted-identity',
      });

      expect(roomEvents.emitBreakoutAssigned).toHaveBeenCalledWith(
        expect.objectContaining({ targetIdentity: guest.sub }),
      );
      expect(roomEvents.emitBreakoutRemoval).toHaveBeenCalledWith(
        expect.objectContaining({ targetIdentity: guest.sub }),
      );
      expect(roomEvents.emitBreakoutAssigned).not.toHaveBeenCalledWith(
        expect.objectContaining({ targetIdentity: 'origin-minted-identity' }),
      );
      expect(roomEvents.emitBreakoutRemoval).not.toHaveBeenCalledWith(
        expect.objectContaining({ targetIdentity: 'origin-minted-identity' }),
      );
    });

    it('[2.5] selfReturn() admin emite breakout:removal con motivo BREAKOUT_FORCED_RETURN direccionado a occupant.sourceIdentity (no al identity de mini sala), antes de removeParticipant', async () => {
      asAdmin();
      const row = buildBreakoutRow();
      db.breakoutRoomsSelectWhere.mockReturnValueOnce(chain([row]));
      db.breakoutOccupantsSelectWhere.mockReturnValueOnce(
        chain([{ id: 'occ-1', sourceIdentity: 'occupant-sub' }]),
      );
      const callOrder: string[] = [];
      roomEvents.emitBreakoutRemoval.mockImplementationOnce(() => {
        callOrder.push('emitBreakoutRemoval');
      });
      removeParticipant.mockImplementationOnce(() => {
        callOrder.push('removeParticipant');
        return Promise.resolve(undefined);
      });

      await service.selfReturn(row.id, roomId, admin, 'mini-room-identity');

      expect(roomEvents.emitBreakoutRemoval).toHaveBeenCalledWith({
        roomCode,
        targetIdentity: 'occupant-sub',
        reason: 'BREAKOUT_FORCED_RETURN',
      });
      expect(callOrder).toEqual(['emitBreakoutRemoval', 'removeParticipant']);
    });
  });

  describe('llamar de vuelta y avisos de idas y vueltas', () => {
    it('recall() programa el cierre solo de las salas elegidas, avisa la cuenta regresiva y las cierra al vencer', async () => {
      vi.useFakeTimers({ now: new Date('2026-11-24T20:00:00Z') });
      asAdmin();
      const rowA = buildBreakoutRow({ id: 'b1', livekitRoomName: `${roomCode}::breakout-1` });
      const rowB = buildBreakoutRow({ id: 'b2', livekitRoomName: `${roomCode}::breakout-2` });
      const closesAt = new Date('2026-11-24T20:00:30Z');
      db.breakoutRoomsSelectWhere.mockReturnValueOnce(chain([rowA, rowB]));
      db.breakoutRoomsUpdateReturning
        .mockResolvedValueOnce([{ ...rowA, autoCloseAt: closesAt }])
        .mockResolvedValueOnce([{ ...rowA, autoCloseAt: closesAt }]);

      const result = await service.recall(roomId, admin, { breakoutIds: ['b1'], inSeconds: 30 });

      expect(result.closesAt).toEqual(closesAt);
      expect(db.breakoutRoomsUpdateSet).toHaveBeenCalledWith({ autoCloseAt: closesAt });
      expect(roomEvents.emitBreakoutBroadcast).toHaveBeenCalledWith({
        roomCode,
        event: 'breakout:closing',
        payload: { breakoutId: 'b1', closesAt: closesAt.toISOString() },
      });
      expect(deleteRoom).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(30_000);

      expect(deleteRoom).toHaveBeenCalledTimes(1);
      expect(deleteRoom).toHaveBeenCalledWith(rowA.livekitRoomName);
      expect(roomEvents.emitBreakoutClosed).toHaveBeenCalledWith({ roomCode, breakoutId: 'b1' });
    });

    it('recall() de alguien que no es administrador: 403 y nada se programa', async () => {
      await expect(service.recall(roomId, guest, { inSeconds: 30 })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(db.breakoutRoomsUpdateSet).not.toHaveBeenCalled();
      expect(roomEvents.emitBreakoutBroadcast).not.toHaveBeenCalled();
    });

    it('moveIn() avisa a la sala que la persona se fue a la mini sala', async () => {
      asAdmin();
      const row = buildBreakoutRow({ label: 'Sala 2' });
      db.breakoutRoomsSelectWhere.mockReturnValueOnce(chain([row]));
      db.identitiesSelectWhere.mockReturnValueOnce(
        chain([{ roomId, userId: null, displayName: 'Joni', roleAtIssue: null }]),
      );

      await service.moveIn(row.id, roomId, admin, { livekitIdentity: 'guest-sub' });

      expect(roomEvents.emitBreakoutBroadcast).toHaveBeenCalledWith({
        roomCode,
        event: 'breakout:presence',
        payload: { kind: 'moved', names: ['Joni'], label: 'Sala 2' },
      });
    });

    it('cerrar una mini sala con ocupantes avisa a la sala quiénes volvieron', async () => {
      asAdmin();
      const row = buildBreakoutRow({ label: 'Sala 1' });
      db.breakoutRoomsSelectWhere.mockReturnValueOnce(chain([row]));
      db.breakoutRoomsUpdateReturning.mockResolvedValueOnce([row]);
      db.breakoutOccupantsSelectWhere.mockReturnValueOnce(
        chain([{ displayName: 'Gabi' }, { displayName: 'Daina' }]),
      );

      await service.close(row.id, roomId, admin, 'manual');

      expect(roomEvents.emitBreakoutBroadcast).toHaveBeenCalledWith({
        roomCode,
        event: 'breakout:presence',
        payload: { kind: 'returned', names: ['Gabi', 'Daina'], label: 'Sala 1' },
      });
    });

    it('devolver a un ocupante avisa a la sala que volvió', async () => {
      asAdmin();
      const row = buildBreakoutRow({ label: 'Sala 3' });
      db.breakoutRoomsSelectWhere.mockReturnValueOnce(chain([row]));
      db.breakoutOccupantsSelectWhere.mockReturnValueOnce(
        chain([{ id: 'occ-1', sourceIdentity: 'occupant-sub', displayName: 'Mati' }]),
      );

      await service.selfReturn(row.id, roomId, admin, 'mini-room-identity');

      expect(roomEvents.emitBreakoutBroadcast).toHaveBeenCalledWith({
        roomCode,
        event: 'breakout:presence',
        payload: { kind: 'returned', names: ['Mati'], label: 'Sala 3' },
      });
    });
  });
});

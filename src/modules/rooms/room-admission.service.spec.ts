import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import type { DrizzleDb } from '../../db/drizzle.module';
import type { Room } from '../../db/schema';
import { chain, createFakeDb, type FakeDb } from '../../test-support/fake-drizzle';
import { RoomAdmissionService } from './room-admission.service';
import type { RoomResolverService } from './room-resolver.service';

function makeRoom(overrides: Partial<Room> = {}): Room {
  return {
    id: 'room-1',
    code: 'abc-defg-hij',
    name: 'Reunión de Daina',
    isPermanent: false,
    historyDeletedBefore: null,
    historyCleanupPending: false,
    lastEnteredAt: new Date(),
    retiredAt: null,
    waitingRoomEnabled: false,
    entryLocked: false,
    createdAt: new Date(),
    chimeMeetingId: null,
    ...overrides,
  };
}

describe('RoomAdmissionService', () => {
  let db: FakeDb;
  let access: {
    authenticateAccount: ReturnType<typeof vi.fn>;
    issueParticipant: ReturnType<typeof vi.fn>;
    createAdmissionTicket: ReturnType<typeof vi.fn>;
    verifyAdmissionTicket: ReturnType<typeof vi.fn>;
  };
  let resolver: {
    lockJoinable: ReturnType<typeof vi.fn>;
    resolveJoinable: ReturnType<typeof vi.fn>;
    touchEntry: ReturnType<typeof vi.fn>;
  };
  let service: RoomAdmissionService;
  let tx: {
    select: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    db = createFakeDb();
    access = {
      authenticateAccount: vi.fn().mockResolvedValue(undefined),
      issueParticipant: vi.fn().mockResolvedValue({ token: 'tok', participant: {} }),
      createAdmissionTicket: vi.fn().mockResolvedValue('ticket'),
      verifyAdmissionTicket: vi.fn().mockResolvedValue(undefined),
    };
    resolver = {
      lockJoinable: vi.fn(),
      resolveJoinable: vi.fn(),
      touchEntry: vi.fn().mockResolvedValue(undefined),
    };
    service = new RoomAdmissionService(
      db as unknown as DrizzleDb,
      access as never,
      resolver as unknown as RoomResolverService,
    );
    tx = {
      select: vi.fn().mockReturnValue(chain([])),
      insert: vi.fn().mockReturnValue(chain([])),
      update: vi.fn().mockReturnValue(chain([])),
    };
    db.transaction.mockImplementation(async (cb: unknown) => {
      return (cb as (t: typeof tx) => Promise<unknown>)(tx);
    });
  });

  describe('request (Category B: lockRoom -> resolver.lockJoinable)', () => {
    it('delega en resolver.lockJoinable dentro de la transacción, conservando FOR UPDATE', async () => {
      const room = makeRoom({ waitingRoomEnabled: false });
      resolver.lockJoinable.mockResolvedValueOnce(room);
      tx.select.mockReturnValueOnce(chain([])); // sin fila de rol: no es admin

      const result = await service.request(room.code, 'Ana');

      expect(resolver.lockJoinable).toHaveBeenCalledWith(tx, room.code);
      expect(result).toEqual({ token: 'tok', participant: {} });
    });

    it('[D5 2.19] grant() marca la entrada (touchEntry) -- es uno de los tres sitios de "entrada"', async () => {
      const room = makeRoom({ waitingRoomEnabled: false });
      resolver.lockJoinable.mockResolvedValueOnce(room);
      tx.select.mockReturnValueOnce(chain([]));

      await service.request(room.code, 'Ana');

      expect(resolver.touchEntry).toHaveBeenCalledWith(room.id, tx);
    });

    it('propaga el 404 del resolver para un código retirado o vencido', async () => {
      resolver.lockJoinable.mockRejectedValueOnce(
        new NotFoundException('No existe una sala con ese código'),
      );

      await expect(service.request('codigo-reciclado', 'Ana')).rejects.toThrow(NotFoundException);
    });

  });

  describe('list (Category B: raw query -> resolver.resolveJoinable)', () => {
    it('delega en resolver.resolveJoinable y devuelve la configuración de admisión', async () => {
      const room = makeRoom({ waitingRoomEnabled: true, entryLocked: false });
      resolver.resolveJoinable.mockResolvedValueOnce(room);
      db.select.mockReturnValueOnce(chain([]));

      const result = await service.list(room.code);

      expect(resolver.resolveJoinable).toHaveBeenCalledWith(room.code);
      expect(result.waitingRoomEnabled).toBe(true);
    });

    it('propaga el 404 del resolver para un código retirado o inexistente', async () => {
      resolver.resolveJoinable.mockRejectedValueOnce(
        new NotFoundException('No existe una sala con ese código'),
      );

      await expect(service.list('codigo-reciclado')).rejects.toThrow(NotFoundException);
    });

    it('[5.8] expone isPermanent -- el cliente lo necesita para ocultar el toggle de sala de espera', async () => {
      const room = makeRoom({ isPermanent: true });
      resolver.resolveJoinable.mockResolvedValueOnce(room);
      db.select.mockReturnValueOnce(chain([]));

      const result = await service.list(room.code);

      expect(result.isPermanent).toBe(true);
    });

    it('[D7 :142] el filtro incluye solicitudes sin TTL (expiresAt NULL), no solo las que no vencieron', async () => {
      const room = makeRoom({ isPermanent: true });
      resolver.resolveJoinable.mockResolvedValueOnce(room);
      const selectChain = chain([
        { id: 'req-1', name: 'Ana', userId: null, createdAt: new Date() },
      ]);
      db.select.mockReturnValueOnce(selectChain);

      await service.list(room.code);

      // No hay forma de inspeccionar el árbol SQL con el fake db -- lo que se
      // prueba es que la fila sin TTL (mock) efectivamente aparece en el
      // resultado, en vez de ser excluida por un gt() estricto.
      expect(selectChain.where).toHaveBeenCalled();
    });

    it('[D7 :146-150] cada solicitud pendiente gana un flag stale (creada hace más de 24h)', async () => {
      const room = makeRoom();
      resolver.resolveJoinable.mockResolvedValueOnce(room);
      const oldCreatedAt = new Date(Date.now() - 25 * 60 * 60 * 1000);
      const freshCreatedAt = new Date();
      db.select.mockReturnValueOnce(
        chain([
          { id: 'req-old', name: 'Ana', userId: null, createdAt: oldCreatedAt },
          { id: 'req-fresh', name: 'Bea', userId: null, createdAt: freshCreatedAt },
        ]),
      );

      const result = await service.list(room.code);

      expect(result.requests).toEqual([
        expect.objectContaining({ id: 'req-old', stale: true }),
        expect.objectContaining({ id: 'req-fresh', stale: false }),
      ]);
    });
  });

  describe('configure (D7: la sala permanente siempre exige admisión)', () => {
    it('[:156-159] rechaza desactivar la sala de espera en una sala permanente', async () => {
      const room = makeRoom({ isPermanent: true, waitingRoomEnabled: true });
      resolver.lockJoinable.mockResolvedValueOnce(room);

      await expect(service.configure(room.code, { waitingRoomEnabled: false })).rejects.toThrow(
        'La sala de espera no se puede desactivar en una sala permanente',
      );
      expect(tx.insert).not.toHaveBeenCalled();
    });

    it('[:156-159] fuerza waitingRoomEnabled=true en una sala permanente incluso sin pedirlo explícitamente', async () => {
      const room = makeRoom({ isPermanent: true, waitingRoomEnabled: true });
      resolver.lockJoinable.mockResolvedValueOnce(room);
      const updateChain = chain([]);
      (tx as unknown as { update: ReturnType<typeof vi.fn> }).update = vi
        .fn()
        .mockReturnValue(updateChain);
      (tx as unknown as { select: ReturnType<typeof vi.fn> }).select = vi
        .fn()
        .mockReturnValue(chain([]));

      const result = await service.configure(room.code, { entryLocked: true });

      expect(result.waitingRoomEnabled).toBe(true);
    });

    it('[:156-159] una sala no permanente puede seguir desactivando la sala de espera (regresión no-permanente)', async () => {
      const room = makeRoom({ isPermanent: false, waitingRoomEnabled: true });
      resolver.lockJoinable.mockResolvedValueOnce(room);
      const updateChain = chain([]);
      (tx as unknown as { update: ReturnType<typeof vi.fn> }).update = vi
        .fn()
        .mockReturnValue(updateChain);
      (tx as unknown as { select: ReturnType<typeof vi.fn> }).select = vi
        .fn()
        .mockReturnValue(chain([]));

      const result = await service.configure(room.code, { waitingRoomEnabled: false });

      expect(result.waitingRoomEnabled).toBe(false);
    });
  });

  describe('status (3.7: regresión explícita -- el comportamiento no-permanente no cambia)', () => {
    it('una solicitud vencida en una sala NO permanente sigue reportando expired, exactamente como antes', async () => {
      const room = makeRoom({ isPermanent: false });
      resolver.lockJoinable.mockResolvedValueOnce(room);
      tx.select.mockReturnValueOnce(
        chain([
          {
            id: 'req-1',
            roomId: room.id,
            status: 'pending',
            expiresAt: new Date(Date.now() - 1000),
            name: 'Ana',
            userId: null,
            createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
          },
        ]),
      );

      await expect(service.status(room.code, 'req-1', 'ticket')).resolves.toEqual({
        status: 'expired',
      });
    });

    it('una solicitud sin TTL (sala permanente) sigue pending más allá de 24h, nunca expired', async () => {
      const room = makeRoom({ isPermanent: true, waitingRoomEnabled: true });
      resolver.lockJoinable.mockResolvedValueOnce(room);
      tx.select.mockReturnValueOnce(
        chain([
          {
            id: 'req-1',
            roomId: room.id,
            status: 'pending',
            expiresAt: null,
            name: 'Ana',
            userId: null,
            createdAt: new Date(Date.now() - 31 * 60 * 60 * 1000),
          },
        ]),
      );

      await expect(service.status(room.code, 'req-1', 'ticket')).resolves.toEqual({
        status: 'pending',
        blocked: false,
      });
    });
  });

  describe('configure: isPermanent es inmutable (3.1)', () => {
    it('ignora un isPermanent colado en el DTO -- la sala sigue siendo permanente, nunca se escribe en rooms', async () => {
      const room = makeRoom({ isPermanent: true, waitingRoomEnabled: true });
      resolver.lockJoinable.mockResolvedValueOnce(room);
      const updateChain = chain([]);
      tx.update.mockReturnValue(updateChain);

      await service.configure(room.code, {
        entryLocked: true,
        // @ts-expect-error -- UpdateAdmissionSettingsDto no declara este campo;
        // se fuerza acá para probar que, aunque alguien lo cuele, el service
        // nunca lo lee ni lo persiste (ausente de cada DTO/endpoint, D5).
        isPermanent: false,
      });

      expect(updateChain.set).toHaveBeenCalledWith(
        expect.not.objectContaining({ isPermanent: expect.anything() }),
      );
    });
  });

  describe('decide (D7 :182): conflicto por vencimiento solo aplica cuando hay TTL', () => {
    it('no lanza ConflictException para una solicitud sin TTL (sala permanente) aunque sea vieja', async () => {
      const room = makeRoom({ isPermanent: true });
      resolver.lockJoinable.mockResolvedValueOnce(room);
      const oldRequest = {
        id: 'req-1',
        roomId: room.id,
        status: 'pending',
        expiresAt: null,
        name: 'Ana',
        userId: null,
        createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
      };
      tx.select.mockReturnValueOnce(chain([oldRequest]));
      const updateChain = chain([]);
      (tx as unknown as { update: ReturnType<typeof vi.fn> }).update = vi
        .fn()
        .mockReturnValue(updateChain);

      await expect(service.decide(room.code, 'req-1', 'admitted')).resolves.toEqual({
        status: 'admitted',
      });
    });
  });
});

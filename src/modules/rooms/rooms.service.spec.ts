import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { DrizzleDb } from '../../db/drizzle.module';
import type { Room } from '../../db/schema';
import { chain, createFakeDb, type FakeDb } from '../../test-support/fake-drizzle';
import type { RoomEventsService } from './room-events.service';
import type { RoomResolverService } from './room-resolver.service';
import { RoomsService } from './rooms.service';

const room: Room = {
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
};

describe('RoomsService', () => {
  let db: FakeDb;
  let roomEvents: {
    emitMemberRoleChanged: ReturnType<typeof vi.fn>;
    emitRoomDeleted: ReturnType<typeof vi.fn>;
  };
  let resolver: {
    resolveJoinable: ReturnType<typeof vi.fn>;
    lockJoinable: Mock<RoomResolverService['lockJoinable']>;
    touchEntry: ReturnType<typeof vi.fn>;
    findPoolOccupant: ReturnType<typeof vi.fn>;
    retireExpired: ReturnType<typeof vi.fn>;
  };
  let service: RoomsService;

  beforeEach(() => {
    db = createFakeDb();
    roomEvents = { emitMemberRoleChanged: vi.fn(), emitRoomDeleted: vi.fn() };
    resolver = {
      resolveJoinable: vi.fn().mockResolvedValue(room),
      lockJoinable: vi.fn<RoomResolverService['lockJoinable']>().mockResolvedValue(room),
      touchEntry: vi.fn().mockResolvedValue(undefined),
      findPoolOccupant: vi.fn().mockResolvedValue(undefined),
      retireExpired: vi.fn().mockResolvedValue(undefined),
    };
    service = new RoomsService(
      db as unknown as DrizzleDb,
      roomEvents as unknown as RoomEventsService,
      resolver as unknown as RoomResolverService,
    );
  });

  describe('createRoom', () => {
    function stubTransaction(insertResults: unknown[][]) {
      const inserts = insertResults.map((rows) => chain(rows));
      const tx = { insert: vi.fn() };
      for (const insertChain of inserts) tx.insert.mockReturnValueOnce(insertChain);
      db.transaction.mockImplementationOnce(async (cb: unknown) => {
        return (cb as (transaction: typeof tx) => Promise<Room>)(tx);
      });
      return { tx, inserts };
    }

    it('crea la sala y agrega a quien la crea como administrador, en la misma transacción', async () => {
      const { inserts } = stubTransaction([[room], []]);

      const result = await service.createRoom('Reunión de Daina', 'owner-1');

      expect(result).toBe(room);
      expect(inserts[0].values).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Reunión de Daina' }),
      );
      expect(inserts[1].values).toHaveBeenCalledWith({
        roomId: room.id,
        userId: 'owner-1',
        role: 'administrador',
        isOwner: true,
      });
    });

    it('[4.11] corre el sweep de retiro (retireExpired) antes del probe de colisión, dentro de la misma transacción', async () => {
      const { tx } = stubTransaction([[room], []]);

      await service.createRoom('Reunión de Daina', 'owner-1');

      expect(resolver.retireExpired).toHaveBeenCalledWith(tx);
      expect(resolver.findPoolOccupant).toHaveBeenCalledWith(expect.any(String), tx);
      // El sweep debe ejecutarse antes de que se inspeccione el pool, no después.
      const sweepOrder = resolver.retireExpired.mock.invocationCallOrder[0];
      const probeOrder = resolver.findPoolOccupant.mock.invocationCallOrder[0];
      expect(sweepOrder).toBeLessThan(probeOrder);
    });

    it('[3.4] una sala permanente se inserta con waitingRoomEnabled:true explícito', async () => {
      const permanentRoom = { ...room, isPermanent: true, waitingRoomEnabled: true };
      const { inserts } = stubTransaction([[permanentRoom], []]);

      await service.createRoom('Sala permanente', 'owner-1', { isPermanent: true });

      expect(inserts[0].values).toHaveBeenCalledWith(
        expect.objectContaining({ isPermanent: true, waitingRoomEnabled: true }),
      );
    });

    it('una sala no permanente NO fuerza waitingRoomEnabled (queda en el default de la columna)', async () => {
      const { inserts } = stubTransaction([[room], []]);

      await service.createRoom('Reunión de Daina', 'owner-1');

      expect(inserts[0].values).toHaveBeenCalledWith(
        expect.not.objectContaining({ waitingRoomEnabled: expect.anything() }),
      );
    });

    it('[4.10/4.11] inserta los slots junto con la sala, en la misma transacción', async () => {
      const slots = [{ dayOfWeek: 2, timeOfDay: '07:00', timezone: 'UTC' }];
      const { inserts } = stubTransaction([[room], [], []]);

      await service.createRoom('Sala con horario', 'owner-1', { slots });

      expect(inserts[2].values).toHaveBeenCalledWith([
        expect.objectContaining({ roomId: room.id, ...slots[0] }),
      ]);
    });

    it('sin slots, no hace ningún insert a roomScheduleSlots', async () => {
      const { tx } = stubTransaction([[room], []]);

      await service.createRoom('Reunión de Daina', 'owner-1');

      expect(tx.insert).toHaveBeenCalledTimes(2); // room + member, nunca slots
    });

    it('reintenta si el código generado ya existe en el pool, y tira error después de 5 intentos fallidos', async () => {
      resolver.findPoolOccupant.mockResolvedValue(room); // siempre ocupado
      db.transaction.mockImplementationOnce(async (cb: unknown) => {
        const tx = { insert: vi.fn() };
        return (cb as (transaction: typeof tx) => Promise<Room>)(tx);
      });

      await expect(service.createRoom('Reunión de Daina', 'owner-1')).rejects.toThrow(
        'No se pudo generar un código de sala único',
      );
      expect(resolver.findPoolOccupant).toHaveBeenCalledTimes(5);
    });
  });

  describe('getByCodeOrThrow', () => {
    it('delega en RoomResolverService.resolveJoinable y propaga su resultado', async () => {
      await expect(service.getByCodeOrThrow(room.code)).resolves.toBe(room);
      expect(resolver.resolveJoinable).toHaveBeenCalledWith(room.code);
    });

    it('propaga el 404 del resolver para un código retirado o vencido (D1: indistinguible de uno inexistente)', async () => {
      resolver.resolveJoinable.mockRejectedValueOnce(
        new NotFoundException(`No existe una sala con el código "${room.code}"`),
      );

      await expect(service.getByCodeOrThrow(room.code)).rejects.toThrow(NotFoundException);
    });

  });

  describe('joinRoom', () => {
    it('agrega a quien se une como participante, sin fallar si ya era miembro', async () => {
      const memberInsert = chain([]);
      db.insert.mockReturnValueOnce(memberInsert);

      await service.joinRoom(room.code, 'user-2');

      expect(memberInsert.values).toHaveBeenCalledWith(
        expect.objectContaining({ roomId: room.id, userId: 'user-2', role: 'participante' }),
      );
      expect(memberInsert.onConflictDoNothing).toHaveBeenCalled();
    });

    it('[D5 2.19] marca la entrada (touchEntry) -- joinRoom es uno de los tres sitios de "entrada"', async () => {
      const memberInsert = chain([]);
      db.insert.mockReturnValueOnce(memberInsert);

      await service.joinRoom(room.code, 'user-2');

      expect(resolver.touchEntry).toHaveBeenCalledWith(room.id);
    });

    it('rechaza con el 404/403 del resolver para una sala retirada, vencida o cerrada, sin tocar roomMembers', async () => {
      resolver.resolveJoinable.mockRejectedValueOnce(
        new NotFoundException(`No existe una sala con el código "${room.code}"`),
      );

      await expect(service.joinRoom(room.code, 'user-2')).rejects.toThrow(NotFoundException);
      expect(db.insert).not.toHaveBeenCalled();
    });
  });

  describe('listMembers', () => {
    it('devuelve la lista de miembros con su nombre y rol', async () => {
      const membersView = [
        { userId: 'user-1', name: 'Alex', role: 'administrador' as const, isOwner: true },
      ];
      db.select.mockReturnValueOnce(chain(membersView));

      const result = await service.listMembers(room.code);

      expect(result).toBe(membersView);
    });
  });

  describe('getMemberRole', () => {
    it('devuelve undefined si la persona no es miembro de la sala', async () => {
      db.select.mockReturnValueOnce(chain([]));

      await expect(service.getMemberRole(room.code, 'alguien-ajeno')).resolves.toBeUndefined();
    });

    it('devuelve el rol de la persona cuando sí es miembro', async () => {
      db.select.mockReturnValueOnce(chain([{ role: 'colaborador' }]));

      await expect(service.getMemberRole(room.code, 'user-2')).resolves.toBe('colaborador');
    });
  });

  describe('setMemberRole', () => {
    beforeEach(() => {
      db.transaction.mockImplementation(async (cb: unknown) =>
        (cb as (tx: FakeDb) => Promise<unknown>)(db),
      );
    });

    it('lanza NotFoundException si el destino todavía no es miembro de la sala', async () => {
      db.select.mockReturnValueOnce(chain([{ userId: 'owner-1', role: 'administrador' }]));

      await expect(
        service.setMemberRole(room.code, 'ajeno', 'colaborador', 'owner-1'),
      ).rejects.toThrow(NotFoundException);
      expect(roomEvents.emitMemberRoleChanged).not.toHaveBeenCalled();
    });

    it('impide quitar o cambiar el rol del último administrador', async () => {
      db.select.mockReturnValueOnce(chain([{ userId: 'owner-1', role: 'administrador' }]));

      await expect(
        service.setMemberRole(room.code, 'owner-1', 'participante', 'owner-1'),
      ).rejects.toThrow('La sala debe conservar al menos un administrador');
      expect(db.update).not.toHaveBeenCalled();
      expect(roomEvents.emitMemberRoleChanged).not.toHaveBeenCalled();
    });

    it.each(['participante', 'colaborador'] as const)(
      'protege al propietario de un cambio a %s incluso si hay otros admins',
      async (role) => {
        db.select.mockReturnValueOnce(
          chain([
            { userId: 'owner-1', role: 'administrador', isOwner: true },
            { userId: 'user-2', role: 'administrador', isOwner: false },
          ]),
        );

        await expect(service.setMemberRole(room.code, 'owner-1', role, 'user-2')).rejects.toThrow(
          'No se pueden quitar los permisos del propietario de la sala',
        );
        expect(db.update).not.toHaveBeenCalled();
        expect(roomEvents.emitMemberRoleChanged).not.toHaveBeenCalled();
      },
    );

    it.each([
      ['participante', 'colaborador'],
      ['participante', 'administrador'],
      ['colaborador', 'administrador'],
      ['colaborador', 'participante'],
      ['administrador', 'participante'],
      ['administrador', 'colaborador'],
    ] as const)('cambia de %s a %s y notifica el cambio', async (previousRole, role) => {
      db.select.mockReturnValueOnce(
        chain([
          { userId: 'owner-1', role: 'administrador' },
          { userId: 'user-2', role: previousRole },
        ]),
      );
      const updateChain = chain([{ userId: 'user-2' }]);
      db.update.mockReturnValueOnce(updateChain);

      await service.setMemberRole(room.code, 'user-2', role, 'owner-1');

      expect(updateChain.set).toHaveBeenCalledWith({ role });
      expect(resolver.lockJoinable.mock.calls).toEqual([[db, room.code]]);
      expect(roomEvents.emitMemberRoleChanged).toHaveBeenCalledWith({ roomCode: room.code });
    });

    it.each(['colaborador', 'participante', undefined])(
      'rechaza a quien ya no tiene permisos admin (%s)',
      async (role) => {
        db.select.mockReturnValueOnce(
          chain([
            { userId: 'owner-1', role: 'administrador' },
            { userId: 'user-2', role },
          ]),
        );

        await expect(
          service.setMemberRole(room.code, 'owner-1', 'participante', 'user-2'),
        ).rejects.toThrow(ForbiddenException);
        expect(db.update).not.toHaveBeenCalled();
        expect(roomEvents.emitMemberRoleChanged).not.toHaveBeenCalled();
      },
    );

    it('mantener el rol actual no modifica la membresía ni emite un cambio', async () => {
      db.select.mockReturnValueOnce(chain([{ userId: 'owner-1', role: 'administrador' }]));

      await service.setMemberRole(room.code, 'owner-1', 'administrador', 'owner-1');

      expect(db.update).not.toHaveBeenCalled();
      expect(roomEvents.emitMemberRoleChanged).not.toHaveBeenCalled();
    });
  });

  describe('renameRoom', () => {
    it('actualiza el nombre de una sala permanente', async () => {
      const permanentRoom = { ...room, isPermanent: true };
      resolver.resolveJoinable.mockResolvedValueOnce(permanentRoom);
      const updateChain = chain([]);
      db.update.mockReturnValueOnce(updateChain);

      await service.renameRoom(room.code, 'Grupo de los jueves');

      expect(updateChain.set).toHaveBeenCalledWith({ name: 'Grupo de los jueves' });
    });

    it('actualiza el nombre de una sala temporal (el rename vale para todas las salas)', async () => {
      resolver.resolveJoinable.mockResolvedValueOnce({ ...room, isPermanent: false });
      const updateChain = chain([]);
      db.update.mockReturnValueOnce(updateChain);

      await service.renameRoom(room.code, 'Nuevo nombre');

      expect(updateChain.set).toHaveBeenCalledWith({ name: 'Nuevo nombre' });
    });
  });

  describe('promoteToPermanent', () => {
    function stubTransaction(memberRows: unknown[], updatedRows: unknown[] = []) {
      const updateChain = chain(updatedRows);
      const tx = {
        select: vi.fn().mockReturnValue(chain(memberRows)),
        update: vi.fn().mockReturnValue(updateChain),
      };
      db.transaction.mockImplementationOnce(async (cb: unknown) =>
        (cb as (transaction: typeof tx) => Promise<Room>)(tx),
      );
      return { tx, updateChain };
    }

    it('un administrador promueve la sala temporal: isPermanent y waitingRoomEnabled quedan en true', async () => {
      const promoted = { ...room, isPermanent: true, waitingRoomEnabled: true };
      const { tx, updateChain } = stubTransaction([{ role: 'administrador' }], [promoted]);

      const result = await service.promoteToPermanent(room.code, 'owner-1');

      expect(result).toBe(promoted);
      expect(resolver.lockJoinable).toHaveBeenCalledWith(tx, room.code);
      expect(updateChain.set).toHaveBeenCalledWith({
        isPermanent: true,
        waitingRoomEnabled: true,
      });
    });

    it('es idempotente: si la sala ya es permanente devuelve la sala sin escribir', async () => {
      const permanent = { ...room, isPermanent: true, waitingRoomEnabled: true };
      resolver.lockJoinable.mockResolvedValueOnce(permanent);
      const { tx } = stubTransaction([{ role: 'administrador' }]);

      const result = await service.promoteToPermanent(room.code, 'owner-1');

      expect(result).toBe(permanent);
      expect(tx.update).not.toHaveBeenCalled();
    });

    it.each(['colaborador', 'participante'] as const)(
      'responde 403 si quien llama es %s, sin escribir',
      async (role) => {
        const { tx } = stubTransaction([{ role }]);

        await expect(service.promoteToPermanent(room.code, 'user-2')).rejects.toThrow(
          ForbiddenException,
        );
        expect(tx.update).not.toHaveBeenCalled();
      },
    );

    it('responde 403 si quien llama no es miembro de la sala', async () => {
      const { tx } = stubTransaction([]);

      await expect(service.promoteToPermanent(room.code, 'user-9')).rejects.toThrow(
        ForbiddenException,
      );
      expect(tx.update).not.toHaveBeenCalled();
    });

    it('responde 404 si la sala está vencida, retirada o no existe (mismo predicado de vida que el resolver)', async () => {
      resolver.lockJoinable.mockRejectedValueOnce(new NotFoundException('No existe'));
      const { tx } = stubTransaction([{ role: 'administrador' }]);

      await expect(service.promoteToPermanent(room.code, 'owner-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(tx.update).not.toHaveBeenCalled();
    });
  });

  describe('deleteRoom', () => {
    function stubTransaction() {
      const deleteChain = chain([]);
      const tx = { delete: vi.fn().mockReturnValue(deleteChain) };
      db.transaction.mockImplementationOnce(async (cb: unknown) =>
        (cb as (transaction: typeof tx) => Promise<void>)(tx),
      );
      return { tx, deleteChain };
    }

    it('borra la sala en una transacción y avisa a los sockets conectados', async () => {
      resolver.findPoolOccupant.mockResolvedValueOnce(room);
      const { tx, deleteChain } = stubTransaction();

      await service.deleteRoom(room.code);

      expect(resolver.findPoolOccupant).toHaveBeenCalledWith(room.code);
      expect(tx.delete).toHaveBeenCalledTimes(1);
      expect(deleteChain.where).toHaveBeenCalledTimes(1);
      expect(roomEvents.emitRoomDeleted).toHaveBeenCalledWith({ roomCode: room.code });
    });

    it('responde 404 si la sala no existe, sin borrar ni avisar', async () => {
      resolver.findPoolOccupant.mockResolvedValueOnce(undefined);

      await expect(service.deleteRoom('zzz-zzzz-zzz')).rejects.toThrow(NotFoundException);
      expect(db.transaction).not.toHaveBeenCalled();
      expect(roomEvents.emitRoomDeleted).not.toHaveBeenCalled();
    });

    it('no avisa a los sockets si el borrado falla', async () => {
      resolver.findPoolOccupant.mockResolvedValueOnce(room);
      db.transaction.mockRejectedValueOnce(new Error('db down'));

      await expect(service.deleteRoom(room.code)).rejects.toThrow('db down');
      expect(roomEvents.emitRoomDeleted).not.toHaveBeenCalled();
    });

    describe('deleteRoomAsAdmin', () => {
      it('borra la sala si quien llama es su administrador', async () => {
        resolver.findPoolOccupant.mockResolvedValueOnce(room);
        db.select.mockReturnValueOnce(chain([{ role: 'administrador' }]));
        const { tx } = stubTransaction();

        await service.deleteRoomAsAdmin(room.code, 'owner-1');

        expect(tx.delete).toHaveBeenCalledTimes(1);
        expect(roomEvents.emitRoomDeleted).toHaveBeenCalledWith({ roomCode: room.code });
      });

      it.each(['colaborador', 'participante'] as const)(
        'responde 403 si quien llama es %s de la sala, sin borrar',
        async (role) => {
          resolver.findPoolOccupant.mockResolvedValueOnce(room);
          db.select.mockReturnValueOnce(chain([{ role }]));

          await expect(service.deleteRoomAsAdmin(room.code, 'user-2')).rejects.toThrow(
            ForbiddenException,
          );
          expect(db.transaction).not.toHaveBeenCalled();
          expect(roomEvents.emitRoomDeleted).not.toHaveBeenCalled();
        },
      );

      it('responde 403 si quien llama ni siquiera es miembro de la sala', async () => {
        resolver.findPoolOccupant.mockResolvedValueOnce(room);
        db.select.mockReturnValueOnce(chain([]));

        await expect(service.deleteRoomAsAdmin(room.code, 'ajeno')).rejects.toThrow(
          ForbiddenException,
        );
        expect(db.transaction).not.toHaveBeenCalled();
      });

      it('responde 404 si la sala no existe', async () => {
        resolver.findPoolOccupant.mockResolvedValueOnce(undefined);

        await expect(service.deleteRoomAsAdmin('zzz-zzzz-zzz', 'owner-1')).rejects.toThrow(
          NotFoundException,
        );
        expect(db.select).not.toHaveBeenCalled();
        expect(db.transaction).not.toHaveBeenCalled();
      });
    });
  });
});

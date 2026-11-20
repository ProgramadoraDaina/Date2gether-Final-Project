import { beforeEach, describe, expect, it, jest } from '@jest/globals';
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
  isActive: true,
  isPermanent: false,
  lastEnteredAt: new Date(),
  retiredAt: null,
  waitingRoomEnabled: false,
  entryLocked: false,
  createdAt: new Date(),
  chimeMeetingId: null,
};

describe('RoomsService', () => {
  let db: FakeDb;
  let roomEvents: { emitMemberRoleChanged: ReturnType<typeof jest.fn> };
  let resolver: {
    resolveJoinable: ReturnType<typeof jest.fn>;
    lockJoinable: jest.Mock<RoomResolverService['lockJoinable']>;
    touchEntry: ReturnType<typeof jest.fn>;
    findPoolOccupant: ReturnType<typeof jest.fn>;
    retireExpired: ReturnType<typeof jest.fn>;
  };
  let service: RoomsService;

  beforeEach(() => {
    db = createFakeDb();
    roomEvents = { emitMemberRoleChanged: jest.fn() };
    resolver = {
      resolveJoinable: jest.fn().mockResolvedValue(room),
      lockJoinable: jest.fn<RoomResolverService['lockJoinable']>().mockResolvedValue(room),
      touchEntry: jest.fn().mockResolvedValue(undefined),
      findPoolOccupant: jest.fn().mockResolvedValue(undefined),
      retireExpired: jest.fn().mockResolvedValue(undefined),
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
      const tx = { insert: jest.fn() };
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
      expect(inserts[1].values).toHaveBeenCalledWith(
        expect.objectContaining({ roomId: room.id, userId: 'owner-1', role: 'administrador' }),
      );
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
        const tx = { insert: jest.fn() };
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

    it('propaga el 403 del resolver cuando la sala existe pero está cerrada', async () => {
      resolver.resolveJoinable.mockRejectedValueOnce(
        new ForbiddenException('La sala está cerrada'),
      );

      await expect(service.getByCodeOrThrow(room.code)).rejects.toThrow(ForbiddenException);
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
      const membersView = [{ userId: 'user-1', name: 'Alex', role: 'administrador' as const }];
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
});

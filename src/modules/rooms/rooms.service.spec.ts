import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { DrizzleDb } from '../../db/drizzle.module';
import type { Room } from '../../db/schema';
import { chain, createFakeDb, type FakeDb } from '../../test-support/fake-drizzle';
import type { RoomEventsService } from './room-events.service';
import { RoomsService } from './rooms.service';

const room: Room = {
  id: 'room-1',
  code: 'abc-defg-hij',
  name: 'Reunión de Daina',
  isActive: true,
  createdAt: new Date(),
  chimeMeetingId: null,
};

describe('RoomsService', () => {
  let db: FakeDb;
  let roomEvents: { emitMemberRoleChanged: ReturnType<typeof jest.fn> };
  let service: RoomsService;

  beforeEach(() => {
    db = createFakeDb();
    roomEvents = { emitMemberRoleChanged: jest.fn() };
    service = new RoomsService(
      db as unknown as DrizzleDb,
      roomEvents as unknown as RoomEventsService,
    );
  });

  describe('createRoom', () => {
    it('crea la sala y agrega a quien la crea como administrador, en la misma transacción', async () => {
      db.select.mockReturnValueOnce(chain([])); // el código generado no choca con uno existente
      const roomInsert = chain([room]);
      const memberInsert = chain([]);
      db.transaction.mockImplementationOnce(async (cb: unknown) => {
        const tx = { insert: jest.fn().mockReturnValueOnce(roomInsert).mockReturnValueOnce(memberInsert) };
        return (cb as (tx: typeof tx) => Promise<Room>)(tx);
      });

      const result = await service.createRoom('Reunión de Daina', 'owner-1');

      expect(result).toBe(room);
      expect(roomInsert.values).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Reunión de Daina' }),
      );
      expect(memberInsert.values).toHaveBeenCalledWith(
        expect.objectContaining({ roomId: room.id, userId: 'owner-1', role: 'administrador' }),
      );
    });

    it('reintenta si el código generado ya existe, y tira error después de 5 intentos fallidos', async () => {
      for (let i = 0; i < 5; i++) {
        db.select.mockReturnValueOnce(chain([room])); // siempre "ya existe" una sala con ese código
      }

      await expect(service.createRoom('Reunión de Daina', 'owner-1')).rejects.toThrow(
        'No se pudo generar un código de sala único',
      );
      expect(db.select).toHaveBeenCalledTimes(5);
      expect(db.transaction).not.toHaveBeenCalled();
    });
  });

  describe('getByCodeOrThrow', () => {
    it('lanza NotFoundException si no existe una sala con ese código', async () => {
      db.select.mockReturnValueOnce(chain([]));

      await expect(service.getByCodeOrThrow('no-existe')).rejects.toThrow(NotFoundException);
    });

    it('devuelve la sala cuando el código existe', async () => {
      db.select.mockReturnValueOnce(chain([room]));

      await expect(service.getByCodeOrThrow(room.code)).resolves.toBe(room);
    });
  });

  describe('joinRoom', () => {
    it('agrega a quien se une como participante, sin fallar si ya era miembro', async () => {
      db.select.mockReturnValueOnce(chain([room]));
      const memberInsert = chain([]);
      db.insert.mockReturnValueOnce(memberInsert);

      await service.joinRoom(room.code, 'user-2');

      expect(memberInsert.values).toHaveBeenCalledWith(
        expect.objectContaining({ roomId: room.id, userId: 'user-2', role: 'participante' }),
      );
      expect(memberInsert.onConflictDoNothing).toHaveBeenCalled();
    });
  });

  describe('listMembers', () => {
    it('devuelve la lista de miembros con su nombre y rol', async () => {
      db.select.mockReturnValueOnce(chain([room]));
      const membersView = [{ userId: 'user-1', name: 'Alex', role: 'administrador' as const }];
      db.select.mockReturnValueOnce(chain(membersView));

      const result = await service.listMembers(room.code);

      expect(result).toBe(membersView);
    });
  });

  describe('getMemberRole', () => {
    it('devuelve undefined si la persona no es miembro de la sala', async () => {
      db.select.mockReturnValueOnce(chain([room]));
      db.select.mockReturnValueOnce(chain([]));

      await expect(service.getMemberRole(room.code, 'alguien-ajeno')).resolves.toBeUndefined();
    });

    it('devuelve el rol de la persona cuando sí es miembro', async () => {
      db.select.mockReturnValueOnce(chain([room]));
      db.select.mockReturnValueOnce(chain([{ role: 'colaborador' }]));

      await expect(service.getMemberRole(room.code, 'user-2')).resolves.toBe('colaborador');
    });
  });

  describe('setMemberRole', () => {
    it('lanza NotFoundException si el destino todavía no es miembro de la sala', async () => {
      db.select.mockReturnValueOnce(chain([room]));
      db.select.mockReturnValueOnce(chain([]));

      await expect(service.setMemberRole(room.code, 'ajeno', 'colaborador')).rejects.toThrow(
        NotFoundException,
      );
      expect(roomEvents.emitMemberRoleChanged).not.toHaveBeenCalled();
    });

    it('impide cambiar el rol de quien es administrador de la sala', async () => {
      db.select.mockReturnValueOnce(chain([room]));
      db.select.mockReturnValueOnce(chain([{ role: 'administrador' }]));

      await expect(service.setMemberRole(room.code, 'owner-1', 'participante')).rejects.toThrow(
        ForbiddenException,
      );
      expect(db.update).not.toHaveBeenCalled();
      expect(roomEvents.emitMemberRoleChanged).not.toHaveBeenCalled();
    });

    it('actualiza el rol y notifica el cambio vía RoomEventsService', async () => {
      db.select.mockReturnValueOnce(chain([room]));
      db.select.mockReturnValueOnce(chain([{ role: 'participante' }]));
      const updateChain = chain([]);
      db.update.mockReturnValueOnce(updateChain);

      await service.setMemberRole(room.code, 'user-2', 'colaborador');

      expect(updateChain.set).toHaveBeenCalledWith({ role: 'colaborador' });
      expect(roomEvents.emitMemberRoleChanged).toHaveBeenCalledWith({ roomCode: room.code });
    });
  });
});

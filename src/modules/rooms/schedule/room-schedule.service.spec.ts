import { beforeEach, describe, expect, it } from '@jest/globals';
import type { DrizzleDb } from '../../../db/drizzle.module';
import type { RoomScheduleSlot } from '../../../db/schema';
import { chain, createFakeDb, type FakeDb } from '../../../test-support/fake-drizzle';
import { RoomScheduleService } from './room-schedule.service';

function makeSlot(overrides: Partial<RoomScheduleSlot> = {}): RoomScheduleSlot {
  return {
    id: 'slot-1',
    roomId: 'room-1',
    dayOfWeek: 2,
    timeOfDay: '07:00',
    timezone: 'America/Argentina/Buenos_Aires',
    createdAt: new Date(),
    ...overrides,
  };
}

describe('RoomScheduleService', () => {
  let db: FakeDb;
  let service: RoomScheduleService;

  beforeEach(() => {
    db = createFakeDb();
    service = new RoomScheduleService(db as unknown as DrizzleDb);
  });

  describe('createSlot', () => {
    it('inserta el slot y lo devuelve', async () => {
      const slot = makeSlot();
      const insertChain = chain([slot]);
      db.insert.mockReturnValueOnce(insertChain);

      const result = await service.createSlot('room-1', {
        dayOfWeek: 2,
        timeOfDay: '07:00',
        timezone: 'America/Argentina/Buenos_Aires',
      });

      expect(result).toBe(slot);
      expect(insertChain.values).toHaveBeenCalledWith(
        expect.objectContaining({ roomId: 'room-1', dayOfWeek: 2 }),
      );
    });

    it('propaga la violación de la restricción UNIQUE(roomId, dayOfWeek, timeOfDay, timezone) sin atraparla', async () => {
      const duplicateError = Object.assign(new Error('duplicate key value'), { code: '23505' });
      db.insert.mockImplementationOnce(() => {
        throw duplicateError;
      });

      await expect(
        service.createSlot('room-1', {
          dayOfWeek: 2,
          timeOfDay: '07:00',
          timezone: 'America/Argentina/Buenos_Aires',
        }),
      ).rejects.toBe(duplicateError);
    });
  });

  describe('listSlots', () => {
    it('devuelve los slots de la sala', async () => {
      const slots = [makeSlot(), makeSlot({ id: 'slot-2', dayOfWeek: 4, timeOfDay: '15:00' })];
      db.select.mockReturnValueOnce(chain(slots));

      await expect(service.listSlots('room-1')).resolves.toEqual(slots);
    });
  });

  describe('deleteSlot', () => {
    it('borra el slot dado, sin efectos secundarios adicionales (D5: nada deriva estado de los slots)', async () => {
      const deleteChain = chain([]);
      db.delete.mockReturnValueOnce(deleteChain);

      await service.deleteSlot('room-1', 'slot-1');

      expect(db.delete).toHaveBeenCalled();
      expect(deleteChain.where).toHaveBeenCalled();
    });
  });

  describe('getNextOccurrence', () => {
    it('orquesta el fetch de slots + nextOccurrence(), devolviendo el instante más próximo', async () => {
      const now = new Date('2026-11-16T12:00:00Z'); // lunes
      const slot = makeSlot({ dayOfWeek: 2, timeOfDay: '10:00', timezone: 'UTC' }); // martes
      db.select.mockReturnValueOnce(chain([slot]));

      const result = await service.getNextOccurrence('room-1', now);

      expect(result).toEqual(new Date('2026-11-17T10:00:00Z'));
    });

    it('devuelve null cuando la sala no tiene slots', async () => {
      db.select.mockReturnValueOnce(chain([]));

      await expect(service.getNextOccurrence('room-1', new Date())).resolves.toBeNull();
    });
  });
});

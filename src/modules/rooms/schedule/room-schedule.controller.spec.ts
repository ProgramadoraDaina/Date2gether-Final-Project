import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { Room, RoomScheduleSlot } from '../../../db/schema';
import type { RoomResolverService } from '../room-resolver.service';
import { RoomScheduleController } from './room-schedule.controller';
import type { RoomScheduleService } from './room-schedule.service';

function makeRoom(overrides: Partial<Room> = {}): Room {
  return {
    id: 'room-1',
    code: 'abc-defg-hij',
    name: 'Reunión de Daina',
    isActive: true,
    isPermanent: true,
    lastEnteredAt: new Date(),
    retiredAt: null,
    waitingRoomEnabled: true,
    entryLocked: false,
    createdAt: new Date(),
    chimeMeetingId: null,
    ...overrides,
  };
}

describe('RoomScheduleController', () => {
  let resolver: { resolveJoinable: ReturnType<typeof jest.fn> };
  let scheduleService: {
    getNextOccurrence: ReturnType<typeof jest.fn>;
    listSlots: ReturnType<typeof jest.fn>;
    createSlot: ReturnType<typeof jest.fn>;
    deleteSlot: ReturnType<typeof jest.fn>;
  };
  let controller: RoomScheduleController;

  beforeEach(() => {
    const room = makeRoom();
    resolver = { resolveJoinable: jest.fn().mockResolvedValue(room) };
    scheduleService = {
      getNextOccurrence: jest.fn(),
      listSlots: jest.fn(),
      createSlot: jest.fn(),
      deleteSlot: jest.fn(),
    };
    controller = new RoomScheduleController(
      scheduleService as unknown as RoomScheduleService,
      resolver as unknown as RoomResolverService,
    );
  });

  describe('GET /rooms/:code/schedule/next (sin autenticación)', () => {
    it('devuelve solo nextOccurrenceAt -- la respuesta no tiene ningún campo que pueda llevar la timezone del owner', async () => {
      scheduleService.getNextOccurrence.mockResolvedValueOnce(new Date('2026-11-17T10:00:00Z'));

      const result = await controller.next('abc-defg-hij');

      expect(result).toEqual({ nextOccurrenceAt: '2026-11-17T10:00:00.000Z' });
      expect(Object.keys(result)).toEqual(['nextOccurrenceAt']);
    });

    it('devuelve nextOccurrenceAt: null cuando la sala no tiene próxima ocurrencia', async () => {
      scheduleService.getNextOccurrence.mockResolvedValueOnce(null);

      const result = await controller.next('abc-defg-hij');

      expect(result).toEqual({ nextOccurrenceAt: null });
    });
  });

  describe('GET /rooms/:code/schedule/slots (admin-only)', () => {
    it('devuelve los slots completos, incluida la timezone', async () => {
      const slots = [
        {
          id: 's1',
          roomId: 'room-1',
          dayOfWeek: 2,
          timeOfDay: '07:00',
          timezone: 'America/Argentina/Buenos_Aires',
          createdAt: new Date(),
        },
      ] as RoomScheduleSlot[];
      scheduleService.listSlots.mockResolvedValueOnce(slots);

      const result = await controller.listSlots('abc-defg-hij');

      expect(result).toBe(slots);
      expect(result[0]).toHaveProperty('timezone');
      expect(scheduleService.listSlots).toHaveBeenCalledWith('room-1');
    });
  });

  describe('POST /rooms/:code/schedule/slots (admin-only)', () => {
    it('resuelve la sala por código y crea el slot con su roomId', async () => {
      const dto = { dayOfWeek: 2, timeOfDay: '07:00', timezone: 'UTC' };
      scheduleService.createSlot.mockResolvedValueOnce({
        id: 's1',
        roomId: 'room-1',
        ...dto,
        createdAt: new Date(),
      });

      await controller.createSlot('abc-defg-hij', dto);

      expect(resolver.resolveJoinable).toHaveBeenCalledWith('abc-defg-hij');
      expect(scheduleService.createSlot).toHaveBeenCalledWith('room-1', dto);
    });
  });

  describe('DELETE /rooms/:code/schedule/slots/:slotId (admin-only)', () => {
    it('resuelve la sala por código y borra el slot scoped a ese roomId', async () => {
      await controller.deleteSlot('abc-defg-hij', 'slot-1');

      expect(resolver.resolveJoinable).toHaveBeenCalledWith('abc-defg-hij');
      expect(scheduleService.deleteSlot).toHaveBeenCalledWith('room-1', 'slot-1');
    });
  });
});

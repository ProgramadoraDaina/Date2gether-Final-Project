import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { DrizzleDb } from '../../db/drizzle.module';
import { RoomEventsService } from './room-events.service';
import { RoomsService } from './rooms.service';

describe('RoomsService', () => {
  let service: RoomsService;
  let where: jest.Mock<(...args: unknown[]) => Promise<unknown>>;
  let set: jest.Mock<(...args: unknown[]) => { where: typeof where }>;
  let update: jest.Mock<(...args: unknown[]) => { set: typeof set }>;

  beforeEach(() => {
    where = jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(undefined);
    set = jest.fn<(...args: unknown[]) => { where: typeof where }>().mockReturnValue({ where });
    update = jest.fn<(...args: unknown[]) => { set: typeof set }>().mockReturnValue({ set });
    const db = { update } as unknown as DrizzleDb;
    service = new RoomsService(db, new RoomEventsService());
  });

  it('guarda el MeetingId de Chime de la sala', async () => {
    await service.setChimeMeetingId('room-1', 'meeting-123');

    expect(update).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith({ chimeMeetingId: 'meeting-123' });
    expect(where).toHaveBeenCalledTimes(1);
  });
});

import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDb } from '../../../db/drizzle.module';
import { roomScheduleSlots, type RoomScheduleSlot } from '../../../db/schema';
import { nextOccurrence } from './next-occurrence';

export interface CreateSlotInput {
  dayOfWeek: number;
  timeOfDay: string;
  timezone: string;
}

@Injectable()
export class RoomScheduleService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  async createSlot(roomId: string, input: CreateSlotInput): Promise<RoomScheduleSlot> {
    const [slot] = await this.db
      .insert(roomScheduleSlots)
      .values({ roomId, ...input })
      .returning();
    return slot;
  }

  async listSlots(roomId: string): Promise<RoomScheduleSlot[]> {
    return this.db.select().from(roomScheduleSlots).where(eq(roomScheduleSlots.roomId, roomId));
  }

  // Scoped by roomId too, not just slotId: an admin for room A can never
  // delete a slot id that happens to belong to room B.
  async deleteSlot(roomId: string, slotId: string): Promise<void> {
    await this.db
      .delete(roomScheduleSlots)
      .where(and(eq(roomScheduleSlots.id, slotId), eq(roomScheduleSlots.roomId, roomId)));
  }

  async getNextOccurrence(roomId: string, now: Date = new Date()): Promise<Date | null> {
    const slots = await this.listSlots(roomId);
    return nextOccurrence(slots, now);
  }
}

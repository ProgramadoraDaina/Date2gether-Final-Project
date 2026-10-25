import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { generateRoomCode } from '../../common/generate-room-code';
import { DRIZZLE, DrizzleDb } from '../../db/drizzle.module';
import { rooms, type Room } from '../../db/schema';

@Injectable()
export class RoomsService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  async createRoom(name: string): Promise<Room> {
    // Reintenta si el código generado choca con uno existente (muy poco probable).
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateRoomCode();
      const existing = await this.findByCode(code);
      if (existing) continue;

      const [room] = await this.db.insert(rooms).values({ name, code }).returning();
      return room;
    }
    throw new Error('No se pudo generar un código de sala único, intenta de nuevo.');
  }

  async findByCode(code: string): Promise<Room | undefined> {
    const [room] = await this.db.select().from(rooms).where(eq(rooms.code, code)).limit(1);
    return room;
  }

  async getByCodeOrThrow(code: string): Promise<Room> {
    const room = await this.findByCode(code);
    if (!room) throw new NotFoundException(`No existe una sala con el código "${code}"`);
    return room;
  }

  async setChimeMeetingId(roomId: string, chimeMeetingId: string): Promise<void> {
    await this.db.update(rooms).set({ chimeMeetingId }).where(eq(rooms.id, roomId));
  }
}

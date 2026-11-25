import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { DRIZZLE, DrizzleDb } from '../../db/drizzle.module';
import { roomLinks, users, type RoomLink } from '../../db/schema';
import { RoomEventsService } from '../rooms/room-events.service';
import { RoomsService } from '../rooms/rooms.service';
import type { CreateRoomLinkDto } from './dto/create-room-link.dto';

@Injectable()
export class RoomLinksService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly rooms: RoomsService,
    private readonly roomEvents: RoomEventsService,
  ) {}

  list(roomId: string): Promise<RoomLink[]> {
    return this.db
      .select()
      .from(roomLinks)
      .where(eq(roomLinks.roomId, roomId))
      .orderBy(desc(roomLinks.createdAt));
  }

  async add(code: string, userId: string, dto: CreateRoomLinkDto): Promise<RoomLink> {
    const room = await this.rooms.getByCodeOrThrow(code);
    if (!room.isPermanent) {
      throw new ForbiddenException('Solo las salas permanentes tienen biblioteca de links');
    }
    const [author] = await this.db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const [link] = await this.db
      .insert(roomLinks)
      .values({
        roomId: room.id,
        url: dto.url,
        title: dto.title?.trim() || null,
        addedByName: author?.name ?? '',
      })
      .onConflictDoNothing()
      .returning();
    if (!link) throw new ConflictException('Ese link ya está en la biblioteca');
    this.roomEvents.emitRoomLinksChanged({ roomCode: room.code });
    return link;
  }

  async remove(code: string, id: string): Promise<void> {
    const room = await this.rooms.getByCodeOrThrow(code);
    const deleted = await this.db
      .delete(roomLinks)
      .where(and(eq(roomLinks.id, id), eq(roomLinks.roomId, room.id)))
      .returning({ id: roomLinks.id });
    if (deleted.length === 0) throw new NotFoundException('Ese link ya no está en la biblioteca');
    this.roomEvents.emitRoomLinksChanged({ roomCode: room.code });
  }
}

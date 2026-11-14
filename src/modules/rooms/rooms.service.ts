import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { generateRoomCode } from '../../common/generate-room-code';
import { DRIZZLE, DrizzleDb } from '../../db/drizzle.module';
import { roomMembers, roomNotes, rooms, users, type Room, type RoomRole } from '../../db/schema';
import { RoomEventsService } from './room-events.service';

export interface RoomMemberView {
  userId: string;
  name: string;
  role: RoomRole;
}

@Injectable()
export class RoomsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly roomEvents: RoomEventsService,
  ) {}

  async createRoom(name: string, creatorId: string): Promise<Room> {
    // Reintenta si el código generado choca con uno existente (muy poco probable).
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateRoomCode();
      const existing = await this.findByCode(code);
      if (existing) continue;

      return this.db.transaction(async (tx) => {
        const [room] = await tx.insert(rooms).values({ name, code }).returning();
        await tx
          .insert(roomMembers)
          .values({ roomId: room.id, userId: creatorId, role: 'administrador' });
        return room;
      });
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

  async joinRoom(code: string, userId: string): Promise<void> {
    const room = await this.getByCodeOrThrow(code);
    if (!room.isActive) throw new ForbiddenException('La sala está cerrada');
    if (room.waitingRoomEnabled || room.entryLocked) {
      const [member] = await this.db
        .select()
        .from(roomMembers)
        .where(and(eq(roomMembers.roomId, room.id), eq(roomMembers.userId, userId)))
        .limit(1);
      if (!member) throw new ForbiddenException('Necesitás ser admitido para unirte a esta sala');
    }
    await this.db
      .insert(roomMembers)
      .values({ roomId: room.id, userId, role: 'participante' })
      .onConflictDoNothing();
  }

  async listMembers(code: string): Promise<RoomMemberView[]> {
    const room = await this.getByCodeOrThrow(code);
    return this.db
      .select({ userId: users.id, name: users.name, role: roomMembers.role })
      .from(roomMembers)
      .innerJoin(users, eq(roomMembers.userId, users.id))
      .where(eq(roomMembers.roomId, room.id));
  }

  async getMemberRole(code: string, userId: string): Promise<RoomRole | undefined> {
    const room = await this.getByCodeOrThrow(code);
    const [member] = await this.db
      .select({ role: roomMembers.role })
      .from(roomMembers)
      .where(and(eq(roomMembers.roomId, room.id), eq(roomMembers.userId, userId)))
      .limit(1);
    return member?.role;
  }

  async setMemberRole(
    code: string,
    targetUserId: string,
    role: 'colaborador' | 'participante',
  ): Promise<void> {
    const room = await this.getByCodeOrThrow(code);
    const [target] = await this.db
      .select({ role: roomMembers.role })
      .from(roomMembers)
      .where(and(eq(roomMembers.roomId, room.id), eq(roomMembers.userId, targetUserId)))
      .limit(1);

    if (!target) {
      throw new NotFoundException('Esa persona todavía no es parte de la sala');
    }
    if (target.role === 'administrador') {
      throw new ForbiddenException('No se puede cambiar el rol del administrador de la sala');
    }

    await this.db
      .update(roomMembers)
      .set({ role })
      .where(and(eq(roomMembers.roomId, room.id), eq(roomMembers.userId, targetUserId)));

    this.roomEvents.emitMemberRoleChanged({ roomCode: code });
  }

  async getRoomNotes(code: string) {
    const room = await this.getByCodeOrThrow(code);
    const [note] = await this.db
      .select()
      .from(roomNotes)
      .where(eq(roomNotes.roomId, room.id))
      .limit(1);
    return note ?? { roomId: room.id, content: '', revision: 0, updatedAt: new Date() };
  }

  async saveRoomNotes(code: string, content: string, revision: number) {
    const room = await this.getByCodeOrThrow(code);
    // La revisión 0 representa una nota todavía inexistente. Tanto la
    // creación como la actualización rechazan atómicamente copias antiguas.
    const [note] =
      revision === 0
        ? await this.db
            .insert(roomNotes)
            .values({ roomId: room.id, content, revision: 1, updatedAt: new Date() })
            .onConflictDoNothing()
            .returning()
        : await this.db
            .update(roomNotes)
            .set({ content, revision: revision + 1, updatedAt: new Date() })
            .where(and(eq(roomNotes.roomId, room.id), eq(roomNotes.revision, revision)))
            .returning();
    if (!note) throw new ConflictException('Otra persona actualizó las notas de la sala');
    return note;
  }
}

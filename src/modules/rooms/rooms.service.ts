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
import {
  roomMembers,
  roomNotes,
  roomScheduleSlots,
  rooms,
  users,
  type Room,
  type RoomRole,
} from '../../db/schema';
import type { CreateScheduleSlotDto } from './dto/create-schedule-slot.dto';
import { RoomEventsService } from './room-events.service';
import { RoomResolverService } from './room-resolver.service';

export interface RoomMemberView {
  userId: string;
  name: string;
  role: RoomRole;
}

export interface CreateRoomOptions {
  isPermanent?: boolean;
  slots?: CreateScheduleSlotDto[];
}

const CREATE_ROOM_MAX_ATTEMPTS = 5;

@Injectable()
export class RoomsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly roomEvents: RoomEventsService,
    private readonly resolver: RoomResolverService,
  ) {}

  async createRoom(
    name: string,
    creatorId: string,
    options: CreateRoomOptions = {},
  ): Promise<Room> {
    const isPermanent = options.isPermanent ?? false;
    const slots = options.slots ?? [];

    return this.db.transaction(async (tx) => {
      // D2: the sweep must run before the collision probe, in the SAME
      // transaction -- a room that becomes eligible for retirement right
      // now must free its code for THIS creation, not the next one.
      await this.resolver.retireExpired(tx);

      // Reintenta si el código generado choca con uno existente (muy poco probable).
      for (let attempt = 0; attempt < CREATE_ROOM_MAX_ATTEMPTS; attempt++) {
        const code = generateRoomCode();
        const occupant = await this.resolver.findPoolOccupant(code, tx);
        if (occupant) continue;

        const [room] = await tx
          .insert(rooms)
          .values({
            name,
            code,
            isPermanent,
            // 3.4: explicit, since the column default is false -- without
            // this a permanent room would momentarily allow free entry.
            ...(isPermanent ? { waitingRoomEnabled: true } : {}),
          })
          .returning();
        await tx
          .insert(roomMembers)
          .values({ roomId: room.id, userId: creatorId, role: 'administrador' });
        if (slots.length > 0) {
          await tx
            .insert(roomScheduleSlots)
            .values(slots.map((slot) => ({ ...slot, roomId: room.id })));
        }
        return room;
      }
      throw new Error('No se pudo generar un código de sala único, intenta de nuevo.');
    });
  }

  // No es joinability: es "¿sigue este código en el pool?" (D2/D3). El
  // único resto del codebase, fuera de RoomResolverService, con razón
  // legítima para preguntar algo sobre `rooms` por código -- por eso
  // delega en el resolver en vez de consultar `rooms` acá (tasks.md 2.22).
  async findByCode(code: string): Promise<Room | undefined> {
    return this.resolver.findPoolOccupant(code);
  }

  async getByCodeOrThrow(code: string): Promise<Room> {
    return this.resolver.resolveJoinable(code);
  }

  async joinRoom(code: string, userId: string): Promise<void> {
    const room = await this.getByCodeOrThrow(code);
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
    // D5: "entrada" -- una cuenta uniéndose a la sala. Rolling 24h window.
    await this.resolver.touchEntry(room.id);
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
    return this.getRoomNotesById(room.id);
  }

  async getRoomNotesById(roomId: string) {
    const [note] = await this.db
      .select()
      .from(roomNotes)
      .where(eq(roomNotes.roomId, roomId))
      .limit(1);
    return note ?? { roomId, content: '', revision: 0, updatedAt: new Date() };
  }

  async saveRoomNotes(code: string, content: string, revision: number) {
    const room = await this.getByCodeOrThrow(code);
    return this.saveRoomNotesById(room.id, content, revision);
  }

  async saveRoomNotesById(roomId: string, content: string, revision: number) {
    // La revisión 0 representa una nota todavía inexistente. Tanto la
    // creación como la actualización rechazan atómicamente copias antiguas.
    const [note] =
      revision === 0
        ? await this.db
            .insert(roomNotes)
            .values({ roomId, content, revision: 1, updatedAt: new Date() })
            .onConflictDoNothing()
            .returning()
        : await this.db
            .update(roomNotes)
            .set({ content, revision: revision + 1, updatedAt: new Date() })
            .where(and(eq(roomNotes.roomId, roomId), eq(roomNotes.revision, revision)))
            .returning();
    if (!note) throw new ConflictException('Otra persona actualizó las notas de la sala');
    return note;
  }
}

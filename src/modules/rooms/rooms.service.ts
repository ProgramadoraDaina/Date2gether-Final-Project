import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { generateRoomCode } from '../../common/generate-room-code';
import { DRIZZLE, DrizzleDb } from '../../db/drizzle.module';
import {
  roomAdmissionRequests,
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
import { nextOccurrence, type ScheduleSlot } from './schedule/next-occurrence';

export interface RoomMemberView {
  userId: string;
  name: string;
  role: RoomRole;
  isOwner: boolean;
}

export interface CreateRoomOptions {
  isPermanent?: boolean;
  slots?: CreateScheduleSlotDto[];
}

export interface OwnedRoomView {
  id: string;
  code: string;
  name: string;
  isPermanent: boolean;
  hiddenFromMyRooms: boolean;
  isJoinable: boolean;
  createdAt: Date;
  lastEnteredAt: Date;
  slots: ScheduleSlot[];
  nextOccurrenceAt: string | null;
}

const CREATE_ROOM_MAX_ATTEMPTS = 5;
const TEMPORARY_ROOM_WINDOW_MS = 24 * 60 * 60 * 1000;

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
        await tx.insert(roomMembers).values({
          roomId: room.id,
          userId: creatorId,
          role: 'administrador',
          isOwner: true,
        });
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

  // Incluye las salas creadas y las heredadas al recibir el rol de administrador.
  async listOwnedRooms(userId: string, now: Date = new Date()): Promise<OwnedRoomView[]> {
    const owned = await this.db
      .select({
        id: rooms.id,
        code: rooms.code,
        name: rooms.name,
        isPermanent: rooms.isPermanent,
        hiddenFromMyRooms: roomMembers.hiddenFromMyRooms,
        createdAt: rooms.createdAt,
        lastEnteredAt: rooms.lastEnteredAt,
      })
      .from(roomMembers)
      .innerJoin(rooms, eq(rooms.id, roomMembers.roomId))
      .where(
        and(
          eq(roomMembers.userId, userId),
          eq(roomMembers.role, 'administrador'),
          isNull(rooms.retiredAt),
        ),
      )
      .orderBy(desc(rooms.isPermanent), desc(rooms.lastEnteredAt));
    if (owned.length === 0) return [];

    const slotRows = await this.db
      .select({
        roomId: roomScheduleSlots.roomId,
        dayOfWeek: roomScheduleSlots.dayOfWeek,
        timeOfDay: roomScheduleSlots.timeOfDay,
        timezone: roomScheduleSlots.timezone,
      })
      .from(roomScheduleSlots)
      .where(
        inArray(
          roomScheduleSlots.roomId,
          owned.map((room) => room.id),
        ),
      )
      .orderBy(asc(roomScheduleSlots.dayOfWeek), asc(roomScheduleSlots.timeOfDay));

    return owned.map((room) => {
      const slots = slotRows
        .filter((slot) => slot.roomId === room.id)
        .map(({ dayOfWeek, timeOfDay, timezone }) => ({ dayOfWeek, timeOfDay, timezone }));
      const next = slots.length > 0 ? nextOccurrence(slots, now) : null;
      return {
        ...room,
        isJoinable:
          room.isPermanent ||
          room.lastEnteredAt.getTime() > now.getTime() - TEMPORARY_ROOM_WINDOW_MS,
        slots,
        nextOccurrenceAt: next ? next.toISOString() : null,
      };
    });
  }

  async setMyRoomVisibility(roomId: string, userId: string, hidden: boolean): Promise<void> {
    const [membership] = await this.db
      .update(roomMembers)
      .set({ hiddenFromMyRooms: hidden })
      .where(
        and(
          eq(roomMembers.roomId, roomId),
          eq(roomMembers.userId, userId),
          eq(roomMembers.role, 'administrador'),
        ),
      )
      .returning({ roomId: roomMembers.roomId });
    if (!membership) throw new NotFoundException('No se encontró la sala en tu lista');
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
      .select({
        userId: users.id,
        name: users.name,
        role: roomMembers.role,
        isOwner: roomMembers.isOwner,
      })
      .from(roomMembers)
      .innerJoin(users, eq(roomMembers.userId, users.id))
      .where(eq(roomMembers.roomId, room.id));
  }

  async isRoomOwner(code: string, userId: string): Promise<boolean> {
    const room = await this.getByCodeOrThrow(code);
    const [member] = await this.db
      .select({ isOwner: roomMembers.isOwner })
      .from(roomMembers)
      .where(and(eq(roomMembers.roomId, room.id), eq(roomMembers.userId, userId)))
      .limit(1);
    return member?.isOwner ?? false;
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
    role: RoomRole,
    requestedByUserId: string,
  ): Promise<void> {
    const changed = await this.db.transaction(async (tx) => {
      // Serializa los cambios de rol para no quitar dos últimos admins a la vez.
      const room = await this.resolver.lockJoinable(tx, code);
      const members = await tx
        .select({
          userId: roomMembers.userId,
          role: roomMembers.role,
          isOwner: roomMembers.isOwner,
        })
        .from(roomMembers)
        .where(eq(roomMembers.roomId, room.id));
      // El guard pudo autorizar la petición antes de que otro admin le quitara el rol.
      if (members.find((member) => member.userId === requestedByUserId)?.role !== 'administrador') {
        throw new ForbiddenException('Tu rol en la sala no permite esta acción');
      }
      const target = members.find((member) => member.userId === targetUserId);
      if (!target) {
        throw new NotFoundException('Esa persona todavía no es parte de la sala');
      }
      if (target.role === role) return false;
      if (target.isOwner) {
        throw new ForbiddenException('No se pueden quitar los permisos del propietario de la sala');
      }
      if (
        target.role === 'administrador' &&
        members.filter((member) => member.role === 'administrador').length === 1
      ) {
        throw new ForbiddenException('La sala debe conservar al menos un administrador');
      }
      await tx
        .update(roomMembers)
        .set({ role })
        .where(and(eq(roomMembers.roomId, room.id), eq(roomMembers.userId, targetUserId)));
      return true;
    });
    if (changed) this.roomEvents.emitMemberRoleChanged({ roomCode: code });
  }

  // Vale para cualquier sala (temporal o permanente). La autorización por rol de
  // administrador la resuelve RoomRolesGuard en el controller.
  async renameRoom(code: string, name: string): Promise<void> {
    const room = await this.getByCodeOrThrow(code);
    // Si la sala se borró entre la resolución y el UPDATE, no se responde 204 en falso.
    const updated = await this.db
      .update(rooms)
      .set({ name })
      .where(eq(rooms.id, room.id))
      .returning({ id: rooms.id });
    if (updated.length === 0) {
      throw new NotFoundException(`No existe una sala con el código "${code}"`);
    }
  }

  // Promoción temporal -> permanente, solo hacia adelante (D5/D7 revisado): la sala deja de
  // vencer y su código queda reservado para siempre. No hay camino inverso.
  // - Liveness: lockJoinable reusa el mismo predicado que el resto del tráfico (no retirada Y
  //   permanente o con ingreso en las últimas 24h). El retiro es perezoso (retireExpired solo
  //   corre al crear salas), así que una sala vencida puede tener retiredAt nulo todavía: acá
  //   se la trata como inexistente (404) igual que en el resto de endpoints.
  // - El bloqueo de fila (FOR UPDATE) serializa contra el barrido de retiro y contra otra
  //   promoción concurrente.
  // - Una sala permanente exige sala de espera siempre, por eso se fuerza en la misma sentencia.
  // - Las solicitudes de admisión pendientes dejan de vencer (expiresAt = NULL, igual que las
  //   que nacen en una sala permanente). El ticket JWT ya emitido conserva su propio exp: la
  //   verificación del ticket no mira la columna.
  // - Idempotente: si ya es permanente devuelve la sala sin escribir ni emitir el evento.
  async promoteToPermanent(code: string, userId: string): Promise<Room> {
    const { room, changed } = await this.db.transaction(async (tx) => {
      const locked = await this.resolver.lockJoinable(tx, code);
      await this.assertRoomAdmin(
        tx,
        locked.id,
        userId,
        'Solo el administrador de la sala puede hacerla permanente',
      );
      if (locked.isPermanent) return { room: locked, changed: false };
      const [promoted] = await tx
        .update(rooms)
        .set({ isPermanent: true, waitingRoomEnabled: true })
        .where(eq(rooms.id, locked.id))
        .returning();
      await tx
        .update(roomAdmissionRequests)
        .set({ expiresAt: null })
        .where(
          and(
            eq(roomAdmissionRequests.roomId, locked.id),
            eq(roomAdmissionRequests.status, 'pending'),
          ),
        );
      return { room: promoted, changed: true };
    });
    // Después del commit: los sockets conectados refrescan la info de la sala.
    if (changed) this.roomEvents.emitRoomPromoted({ roomCode: room.code, roomId: room.id });
    return room;
  }

  // Autorización compartida por las operaciones que solo puede hacer el administrador de la sala.
  private async assertRoomAdmin(
    executor: Pick<DrizzleDb, 'select'>,
    roomId: string,
    userId: string,
    notAdminMessage: string,
  ): Promise<void> {
    const [member] = await executor
      .select({ role: roomMembers.role })
      .from(roomMembers)
      .where(and(eq(roomMembers.roomId, roomId), eq(roomMembers.userId, userId)))
      .limit(1);
    if (!member) {
      throw new ForbiddenException('No sos parte de esta sala');
    }
    if (member.role !== 'administrador') {
      throw new ForbiddenException(notAdminMessage);
    }
  }

  // Borra la sala y, por ON DELETE CASCADE, todo lo que cuelga de ella (miembros, mensajes,
  // notas, solicitudes de admisión, horarios, playlist, emojis, transcripción, identidades de
  // llamada). call_sessions.room_id es SET NULL: el historial de llamadas sobrevive sin sala.
  // Es una sola sentencia, así que es atómica; la transacción deja explícito el límite si
  // en el futuro se suman pasos. Busca por ocupación del pool (no por joinability): moderar
  // una sala vencida pero todavía no retirada también debe poder borrarla.
  async deleteRoom(code: string): Promise<void> {
    const room = await this.resolver.findPoolOccupant(code);
    if (!room) {
      throw new NotFoundException(`No existe una sala con el código "${code}"`);
    }
    await this.removeRoom(room);
  }

  // Borrado hecho por la propia gente de la sala: solo su administrador. No pasa por
  // RoomRolesGuard porque ese guard resuelve la sala por "joinable" y respondería 404 para
  // las salas vencidas que /rooms/mine igual lista (y que sí se deben poder limpiar).
  async deleteRoomAsAdmin(code: string, userId: string): Promise<void> {
    const room = await this.resolver.findPoolOccupant(code);
    if (!room) {
      throw new NotFoundException(`No existe una sala con el código "${code}"`);
    }
    await this.assertRoomAdmin(
      this.db,
      room.id,
      userId,
      'Solo el administrador de la sala puede borrarla',
    );
    await this.removeRoom(room);
  }

  private async removeRoom(room: Room): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(rooms).where(eq(rooms.id, room.id));
    });
    // Sockets conectados: el gateway los avisa y los desconecta.
    this.roomEvents.emitRoomDeleted({ roomCode: room.code });
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

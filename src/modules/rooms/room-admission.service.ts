import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, gt } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { DRIZZLE, type DrizzleDb } from '../../db/drizzle.module';
import { roomAdmissionRequests, roomMembers, rooms } from '../../db/schema';
import { RoomAccessService } from '../auth/room-access.service';
import type { UpdateAdmissionSettingsDto } from './dto/update-admission.dto';

type Transaction = Parameters<Parameters<DrizzleDb['transaction']>[0]>[0];
type RequestRow = typeof roomAdmissionRequests.$inferSelect;

@Injectable()
export class RoomAdmissionService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly access: RoomAccessService,
  ) {}

  private async lockRoom(tx: Transaction, code: string, requireActive = true) {
    const [room] = await tx.select().from(rooms).where(eq(rooms.code, code)).for('update');
    if (!room) throw new NotFoundException('No existe una sala con ese código');
    if (requireActive && !room.isActive) throw new ForbiddenException('La sala está cerrada');
    return room;
  }

  private async grant(
    tx: Transaction,
    code: string,
    row: Pick<RequestRow, 'id' | 'roomId' | 'name' | 'userId'>,
  ) {
    if (row.userId) {
      await tx
        .insert(roomMembers)
        .values({ roomId: row.roomId, userId: row.userId })
        .onConflictDoNothing();
    }
    return this.access.issueParticipant({
      kind: 'room-participant',
      sub: row.id,
      roomCode: code,
      name: row.name,
      ...(row.userId ? { userId: row.userId } : {}),
    });
  }

  async request(code: string, name: string, authorization?: string) {
    const userId = await this.access.authenticateAccount(authorization);
    return this.db.transaction(async (tx) => {
      const room = await this.lockRoom(tx, code);
      const [member] = userId
        ? await tx
            .select({ role: roomMembers.role })
            .from(roomMembers)
            .where(and(eq(roomMembers.roomId, room.id), eq(roomMembers.userId, userId)))
        : [];
      const admin = member?.role === 'administrador';
      if (room.entryLocked && !admin)
        throw new ForbiddenException('La sala no permite nuevos ingresos');
      const id = randomUUID();
      if (!room.waitingRoomEnabled || admin)
        return this.grant(tx, code, { id, roomId: room.id, name, userId: userId ?? null });

      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await tx
        .insert(roomAdmissionRequests)
        .values({ id, roomId: room.id, name, userId, expiresAt });
      return {
        status: 'pending' as const,
        requestId: id,
        ticket: await this.access.createAdmissionTicket(code, id),
      };
    });
  }

  private async ownRequest(tx: Transaction, code: string, id: string) {
    const room = await this.lockRoom(tx, code, false);
    const [request] = await tx
      .select()
      .from(roomAdmissionRequests)
      .where(and(eq(roomAdmissionRequests.id, id), eq(roomAdmissionRequests.roomId, room.id)));
    if (!request) throw new NotFoundException('La solicitud no existe o venció');
    return { room, request };
  }

  async status(code: string, id: string, ticket: string) {
    await this.access.verifyAdmissionTicket(ticket, code, id);
    return this.db.transaction(async (tx) => {
      const { room, request } = await this.ownRequest(tx, code, id);
      if (!room.isActive) return { status: 'cancelled' as const };
      if (request.expiresAt <= new Date()) return { status: 'expired' as const };
      if (request.status === 'pending' && !room.waitingRoomEnabled && !room.entryLocked) {
        await tx
          .update(roomAdmissionRequests)
          .set({ status: 'admitted' })
          .where(eq(roomAdmissionRequests.id, request.id));
        request.status = 'admitted';
      }
      if (request.status === 'admitted')
        return {
          status: 'admitted' as const,
          access: await this.grant(tx, code, request),
        };
      return { status: request.status, blocked: room.entryLocked };
    });
  }

  async cancel(code: string, id: string, ticket: string) {
    await this.access.verifyAdmissionTicket(ticket, code, id);
    return this.db.transaction(async (tx) => {
      const { request } = await this.ownRequest(tx, code, id);
      if (request.status === 'pending') {
        await tx
          .update(roomAdmissionRequests)
          .set({ status: 'cancelled' })
          .where(eq(roomAdmissionRequests.id, request.id));
      }
      return { status: request.status === 'pending' ? 'cancelled' : request.status };
    });
  }

  async list(code: string) {
    const [room] = await this.db.select().from(rooms).where(eq(rooms.code, code));
    if (!room) throw new NotFoundException('No existe una sala con ese código');
    const requests = await this.db
      .select({
        id: roomAdmissionRequests.id,
        name: roomAdmissionRequests.name,
        userId: roomAdmissionRequests.userId,
        createdAt: roomAdmissionRequests.createdAt,
      })
      .from(roomAdmissionRequests)
      .where(
        and(
          eq(roomAdmissionRequests.roomId, room.id),
          eq(roomAdmissionRequests.status, 'pending'),
          gt(roomAdmissionRequests.expiresAt, new Date()),
        ),
      )
      .orderBy(asc(roomAdmissionRequests.createdAt));
    return {
      waitingRoomEnabled: room.waitingRoomEnabled,
      entryLocked: room.entryLocked,
      requests: requests.map(({ userId, ...request }) => ({ ...request, registered: !!userId })),
    };
  }

  async configure(code: string, settings: UpdateAdmissionSettingsDto) {
    return this.db.transaction(async (tx) => {
      const room = await this.lockRoom(tx, code);
      const next = {
        waitingRoomEnabled: settings.waitingRoomEnabled ?? room.waitingRoomEnabled,
        entryLocked: settings.entryLocked ?? room.entryLocked,
      };
      await tx.update(rooms).set(next).where(eq(rooms.id, room.id));
      // Se conservan las decisiones anteriores. Desactivar la espera solo
      // admite solicitudes que todavía están pendientes y no vencieron.
      if (!next.waitingRoomEnabled && !next.entryLocked)
        await tx
          .update(roomAdmissionRequests)
          .set({ status: 'admitted' })
          .where(
            and(
              eq(roomAdmissionRequests.roomId, room.id),
              eq(roomAdmissionRequests.status, 'pending'),
              gt(roomAdmissionRequests.expiresAt, new Date()),
            ),
          );
      return next;
    });
  }

  async decide(code: string, id: string, decision: 'admitted' | 'rejected') {
    return this.db.transaction(async (tx) => {
      const { room, request } = await this.ownRequest(tx, code, id);
      if (!room.isActive) throw new ForbiddenException('La sala está cerrada');
      if (request.expiresAt <= new Date()) throw new ConflictException('La solicitud venció');
      if (request.status === decision) return { status: decision };
      if (request.status !== 'pending') throw new ConflictException('La solicitud ya fue resuelta');
      if (decision === 'admitted' && room.entryLocked)
        throw new ForbiddenException('Desbloqueá los ingresos antes de admitir');
      await tx
        .update(roomAdmissionRequests)
        .set({ status: decision })
        .where(eq(roomAdmissionRequests.id, id));
      return { status: decision };
    });
  }
}

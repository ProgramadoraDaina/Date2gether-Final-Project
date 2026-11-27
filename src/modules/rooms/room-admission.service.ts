import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, gt, isNull, or } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { DRIZZLE, type DrizzleDb } from '../../db/drizzle.module';
import { roomAdmissionRequests, roomMembers, rooms } from '../../db/schema';
import { RoomAccessService } from '../auth/room-access.service';
import type { UpdateAdmissionSettingsDto } from './dto/update-admission.dto';
import { RoomResolverService } from './room-resolver.service';

type Transaction = Parameters<Parameters<DrizzleDb['transaction']>[0]>[0];
type RequestRow = typeof roomAdmissionRequests.$inferSelect;

@Injectable()
export class RoomAdmissionService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly access: RoomAccessService,
    private readonly resolver: RoomResolverService,
  ) {}

  private lockRoom(tx: Transaction, code: string) {
    return this.resolver.lockJoinable(tx, code);
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
    // D5: "entrada" -- un pase de acceso fue emitido (el único momento de
    // entrada real para invitados y estudiantes admitidos).
    await this.resolver.touchEntry(row.roomId, tx);
    return this.access.issueParticipant({
      kind: 'room-participant',
      sub: row.id,
      roomId: row.roomId,
      roomCode: code,
      name: row.name,
      ...(row.userId ? { userId: row.userId } : {}),
    });
  }

  async request(code: string, name: string, authorization?: string) {
    const userId = await this.access.authenticateAccount(authorization);
    return this.db.transaction(async (tx) => {
      const room = await this.lockRoom(tx, code);
      if (userId && this.access.isRevoked(room.id, { userId })) {
        throw new ForbiddenException('Te expulsaron de esta sala');
      }
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

      // D7: una sala permanente nunca tiene TTL (NULL, nunca un centinela
      // lejano); el ticket JWT vive 365d en vez de 24h -- de lo contrario el
      // propio JWT vencería antes que la fila, y el cliente vería "expiró"
      // aunque la solicitud siguiera pending y decidible.
      const expiresAt = room.isPermanent ? null : new Date(Date.now() + 24 * 60 * 60 * 1000);
      await tx
        .insert(roomAdmissionRequests)
        .values({ id, roomId: room.id, name, userId, expiresAt });
      return {
        status: 'pending' as const,
        requestId: id,
        ticket: await this.access.createAdmissionTicket(room.id, id, {
          permanent: room.isPermanent,
        }),
      };
    });
  }

  private async ownRequest(tx: Transaction, code: string, id: string) {
    const room = await this.lockRoom(tx, code);
    const [request] = await tx
      .select()
      .from(roomAdmissionRequests)
      .where(and(eq(roomAdmissionRequests.id, id), eq(roomAdmissionRequests.roomId, room.id)));
    if (!request) throw new NotFoundException('La solicitud no existe o venció');
    return { room, request };
  }

  async status(code: string, id: string, ticket: string) {
    return this.db.transaction(async (tx) => {
      // El controlador ya no tiene el roomId de antemano (D4): primero se
      // resuelve la sala, y SOLO DESPUÉS se verifica el ticket contra su id.
      const { room, request } = await this.ownRequest(tx, code, id);
      await this.access.verifyAdmissionTicket(ticket, room.id, id);
      if (request.expiresAt && request.expiresAt <= new Date())
        return { status: 'expired' as const };
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
    return this.db.transaction(async (tx) => {
      const { room, request } = await this.ownRequest(tx, code, id);
      await this.access.verifyAdmissionTicket(ticket, room.id, id);
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
    const room = await this.resolver.resolveJoinable(code);
    const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
    const now = Date.now();
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
          // NULL = sin TTL (sala permanente): nunca vence por sí sola.
          or(
            isNull(roomAdmissionRequests.expiresAt),
            gt(roomAdmissionRequests.expiresAt, new Date()),
          ),
        ),
      )
      .orderBy(asc(roomAdmissionRequests.createdAt));
    return {
      waitingRoomEnabled: room.waitingRoomEnabled,
      entryLocked: room.entryLocked,
      // 5.8: el cliente necesita esto para OCULTAR (no solo deshabilitar)
      // el toggle de sala de espera en una sala permanente.
      isPermanent: room.isPermanent,
      // stale (D5): señal de solo lectura para salas sin TTL -- sin tope, sin
      // nueva columna, el filtro/orden es cosa del cliente.
      requests: requests.map(({ userId, createdAt, ...request }) => ({
        ...request,
        createdAt,
        registered: !!userId,
        stale: now - createdAt.getTime() > STALE_AFTER_MS,
      })),
    };
  }

  async configure(code: string, settings: UpdateAdmissionSettingsDto) {
    return this.db.transaction(async (tx) => {
      const room = await this.lockRoom(tx, code);
      // D5/D7 (revisado): isPermanent se declara al crear y solo puede pasar de false a
      // true por la promoción del administrador (PATCH /rooms/:code/permanent), nunca
      // de true a false; está ausente de este DTO. Una sala permanente exige admisión siempre:
      // no se puede desactivar la sala de espera, y queda forzada a true
      // aunque no se la pida explícitamente.
      if (room.isPermanent && settings.waitingRoomEnabled === false) {
        throw new ForbiddenException(
          'La sala de espera no se puede desactivar en una sala permanente',
        );
      }
      const next = {
        waitingRoomEnabled: room.isPermanent
          ? true
          : (settings.waitingRoomEnabled ?? room.waitingRoomEnabled),
        entryLocked: settings.entryLocked ?? room.entryLocked,
      };
      await tx.update(rooms).set(next).where(eq(rooms.id, room.id));
      // Se conservan las decisiones anteriores. Desactivar la espera solo
      // admite solicitudes que todavía están pendientes y no vencieron.
      // Para una sala permanente, next.waitingRoomEnabled es siempre true,
      // así que esta rama nunca corre (D7) -- pero su filtro igual admite
      // NULL por si la sala deja de ser permanente en una iteración futura.
      if (!next.waitingRoomEnabled && !next.entryLocked)
        await tx
          .update(roomAdmissionRequests)
          .set({ status: 'admitted' })
          .where(
            and(
              eq(roomAdmissionRequests.roomId, room.id),
              eq(roomAdmissionRequests.status, 'pending'),
              or(
                isNull(roomAdmissionRequests.expiresAt),
                gt(roomAdmissionRequests.expiresAt, new Date()),
              ),
            ),
          );
      return next;
    });
  }

  async decide(code: string, id: string, decision: 'admitted' | 'rejected') {
    return this.db.transaction(async (tx) => {
      const { room, request } = await this.ownRequest(tx, code, id);
      if (request.expiresAt && request.expiresAt <= new Date())
        throw new ConflictException('La solicitud venció');
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

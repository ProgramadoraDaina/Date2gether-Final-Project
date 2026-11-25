import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, gt, isNull, not, or, sql } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDb } from '../../db/drizzle.module';
import { callSessions, rooms, type Room } from '../../db/schema';
import { isBreakoutRoomName } from '../calls/call-group';

type Transaction = Parameters<Parameters<DrizzleDb['transaction']>[0]>[0];
type Executor = DrizzleDb | Transaction;

// Única línea del codebase (ver tasks.md 2.22, el gate de verificación)
// que compara la columna code de rooms contra un valor: joinableByCode y
// findPoolOccupant arman su WHERE a partir de esta misma expresión, para
// que la revisión mecánica tenga un solo punto que inspeccionar.
const byCode = (code: string) => eq(rooms.code, code);

const joinableByCode = (code: string) =>
  and(
    byCode(code),
    isNull(rooms.retiredAt),
    or(eq(rooms.isPermanent, true), gt(rooms.lastEnteredAt, sql`now() - interval '24 hours'`)),
  );

/**
 * The ONLY place in the codebase allowed to query `rooms` by code for live
 * traffic (see design.md D4). Everything downstream takes a roomId.
 */
@Injectable()
export class RoomResolverService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  async resolveJoinable(code: string): Promise<Room> {
    this.assertResolvableCode(code);
    const [room] = await this.db.select().from(rooms).where(joinableByCode(code)).limit(1);
    return this.assertJoinable(room, code, true);
  }

  async lockJoinable(
    tx: Transaction,
    code: string,
    opts?: { requireActive?: boolean },
  ): Promise<Room> {
    this.assertResolvableCode(code);
    const [room] = await tx.select().from(rooms).where(joinableByCode(code)).for('update');
    return this.assertJoinable(room, code, opts?.requireActive ?? true);
  }

  /**
   * Code-pool occupancy (D2/D3): "¿este código sigue reservado?", sin el
   * componente de tiempo de joinability -- una sala cerrada-pero-no-retirada
   * sigue ocupando su código (D1). Único consumidor hoy: el probe de
   * colisión de createRoom(); nunca para tráfico en vivo.
   */
  async findPoolOccupant(code: string, tx?: Transaction): Promise<Room | undefined> {
    this.assertResolvableCode(code);
    const executor: Executor = tx ?? this.db;
    const [room] = await executor
      .select()
      .from(rooms)
      .where(and(byCode(code), isNull(rooms.retiredAt)))
      .limit(1);
    return room;
  }

  /**
   * Guard contra nombres de mini sala (breakout-rooms/design.md D11): un
   * código que contiene el separador de mini sala nunca es resoluble como
   * código de sala -- 404, no 400, para no revelarle a nadie el esquema
   * interno de nombres (mismo criterio que la autorización de la línea de
   * tiempo). El rechazo va en este resolver, el único choke point que ya
   * garantiza ser "the ONLY place in the codebase allowed to query `rooms`
   * by code for live traffic": un consumidor nuevo hereda la guarda sin
   * tener que acordarse de ella.
   */
  private assertResolvableCode(code: string): void {
    if (isBreakoutRoomName(code)) {
      throw new NotFoundException(`No existe una sala con el código "${code}"`);
    }
  }

  private assertJoinable(room: Room | undefined, code: string, requireActive: boolean): Room {
    if (!room) throw new NotFoundException(`No existe una sala con el código "${code}"`);
    if (requireActive && !room.isActive) throw new ForbiddenException('La sala está cerrada');
    return room;
  }

  /** Throws 403 when the token's roomId is not this room's. */
  assertBound(participant: { roomId: string }, room: Pick<Room, 'id'>): void {
    if (participant.roomId !== room.id) {
      throw new ForbiddenException('El acceso pertenece a otra sala');
    }
  }

  async getById(roomId: string): Promise<Room | undefined> {
    const [room] = await this.db.select().from(rooms).where(eq(rooms.id, roomId)).limit(1);
    return room;
  }

  async touchEntry(roomId: string, tx?: Transaction): Promise<void> {
    const executor: Executor = tx ?? this.db;
    await executor.update(rooms).set({ lastEnteredAt: new Date() }).where(eq(rooms.id, roomId));
  }

  /**
   * Allocation-time retirement sweep (design.md D2). Deliberately only run
   * from createRoom()'s own transaction, right before the code-collision
   * probe — the only moment retired_at must be accurate.
   */
  async retireExpired(tx: Transaction): Promise<void> {
    await tx
      .update(rooms)
      .set({ retiredAt: sql`now()` })
      .where(
        and(
          isNull(rooms.retiredAt),
          eq(rooms.isPermanent, false),
          eq(rooms.isActive, true),
          sql`${rooms.lastEnteredAt} < now() - interval '24 hours'`,
          not(
            sql`exists (select 1 from ${callSessions} cs where cs.room_id = ${rooms.id} and cs.ended_at is null and cs.forced_close_at is null)`,
          ),
        ),
      );
  }
}

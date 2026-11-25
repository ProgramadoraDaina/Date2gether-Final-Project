import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { DRIZZLE, type DrizzleDb } from '../../db/drizzle.module';
import { callBreakoutRooms } from '../../db/schema';
import { buildCallGroupRoomNames, parseBreakoutRoomName, type OpenBreakout } from './call-group';

/**
 * El núcleo de seguridad del cambio (design.md D1/D6). Envoltorio con IO
 * sobre la función pura de `call-group.ts`: la decisión de "qué entra y qué
 * no entra en el grupo ahora" vive en `buildCallGroupRoomNames`, acá solo se
 * resuelve la consulta indexada que la alimenta.
 */
@Injectable()
export class CallGroupResolverService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  /**
   * Devuelve [roomCode] cuando el grupo no tiene mini salas abiertas y no
   * vencidas -- SIN excepción y SIN depender de ninguna configuración.
   * roomId null (sesión sin correlación de identity conocida) también
   * degenera a [roomCode], sin consultar nada.
   */
  async resolveCallGroupRoomNames(roomId: string | null, roomCode: string): Promise<string[]> {
    if (!roomId) return [roomCode];
    const openBreakouts = await this.fetchOpenBreakouts(roomId);
    return buildCallGroupRoomNames(roomCode, openBreakouts, new Date()).names;
  }

  /**
   * Mini sala -> ancla padre. Un código sin '::' se devuelve tal cual, SIN
   * consultar nada (D6). Un código con '::' que no corresponde a ninguna
   * mini sala conocida degrada al mismo resultado -- sin efecto de negocio
   * distinto al de una sala no reconocida (spec webhook-ingestion/roomCode-sin-grupo).
   */
  async resolveGroupAnchor(
    livekitRoomSid: string,
    roomCode: string,
  ): Promise<{ parentSid: string; parentCode: string }> {
    const parsed = parseBreakoutRoomName(roomCode);
    if (!parsed) return { parentSid: livekitRoomSid, parentCode: roomCode };

    const [row] = await this.db
      .select({ parentLivekitRoomSid: callBreakoutRooms.parentLivekitRoomSid })
      .from(callBreakoutRooms)
      .where(eq(callBreakoutRooms.livekitRoomName, roomCode))
      .limit(1);

    if (!row?.parentLivekitRoomSid) return { parentSid: livekitRoomSid, parentCode: roomCode };
    return { parentSid: row.parentLivekitRoomSid, parentCode: parsed.parentCode };
  }

  /** Misma consulta, otra proyección: filas abiertas con auto_close_at vencido. */
  async findExpiredBreakouts(roomId: string): Promise<OpenBreakout[]> {
    const openBreakouts = await this.fetchOpenBreakouts(roomId);
    // El roomCode no importa para esta proyección -- buildCallGroupRoomNames
    // solo lo usa para el primer elemento de `names`, que acá se descarta.
    return buildCallGroupRoomNames('', openBreakouts, new Date()).expired;
  }

  private async fetchOpenBreakouts(roomId: string): Promise<OpenBreakout[]> {
    return this.db
      .select({
        id: callBreakoutRooms.id,
        livekitRoomName: callBreakoutRooms.livekitRoomName,
        autoCloseAt: callBreakoutRooms.autoCloseAt,
      })
      .from(callBreakoutRooms)
      .where(and(eq(callBreakoutRooms.roomId, roomId), isNull(callBreakoutRooms.closedAt)));
  }
}

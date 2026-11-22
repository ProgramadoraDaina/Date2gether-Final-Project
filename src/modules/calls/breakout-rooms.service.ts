import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import { randomUUID } from 'node:crypto';
import type { RoomParticipant } from '../auth/room-access.service';
import { DRIZZLE, type DrizzleDb } from '../../db/drizzle.module';
import {
  callBreakoutOccupants,
  callBreakoutRooms,
  callParticipantIdentities,
  roomMembers,
  type CallBreakoutRoom,
  type RoomRole,
} from '../../db/schema';
import { buildBreakoutRoomName, parseBreakoutRoomName } from './call-group';
import { CallGroupResolverService } from './call-group-resolver.service';

export type LeavePolicy = 'locked' | 'free_return';

const DEFAULT_LEAVE_POLICY: LeavePolicy = 'locked';
const BREAKOUT_EMPTY_TIMEOUT_SECONDS = 300;
const BREAKOUT_DEPARTURE_TIMEOUT_SECONDS = 30;

// Código estable, mismo precedente que NO_HOST_CONNECTED_CODE en
// calls.service.ts: el cliente se acopla al código, nunca al texto (design.md D8).
export const BREAKOUT_RETURN_LOCKED_CODE = 'BREAKOUT_RETURN_LOCKED';
const BREAKOUT_RETURN_LOCKED_MESSAGE = 'El host te va a devolver a la sala principal.';

export interface BreakoutRoomOccupantView {
  livekitIdentity: string;
  displayName: string;
  userId: string | null;
}

export interface BreakoutRoomView {
  id: string;
  livekitRoomName: string;
  label: string;
  leavePolicy: LeavePolicy;
  autoCloseAt: Date | null;
  occupants: BreakoutRoomOccupantView[];
}

export interface CreateBreakoutRoomInput {
  label?: string;
  leavePolicy?: LeavePolicy;
  autoCloseInMinutes?: number;
}

export interface UpdateBreakoutRoomInput {
  leavePolicy?: LeavePolicy;
  autoCloseInMinutes?: number | null;
}

type BreakoutRow = Pick<CallBreakoutRoom, 'id' | 'livekitRoomName'>;

/**
 * Ciclo de vida de mini salas (design.md, sección "BreakoutRoomsService").
 * Construido encima de las mismas primitivas ya probadas en producción que
 * usa CallsService/CallSessionCloseService: createRoom, AccessToken,
 * listParticipants, listRooms, deleteRoom.
 */
@Injectable()
export class BreakoutRoomsService {
  private readonly logger = new Logger(BreakoutRoomsService.name);
  // Atajo en proceso del cierre por autoCloseAt (D10): la garantía real es
  // reconcileGroup(), perezosa y persistida; este Map solo adelanta el
  // teardown cuando el proceso sigue vivo.
  private readonly autoCloseTimers = new Map<string, NodeJS.Timeout>();
  private readonly client: RoomServiceClient;

  constructor(
    private readonly config: ConfigService,
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly groupResolver: CallGroupResolverService,
  ) {
    const wsUrl = config.get<string>('LIVEKIT_URL') ?? '';
    const apiUrl = config.get<string>('LIVEKIT_API_URL') || wsUrl.replace(/^ws/, 'http');
    this.client = new RoomServiceClient(
      apiUrl,
      config.get<string>('LIVEKIT_API_KEY', ''),
      config.get<string>('LIVEKIT_API_SECRET', ''),
    );
  }

  /**
   * 503 si MAX_BREAKOUT_ROOMS no es un entero en 0..3 (fail-fast, mismo
   * patrón que MAX_ROOM_PARTICIPANTS en calls.service.ts). 403 si el
   * solicitante no es administrador. 409 si el tope ya está alcanzado.
   */
  async create(
    roomId: string,
    roomCode: string,
    actor: RoomParticipant,
    dto: CreateBreakoutRoomInput,
  ): Promise<BreakoutRoomView> {
    const role = await this.resolveRole(roomId, actor.userId);
    if (role !== 'administrador') {
      throw new ForbiddenException('Solo un administrador puede crear mini salas');
    }

    const max = this.resolveMaxBreakoutRooms();
    const openRows = await this.fetchOpenRows(roomId);
    if (openRows.length >= max) {
      throw new ConflictException('Alcanzaste el máximo de mini salas simultáneas');
    }

    const usedIndexes = new Set(
      openRows
        .map((row) => parseBreakoutRoomName(row.livekitRoomName)?.index)
        .filter((index): index is number => index !== undefined),
    );

    const [parentRoom] = await this.client.listRooms([roomCode]);
    const parentLivekitRoomSid = parentRoom?.sid ?? null;
    const autoCloseAt = this.resolveAutoCloseAt(dto.autoCloseInMinutes);
    const leavePolicy = dto.leavePolicy ?? DEFAULT_LEAVE_POLICY;

    for (let index = 1; index <= max; index++) {
      if (usedIndexes.has(index)) continue;
      const livekitRoomName = buildBreakoutRoomName(roomCode, index);
      try {
        const [row] = await this.db
          .insert(callBreakoutRooms)
          .values({
            roomId,
            livekitRoomName,
            parentLivekitRoomSid,
            label: dto.label ?? `Mini sala ${index}`,
            leavePolicy,
            autoCloseAt,
          })
          .returning();

        await this.client.createRoom({
          name: livekitRoomName,
          maxParticipants: this.resolveMaxParticipants(),
          emptyTimeout: BREAKOUT_EMPTY_TIMEOUT_SECONDS,
          departureTimeout: BREAKOUT_DEPARTURE_TIMEOUT_SECONDS,
        });
        this.scheduleAutoClose(row.id, row.livekitRoomName, row.autoCloseAt);
        return this.toView(row, []);
      } catch {
        // Carrera de slot (unique(livekit_room_name) violado por otra
        // creación simultánea del mismo índice): reintenta con N+1.
        continue;
      }
    }
    throw new ConflictException('No se pudo crear la mini sala, intentá nuevamente');
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async list(roomId: string, actor: RoomParticipant): Promise<BreakoutRoomView[]> {
    const rows = await this.fetchOpenRows(roomId);
    if (rows.length === 0) return [];
    const occupants = await this.fetchOccupantsByBreakoutIds(rows.map((row) => row.id));
    return rows.map((row) =>
      this.toView(
        row,
        occupants.filter((occupant) => occupant.breakoutRoomId === row.id),
      ),
    );
  }

  async updatePolicy(
    breakoutId: string,
    roomId: string,
    actor: RoomParticipant,
    dto: UpdateBreakoutRoomInput,
  ): Promise<BreakoutRoomView> {
    const role = await this.resolveRole(roomId, actor.userId);
    if (role !== 'administrador') {
      throw new ForbiddenException(
        'Solo un administrador puede cambiar la política de una mini sala',
      );
    }
    const row = await this.getOpenRowOrThrow(breakoutId, roomId);

    const patch: Partial<Pick<CallBreakoutRoom, 'leavePolicy' | 'autoCloseAt'>> = {};
    if (dto.leavePolicy) patch.leavePolicy = dto.leavePolicy;
    if (dto.autoCloseInMinutes !== undefined) {
      patch.autoCloseAt =
        dto.autoCloseInMinutes === null ? null : this.resolveAutoCloseAt(dto.autoCloseInMinutes);
    }

    const [updated] = await this.db
      .update(callBreakoutRooms)
      .set(patch)
      .where(eq(callBreakoutRooms.id, row.id))
      .returning();
    this.scheduleAutoClose(updated.id, updated.livekitRoomName, updated.autoCloseAt);

    const occupants = await this.fetchOccupantsByBreakoutIds([updated.id]);
    return this.toView(updated, occupants);
  }

  /**
   * Admin: traslada a un occupant. Valida rol, pertenencia al grupo y
   * capacidad del destino. Escribe la identity nueva (D7) y la asignación
   * ANTES de desconectar de la principal -- si el cliente nunca pide el
   * token (issueBreakoutToken), la asignación abierta queda registrada y es
   * recuperable (mitigación "participante varado", design.md Flujo 1).
   */
  async moveIn(
    breakoutId: string,
    roomId: string,
    actor: RoomParticipant,
    target: { livekitIdentity: string },
  ): Promise<{ targetIdentity: string }> {
    const role = await this.resolveRole(roomId, actor.userId);
    if (role !== 'administrador') {
      throw new ForbiddenException('Solo un administrador puede trasladar participantes');
    }

    const breakout = await this.getOpenRowOrThrow(breakoutId);
    if (breakout.roomId !== roomId) {
      throw new ForbiddenException('La mini sala no pertenece a este grupo');
    }

    const participants = await this.client.listParticipants(breakout.livekitRoomName);
    if (participants.length >= this.resolveMaxParticipants()) {
      throw new ConflictException('Esa mini sala ya está en su capacidad máxima');
    }

    const [sourceIdentity] = await this.db
      .select({
        roomId: callParticipantIdentities.roomId,
        userId: callParticipantIdentities.userId,
        displayName: callParticipantIdentities.displayName,
        roleAtIssue: callParticipantIdentities.roleAtIssue,
      })
      .from(callParticipantIdentities)
      .where(eq(callParticipantIdentities.livekitIdentity, target.livekitIdentity))
      .limit(1);
    if (!sourceIdentity) {
      throw new NotFoundException('No se encontró a ese participante en la sala');
    }

    const newIdentity = randomUUID();
    await this.db.insert(callParticipantIdentities).values({
      livekitIdentity: newIdentity,
      roomId: sourceIdentity.roomId,
      userId: sourceIdentity.userId,
      displayName: sourceIdentity.displayName,
      roleAtIssue: sourceIdentity.roleAtIssue,
    });
    await this.db.insert(callBreakoutOccupants).values({
      breakoutRoomId: breakout.id,
      sourceIdentity: target.livekitIdentity,
      livekitIdentity: newIdentity,
      userId: sourceIdentity.userId,
      displayName: sourceIdentity.displayName,
    });

    const parentCode = parseBreakoutRoomName(breakout.livekitRoomName)?.parentCode;
    if (parentCode) {
      await this.client.removeParticipant(parentCode, target.livekitIdentity);
    }

    return { targetIdentity: newIdentity };
  }

  /**
   * Token de la mini sala: para quien tiene una asignación abierta, o para
   * un admin del grupo sin asignación (monitoreo). Único punto de emisión
   * de token además de join() (D12: el token nunca viaja por el socket).
   */
  async issueBreakoutToken(
    breakoutId: string,
    roomId: string,
    requester: RoomParticipant,
  ): Promise<{ url: string; token: string; roomName: string; participantLimit: number }> {
    const breakout = await this.getOpenRowOrThrow(breakoutId, roomId);
    const role = await this.resolveRole(roomId, requester.userId);
    const occupant = await this.findOpenOccupantBySource(breakout.id, requester.sub);

    if (!occupant && role !== 'administrador') {
      throw new ForbiddenException('No tenés una asignación en esta mini sala');
    }

    const { url, apiKey, apiSecret } = this.resolveLiveKitConfig();
    const identity = occupant?.livekitIdentity ?? requester.sub;
    const name = occupant?.displayName ?? requester.name;

    const access = new AccessToken(apiKey, apiSecret, { identity, name, ttl: '15m' });
    access.addGrant({
      room: breakout.livekitRoomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      roomAdmin: false,
      roomRecord: false,
    });

    return {
      url,
      token: await access.toJwt(),
      roomName: breakout.livekitRoomName,
      participantLimit: this.resolveMaxParticipants(),
    };
  }

  /**
   * Autosalida (y retorno forzado por admin, extensión aditiva documentada
   * en apply-progress Fase 5): 403 BREAKOUT_RETURN_LOCKED si la política es
   * 'locked' y el solicitante no es admin. No emite token de la principal:
   * cierra la asignación; el cliente reusa join() (occupant) o el backend
   * desconecta de la mini sala (admin) para que el cliente afectado lo haga.
   *
   * `targetLivekitIdentity` solo se usa en el camino admin -- deviación
   * aditiva sobre el snippet abreviado de design.md: el contrato ahí no
   * modela explícitamente a QUIÉN devuelve el admin cuando no es a sí mismo.
   */
  async selfReturn(
    breakoutId: string,
    roomId: string,
    requester: RoomParticipant,
    targetLivekitIdentity?: string,
  ): Promise<void> {
    const breakout = await this.getOpenRowOrThrow(breakoutId, roomId);
    const role = await this.resolveRole(roomId, requester.userId);

    if (role === 'administrador') {
      if (!targetLivekitIdentity) {
        throw new BadRequestException('Falta indicar a quién devolver');
      }
      const occupant = await this.findOpenOccupantByLivekitIdentity(
        breakout.id,
        targetLivekitIdentity,
      );
      if (!occupant) {
        throw new NotFoundException(
          'Esa persona no tiene una asignación abierta en esta mini sala',
        );
      }
      await this.markOccupantReturned(occupant.id);
      try {
        await this.client.removeParticipant(breakout.livekitRoomName, targetLivekitIdentity);
      } catch {
        this.logger.log('El ocupante ya no estaba conectado a la mini sala');
      }
      return;
    }

    const occupant = await this.findOpenOccupantBySource(breakout.id, requester.sub);
    if (!occupant) {
      throw new ForbiddenException('No tenés una asignación abierta en esta mini sala');
    }
    if (breakout.leavePolicy === 'locked') {
      throw new ForbiddenException({
        message: BREAKOUT_RETURN_LOCKED_MESSAGE,
        code: BREAKOUT_RETURN_LOCKED_CODE,
      });
    }
    await this.markOccupantReturned(occupant.id);
  }

  /** Cierre manual: compare-and-set sobre closed_at + deleteRoom tolerante + cierre de asignaciones. */
  async close(
    breakoutId: string,
    roomId: string,
    actor: RoomParticipant | null,
    reason: 'manual' | 'auto' | 'cascade',
  ): Promise<void> {
    if (reason === 'manual') {
      const role = await this.resolveRole(roomId, actor?.userId);
      if (role !== 'administrador') {
        throw new ForbiddenException('Solo un administrador puede cerrar una mini sala');
      }
    }

    const [row] = await this.db
      .select()
      .from(callBreakoutRooms)
      .where(eq(callBreakoutRooms.id, breakoutId))
      .limit(1);
    if (!row) throw new NotFoundException('No existe esa mini sala');

    const outcome = await this.closeRow(row);
    if (outcome === 'already-closed') {
      throw new ConflictException('La mini sala ya estaba cerrada');
    }
  }

  async closeAll(roomId: string, actor: RoomParticipant): Promise<void> {
    const role = await this.resolveRole(roomId, actor.userId);
    if (role !== 'administrador') {
      throw new ForbiddenException('Solo un administrador puede cerrar todas las mini salas');
    }
    const rows = await this.fetchOpenRows(roomId);
    for (const row of rows) {
      await this.closeRow(row);
    }
  }

  /**
   * Cascada desde el cierre de la principal (design.md Flujo 3). Sin actor:
   * lo invoca el camino de cierre forzado. roomId null (grupo sin
   * correlación conocida) es un no-op -- nada que cerrar.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async closeGroupBreakouts(roomId: string | null, parentCode: string): Promise<void> {
    if (!roomId) return;
    const rows = await this.fetchOpenRows(roomId);
    for (const row of rows) {
      try {
        await this.closeRow(row);
      } catch {
        this.logger.log('No se pudo cerrar una mini sala durante la cascada');
      }
    }
  }

  /** Reconciliación perezosa (D10): cierra vencidas y marca las que LiveKit ya no tiene. Nunca tira. */
  async reconcileGroup(roomId: string): Promise<void> {
    try {
      const expired = await this.groupResolver.findExpiredBreakouts(roomId);
      for (const breakout of expired) {
        await this.closeRow({ id: breakout.id, livekitRoomName: breakout.livekitRoomName });
      }
    } catch {
      this.logger.warn('No se pudo reconciliar el grupo de mini salas');
    }
  }

  // --- internos ---------------------------------------------------------

  // Compare-and-set + cierre de asignaciones + deleteRoom tolerante (capa 3,
  // mismo patrón que CallSessionCloseService.claimAndClose). Usado por
  // close(), closeAll(), closeGroupBreakouts() y reconcileGroup() -- la
  // idempotencia de la cascada (0 deleteRoom nuevos en una repetición) sale
  // gratis: fetchOpenRows() ya no devuelve una fila que este método cerró.
  private async closeRow(row: BreakoutRow): Promise<'closed' | 'already-closed'> {
    const [claimed] = await this.db
      .update(callBreakoutRooms)
      .set({ closedAt: new Date() })
      .where(and(eq(callBreakoutRooms.id, row.id), isNull(callBreakoutRooms.closedAt)))
      .returning();
    if (!claimed) return 'already-closed';

    this.cancelAutoCloseTimer(row.id);
    await this.db
      .update(callBreakoutOccupants)
      .set({ returnedAt: new Date() })
      .where(
        and(
          eq(callBreakoutOccupants.breakoutRoomId, row.id),
          isNull(callBreakoutOccupants.returnedAt),
        ),
      );

    try {
      await this.client.deleteRoom(row.livekitRoomName);
    } catch {
      this.logger.log('La sala de medios de la mini sala ya estaba cerrada');
    }
    return 'closed';
  }

  private scheduleAutoClose(id: string, livekitRoomName: string, autoCloseAt: Date | null): void {
    this.cancelAutoCloseTimer(id);
    if (!autoCloseAt) return;
    const delay = Math.max(autoCloseAt.getTime() - Date.now(), 0);
    const timer = setTimeout(() => {
      this.autoCloseTimers.delete(id);
      void this.closeRow({ id, livekitRoomName });
    }, delay);
    this.autoCloseTimers.set(id, timer);
  }

  private cancelAutoCloseTimer(id: string): void {
    const timer = this.autoCloseTimers.get(id);
    if (!timer) return;
    clearTimeout(timer);
    this.autoCloseTimers.delete(id);
  }

  private resolveAutoCloseAt(autoCloseInMinutes: number | undefined): Date | null {
    if (!autoCloseInMinutes) return null;
    return new Date(Date.now() + autoCloseInMinutes * 60_000);
  }

  // Mismo patrón fail-fast que MAX_ROOM_PARTICIPANTS en calls.service.ts
  // (spec breakout-rooms/configuración-fuera-de-rango).
  private resolveMaxBreakoutRooms(): number {
    const max = Number(this.config.get('MAX_BREAKOUT_ROOMS', '3'));
    if (!Number.isInteger(max) || max < 0 || max > 3) {
      throw new ServiceUnavailableException(
        'El número máximo de mini salas no está configurado correctamente',
      );
    }
    return max;
  }

  private resolveMaxParticipants(): number {
    return Number(this.config.get('MAX_ROOM_PARTICIPANTS', '6'));
  }

  private resolveLiveKitConfig(): { url: string; apiKey: string; apiSecret: string } {
    const url = this.config.get<string>('LIVEKIT_URL');
    const apiKey = this.config.get<string>('LIVEKIT_API_KEY');
    const apiSecret = this.config.get<string>('LIVEKIT_API_SECRET');
    if (!url || !apiKey || !apiSecret) {
      throw new ServiceUnavailableException('Las llamadas todavía no están configuradas');
    }
    return { url, apiKey, apiSecret };
  }

  // Mismo patrón que CallsService.resolveLocalRole: un invitado (sin
  // userId) nunca es administrador, y no se consulta nada por él.
  private async resolveRole(
    roomId: string,
    userId: string | undefined,
  ): Promise<RoomRole | undefined> {
    if (!userId) return undefined;
    const [member] = await this.db
      .select({ role: roomMembers.role })
      .from(roomMembers)
      .where(and(eq(roomMembers.roomId, roomId), eq(roomMembers.userId, userId)))
      .limit(1);
    return member?.role;
  }

  private async fetchOpenRows(roomId: string): Promise<CallBreakoutRoom[]> {
    return this.db
      .select()
      .from(callBreakoutRooms)
      .where(and(eq(callBreakoutRooms.roomId, roomId), isNull(callBreakoutRooms.closedAt)));
  }

  private async getOpenRowOrThrow(breakoutId: string, roomId?: string): Promise<CallBreakoutRoom> {
    const [row] = await this.db
      .select()
      .from(callBreakoutRooms)
      .where(eq(callBreakoutRooms.id, breakoutId))
      .limit(1);
    if (!row || row.closedAt) {
      throw new NotFoundException('No existe esa mini sala o ya está cerrada');
    }
    if (roomId && row.roomId !== roomId) {
      throw new ForbiddenException('La mini sala no pertenece a este grupo');
    }
    return row;
  }

  private async fetchOccupantsByBreakoutIds(breakoutIds: string[]): Promise<
    {
      breakoutRoomId: string;
      livekitIdentity: string;
      displayName: string;
      userId: string | null;
    }[]
  > {
    if (breakoutIds.length === 0) return [];
    return this.db
      .select({
        breakoutRoomId: callBreakoutOccupants.breakoutRoomId,
        livekitIdentity: callBreakoutOccupants.livekitIdentity,
        displayName: callBreakoutOccupants.displayName,
        userId: callBreakoutOccupants.userId,
      })
      .from(callBreakoutOccupants)
      .where(
        and(
          inArray(callBreakoutOccupants.breakoutRoomId, breakoutIds),
          isNull(callBreakoutOccupants.returnedAt),
        ),
      );
  }

  private async findOpenOccupantBySource(
    breakoutRoomId: string,
    sourceIdentity: string,
  ): Promise<{ id: string; livekitIdentity: string; displayName: string } | undefined> {
    const [occupant] = await this.db
      .select({
        id: callBreakoutOccupants.id,
        livekitIdentity: callBreakoutOccupants.livekitIdentity,
        displayName: callBreakoutOccupants.displayName,
      })
      .from(callBreakoutOccupants)
      .where(
        and(
          eq(callBreakoutOccupants.breakoutRoomId, breakoutRoomId),
          eq(callBreakoutOccupants.sourceIdentity, sourceIdentity),
          isNull(callBreakoutOccupants.returnedAt),
        ),
      )
      .limit(1);
    return occupant;
  }

  private async findOpenOccupantByLivekitIdentity(
    breakoutRoomId: string,
    livekitIdentity: string,
  ): Promise<{ id: string } | undefined> {
    const [occupant] = await this.db
      .select({ id: callBreakoutOccupants.id })
      .from(callBreakoutOccupants)
      .where(
        and(
          eq(callBreakoutOccupants.breakoutRoomId, breakoutRoomId),
          eq(callBreakoutOccupants.livekitIdentity, livekitIdentity),
          isNull(callBreakoutOccupants.returnedAt),
        ),
      )
      .limit(1);
    return occupant;
  }

  private async markOccupantReturned(occupantId: string): Promise<void> {
    await this.db
      .update(callBreakoutOccupants)
      .set({ returnedAt: new Date() })
      .where(eq(callBreakoutOccupants.id, occupantId));
  }

  private toView(
    row: CallBreakoutRoom,
    occupants: { livekitIdentity: string; displayName: string; userId: string | null }[],
  ): BreakoutRoomView {
    return {
      id: row.id,
      livekitRoomName: row.livekitRoomName,
      label: row.label,
      leavePolicy: row.leavePolicy as LeavePolicy,
      autoCloseAt: row.autoCloseAt,
      occupants: occupants.map((occupant) => ({
        livekitIdentity: occupant.livekitIdentity,
        displayName: occupant.displayName,
        userId: occupant.userId,
      })),
    };
  }
}

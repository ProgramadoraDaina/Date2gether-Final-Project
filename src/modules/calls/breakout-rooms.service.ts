import {
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
import { RoomEventsService } from '../rooms/room-events.service';
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
// Decisión 3 (design.md "joinPolicy: esquema, migración y autorización"):
// separado de LeavePolicy -- gobierna el movimiento HACIA DENTRO por
// iniciativa propia, nunca la vuelta a la principal.
export type JoinPolicy = 'admin_only' | 'open';

const DEFAULT_LEAVE_POLICY: LeavePolicy = 'locked';
const DEFAULT_JOIN_POLICY: JoinPolicy = 'admin_only';
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
  joinPolicy: JoinPolicy;
  autoCloseAt: Date | null;
  occupants: BreakoutRoomOccupantView[];
}

// Decisión 4 (design.md "Proyección de list por rol", tasks.md 4.1):
// list() discrimina por rol en el SERVICIO, no en el controlador --
// resolveRole ya vive acá, y la proyección ES la frontera de seguridad.
export interface BreakoutRoomAdminOccupantView {
  livekitIdentity: string;
  // Única clave que permite al cliente calcular "quién quedó en la sala
  // principal" (design.md Decisión 4): breakoutParticipants (presencia de
  // socket) menos la unión de sourceIdentity de todos los occupants.
  sourceIdentity: string;
  displayName: string;
  userId: string | null;
}

export interface BreakoutRoomAdminView {
  id: string;
  livekitRoomName: string;
  label: string;
  leavePolicy: LeavePolicy;
  joinPolicy: JoinPolicy;
  autoCloseAt: Date | null;
  occupants: BreakoutRoomAdminOccupantView[];
}

export interface BreakoutRoomPublicView {
  id: string;
  label: string;
  leavePolicy: LeavePolicy;
  joinPolicy: JoinPolicy;
  autoCloseAt: Date | null;
  occupantCount: number;
  selfAssigned: boolean;
}

export interface CreateBreakoutRoomInput {
  label?: string;
  leavePolicy?: LeavePolicy;
  joinPolicy?: JoinPolicy;
  autoCloseInMinutes?: number;
}

export interface UpdateBreakoutRoomInput {
  leavePolicy?: LeavePolicy;
  joinPolicy?: JoinPolicy;
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
    // Puente desacoplado hacia ChatGateway (D12, design.md): la señal viaja
    // por RoomEventsService, el mismo mecanismo que memberRoleChanged /
    // roomEmojisChanged, para no crear un import circular entre CallsModule
    // y ChatModule (ambos ya importan RoomsModule, que exporta este bridge).
    private readonly roomEvents: RoomEventsService,
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
    const joinPolicy = dto.joinPolicy ?? DEFAULT_JOIN_POLICY;

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
            joinPolicy,
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

  /**
   * Decisión 4 (design.md "Proyección de list por rol"): un administrador
   * recibe el roster completo (incluido sourceIdentity, la clave que le
   * permite al cliente calcular quién quedó en la principal); cualquier
   * otro participante recibe solo la ocupación agregada -- sin
   * livekitRoomName (espacio de nombres interno) ni identidad de ningún
   * ocupante. La proyección vive acá, no en el controlador: dejarla ahí
   * significaría que el servicio sigue devolviendo rosters completos a
   * cualquier llamador, a un refactor de distancia de filtrarlos.
   */
  async list(
    roomId: string,
    actor: RoomParticipant,
  ): Promise<BreakoutRoomAdminView[] | BreakoutRoomPublicView[]> {
    const role = await this.resolveRole(roomId, actor.userId);
    const rows = await this.fetchOpenRows(roomId);
    if (rows.length === 0) return [];
    const occupants = await this.fetchOccupantsByBreakoutIds(rows.map((row) => row.id));

    if (role === 'administrador') {
      return rows.map((row): BreakoutRoomAdminView => {
        const roomOccupants = occupants.filter((occupant) => occupant.breakoutRoomId === row.id);
        return {
          id: row.id,
          livekitRoomName: row.livekitRoomName,
          label: row.label,
          leavePolicy: row.leavePolicy as LeavePolicy,
          joinPolicy: row.joinPolicy as JoinPolicy,
          autoCloseAt: row.autoCloseAt,
          occupants: roomOccupants.map((occupant) => ({
            livekitIdentity: occupant.livekitIdentity,
            sourceIdentity: occupant.sourceIdentity,
            displayName: occupant.displayName,
            userId: occupant.userId,
          })),
        };
      });
    }

    return rows.map((row): BreakoutRoomPublicView => {
      const roomOccupants = occupants.filter((occupant) => occupant.breakoutRoomId === row.id);
      return {
        id: row.id,
        label: row.label,
        leavePolicy: row.leavePolicy as LeavePolicy,
        joinPolicy: row.joinPolicy as JoinPolicy,
        autoCloseAt: row.autoCloseAt,
        occupantCount: roomOccupants.length,
        selfAssigned: roomOccupants.some((occupant) => occupant.sourceIdentity === actor.sub),
      };
    });
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

    const patch: Partial<Pick<CallBreakoutRoom, 'leavePolicy' | 'joinPolicy' | 'autoCloseAt'>> = {};
    if (dto.leavePolicy) patch.leavePolicy = dto.leavePolicy;
    // Decisión 3 (design.md): control separado -- cambiar uno nunca toca
    // el otro. Cada uno solo entra al patch si vino explícitamente en el
    // dto correspondiente.
    if (dto.joinPolicy) patch.joinPolicy = dto.joinPolicy;
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
   * Traslada a un occupant hacia una mini sala. Valida pertenencia al
   * grupo, autorización (Decisión 3) y capacidad del destino. Escribe la
   * identity nueva (D7) y la asignación ANTES de desconectar de la
   * principal -- si el cliente nunca pide el token (issueBreakoutToken),
   * la asignación abierta queda registrada y es recuperable (mitigación
   * "participante varado", design.md Flujo 1).
   *
   * Decisión 3 (design.md "Autorización de moveIn"): autorizado si (a) el
   * actor es administrador, sin importar destino ni joinPolicy -- incluido
   * ella misma; o (b) joinPolicy del destino es 'open' Y el participante
   * trasladado es la misma persona que solicita el traslado. La fila de
   * la mini sala se busca ANTES de resolver el rol porque joinPolicy vive
   * ahí y la decisión depende de ambos.
   */
  async moveIn(
    breakoutId: string,
    roomId: string,
    actor: RoomParticipant,
    target: { livekitIdentity: string },
  ): Promise<{ targetIdentity: string }> {
    const breakout = await this.getOpenRowOrThrow(breakoutId, roomId);
    const role = await this.resolveRole(roomId, actor.userId);

    let authorized = role === 'administrador';
    if (!authorized && breakout.joinPolicy === 'open') {
      // "actorGroupIdentity" (design.md): la identity BAJO LA CUAL el
      // actor está conectado ahora mismo en el grupo -- su asignación
      // abierta actual si ya está en una mini sala, o su propio sub si
      // está en la principal. Solo se evalúa cuando hace falta (joinPolicy
      // abierto Y no-admin): cero costo extra para el camino admin.
      const actorOccupant = await this.findOpenOccupantBySourceAcrossGroup(roomId, actor.sub);
      const actorGroupIdentity = actorOccupant?.livekitIdentity ?? actor.sub;
      const selfMove = target.livekitIdentity === actorGroupIdentity;
      // Bugfix (breakout-rooms-ux-fix): joinPolicy='open' del DESTINO nunca
      // debe ser una puerta trasera para escapar de un ORIGEN con
      // leavePolicy='locked' -- esa garantía existe específicamente para
      // que nadie salga sin que el admin actúe (mismo código/mensaje que
      // selfReturn usa para el mismo caso).
      if (selfMove && actorOccupant?.leavePolicy === 'locked') {
        throw new ForbiddenException({
          message: BREAKOUT_RETURN_LOCKED_MESSAGE,
          code: BREAKOUT_RETURN_LOCKED_CODE,
        });
      }
      authorized = selfMove;
    }
    if (!authorized) {
      throw new ForbiddenException('No tenés permiso para trasladar a esa persona a esta mini sala');
    }

    // Decisión 3, riesgo adyacente: listRooms primero -- una mini sala
    // abierta en la base cuya sala de LiveKit ya reapeó por emptyTimeout
    // (crear y no usar por 5 minutos, escenario normal de auto-ingreso) se
    // trata como vacía en vez de hacer tirar listParticipants (createRoom
    // más abajo, implícito en issueBreakoutToken, es idempotente).
    const existingRooms = await this.client.listRooms([breakout.livekitRoomName]);
    const participants =
      existingRooms.length > 0 ? await this.client.listParticipants(breakout.livekitRoomName) : [];
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

    // Decisión 3, consecuencia 1 (design.md): sourceIdentity debe ser
    // siempre el SUJETO ESTABLE del pase, no el identity de origen. Si
    // target.livekitIdentity ya tiene una asignación abierta (salto
    // mini-sala -> mini-sala), se hereda su sourceIdentity; si no (origen
    // = la principal), target.livekitIdentity YA ES el sujeto estable.
    //
    // Bugfix (breakout-rooms-ux-fix): se intenta primero por coincidencia
    // EXACTA de livekitIdentity (cubre el salto mini-sala -> mini-sala
    // cuando quien llama ya conoce la identity ACTUAL del destinatario). Si
    // no hay coincidencia, target.livekitIdentity puede en realidad ser el
    // SUB estable de alguien conectado a OTRA mini sala -- la consola de
    // admin arma "Trasladar" desde la presencia de la principal (sockets),
    // que nunca conoce la identity minteada de una mini sala ajena. Sin este
    // segundo intento la asignación previa nunca se cierra (dos filas
    // abiertas para el mismo sourceIdentity, rompe el índice parcial que
    // hasAdminAssignmentInFlight y la expulsión locked usan como clave de
    // decisión) y removeParticipant más abajo apunta a la sala equivocada.
    let existingAssignment = await this.findOpenOccupantByLivekitIdentityAnyRoom(
      target.livekitIdentity,
    );
    let resolvedLivekitIdentity = target.livekitIdentity;
    if (!existingAssignment) {
      const bySource = await this.findOpenOccupantBySourceAcrossGroup(
        roomId,
        target.livekitIdentity,
      );
      if (bySource) {
        existingAssignment = {
          id: bySource.id,
          sourceIdentity: target.livekitIdentity,
          breakoutRoomId: bySource.breakoutRoomId,
          livekitRoomName: bySource.livekitRoomName,
        };
        resolvedLivekitIdentity = bySource.livekitIdentity;
      }
    }
    const effectiveSourceIdentity = existingAssignment?.sourceIdentity ?? target.livekitIdentity;

    // Decisión 3, consecuencia 2: la asignación anterior se cierra ANTES
    // de insertar la nueva -- dos asignaciones abiertas para el mismo
    // sourceIdentity romperían el índice parcial que hasAdminAssignmentInFlight
    // y la expulsión locked usan como clave de decisión.
    let previousRoomName = existingAssignment?.livekitRoomName;
    if (existingAssignment) {
      await this.markOccupantReturned(existingAssignment.id);
      // El camino de coincidencia directa (findOpenOccupantByLivekitIdentityAnyRoom)
      // no trae livekitRoomName -- se resuelve acá solo cuando hace falta.
      if (!previousRoomName && existingAssignment.breakoutRoomId) {
        previousRoomName = await this.getBreakoutRoomNameById(existingAssignment.breakoutRoomId);
      }
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
      sourceIdentity: effectiveSourceIdentity,
      livekitIdentity: newIdentity,
      userId: sourceIdentity.userId,
      displayName: sourceIdentity.displayName,
    });

    const parentCode = parseBreakoutRoomName(breakout.livekitRoomName)?.parentCode;
    if (parentCode) {
      // Señal antes del removeParticipant (orden del Flujo 1, design.md):
      // el cliente se entera del traslado antes de perder la conexión a la
      // principal. Nunca el token -- D12.
      // Bugfix (breakout-rooms-ux-fix, Judgment Day Round 2): direccionada
      // por effectiveSourceIdentity (el sujeto ESTABLE), NO por
      // target.livekitIdentity -- igual que selfReturn ya hace con
      // occupant.sourceIdentity. ChatGateway.emitToParticipant resuelve el
      // socket por participantId === participant.sub (identity estable);
      // en un salto mini-sala -> mini-sala auto-iniciado (joinPolicy=open),
      // target.livekitIdentity es la identity MINTEADA de la sala de
      // origen que el cliente envió para pasar la autorización -- nunca
      // corresponde a ningún participantId de presencia, así que la señal
      // nunca llegaba al socket real de quien se traslada.
      this.roomEvents.emitBreakoutAssigned({
        roomCode: parentCode,
        targetIdentity: effectiveSourceIdentity,
        breakoutId: breakout.id,
        label: breakout.label,
        leavePolicy: breakout.leavePolicy,
      });
      // Decisión 2 (design.md "Señal de motivo de remoción"): el cliente
      // necesita distinguir ESTE removeParticipant (traslado en curso,
      // esperado) de una desconexión por fallo real. Mismo canal, mismo
      // orden que emitBreakoutAssigned -- antes del removeParticipant.
      this.roomEvents.emitBreakoutRemoval({
        roomCode: parentCode,
        targetIdentity: effectiveSourceIdentity,
        reason: 'BREAKOUT_MOVE_IN',
      });
      // Bugfix (breakout-rooms-ux-fix): el origen real de quien se traslada
      // puede ser OTRA mini sala (salto mini-sala -> mini-sala), no siempre
      // la principal -- removeParticipant debe apuntar a la sala donde la
      // persona está REALMENTE conectada, con su identity ACTUAL. Tolerante
      // a fallo, mismo patrón que selfReturn: si ya no estaba conectada ahí,
      // no hay nada que limpiar.
      try {
        await this.client.removeParticipant(previousRoomName ?? parentCode, resolvedLivekitIdentity);
      } catch {
        this.logger.log('La persona trasladada ya no estaba conectada a su sala de origen');
      }
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
   * 'locked' y el solicitante no es admin -- salvo que se haya auto-unido a
   * una mini sala con joinPolicy 'open', en cuyo caso 'locked' no debe
   * atraparla (bugfix: acoplar auto-salida a cómo entró). No emite token de
   * la principal: cierra la asignación y desconecta de la mini sala vía la
   * misma señal+removeParticipant que ya usa el retorno forzado por admin.
   *
   * Se branchea por si vino `targetLivekitIdentity`, NO por rol: el cliente
   * de autorretorno ("Volver") nunca lo envía (ver breakouts.ts), así que su
   * ausencia siempre significa "devolveme a MÍ", sea quien sea el
   * solicitante -- incluida una administradora que se auto-unió a su propia
   * mini sala (bugfix: antes esto SIEMPRE asumía que un admin fuerza a un
   * tercero y exigía el target con 400, lo cual rompía su propio botón
   * "Volver" apenas el self-join de admin habilitó que terminara como
   * ocupante de su propia sala).
   */
  async selfReturn(
    breakoutId: string,
    roomId: string,
    requester: RoomParticipant,
    targetLivekitIdentity?: string,
  ): Promise<void> {
    const breakout = await this.getOpenRowOrThrow(breakoutId, roomId);
    const role = await this.resolveRole(roomId, requester.userId);

    if (targetLivekitIdentity) {
      if (role !== 'administrador') {
        throw new ForbiddenException('Solo un administrador puede devolver a otra persona');
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
      await this.returnOccupantAndDisconnect(
        breakout,
        occupant.id,
        occupant.sourceIdentity,
        targetLivekitIdentity,
      );
      return;
    }

    const occupant = await this.findOpenOccupantBySource(breakout.id, requester.sub);
    if (!occupant) {
      throw new ForbiddenException('No tenés una asignación abierta en esta mini sala');
    }
    const isAdminExempt = role === 'administrador';
    const isVoluntaryJoinExempt = breakout.joinPolicy === 'open';
    if (breakout.leavePolicy === 'locked' && !isAdminExempt && !isVoluntaryJoinExempt) {
      throw new ForbiddenException({
        message: BREAKOUT_RETURN_LOCKED_MESSAGE,
        code: BREAKOUT_RETURN_LOCKED_CODE,
      });
    }
    await this.returnOccupantAndDisconnect(
      breakout,
      occupant.id,
      requester.sub,
      occupant.livekitIdentity,
    );
  }

  // Decisión 2 (design.md "Señal de motivo de remoción"): compartida por el
  // retorno forzado por admin y por la autosalida -- ambas terminan
  // cerrando la misma fila de ocupante y desconectando de la misma forma,
  // solo difieren en quién la autoriza. `sourceIdentity` direcciona la
  // señal (identity ESTABLE de la principal, D7); `livekitIdentity` es el
  // identity MINTEADO de la mini sala que hay que desconectar de LiveKit.
  private async returnOccupantAndDisconnect(
    breakout: CallBreakoutRoom,
    occupantId: string,
    sourceIdentity: string,
    livekitIdentity: string,
  ): Promise<void> {
    await this.markOccupantReturned(occupantId);
    const parentCode = parseBreakoutRoomName(breakout.livekitRoomName)?.parentCode;
    if (parentCode) {
      this.roomEvents.emitBreakoutRemoval({
        roomCode: parentCode,
        targetIdentity: sourceIdentity,
        reason: 'BREAKOUT_FORCED_RETURN',
      });
    }
    try {
      await this.client.removeParticipant(breakout.livekitRoomName, livekitIdentity);
    } catch {
      this.logger.log('El ocupante ya no estaba conectado a la mini sala');
    }
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

    // Señal de cierre (D12): un solo choke point para las cuatro vías de
    // cierre (close/closeAll/closeGroupBreakouts/reconcileGroup), así cada
    // occupant se entera sin importar qué disparó el cierre.
    const parentCode = parseBreakoutRoomName(row.livekitRoomName)?.parentCode;
    if (parentCode) {
      this.roomEvents.emitBreakoutClosed({ roomCode: parentCode, breakoutId: row.id });
    }

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
      // Decisión 4 (design.md): proyectado también acá (no solo en
      // list()) -- es aditivo, toView()/BreakoutRoomOccupantView siguen
      // ignorándolo (D11, mismo criterio de no romper el contrato de
      // create()/updatePolicy() en este cambio).
      sourceIdentity: string;
      displayName: string;
      userId: string | null;
    }[]
  > {
    if (breakoutIds.length === 0) return [];
    return this.db
      .select({
        breakoutRoomId: callBreakoutOccupants.breakoutRoomId,
        livekitIdentity: callBreakoutOccupants.livekitIdentity,
        sourceIdentity: callBreakoutOccupants.sourceIdentity,
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
  ): Promise<{ id: string; sourceIdentity: string } | undefined> {
    const [occupant] = await this.db
      .select({ id: callBreakoutOccupants.id, sourceIdentity: callBreakoutOccupants.sourceIdentity })
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

  // Decisión 3 (design.md "Autorización de moveIn"): ¿el actor tiene una
  // asignación abierta en CUALQUIER mini sala abierta de este grupo?
  // Reusa fetchOpenRows (ya existe) en vez de un innerJoin -- evita tener
  // que extender el shape de consulta a dos tablas para esta pregunta.
  // Bugfix (breakout-rooms-ux-fix): también proyecta breakoutRoomId,
  // livekitRoomName y leavePolicy de esa fila (ya están en memoria dentro
  // de openRows, sin consulta extra) -- los necesitan tanto la guardia del
  // "open" self-move (leavePolicy del ORIGEN) como la resolución de
  // sourceIdentity-a-través-del-grupo en moveIn (origen real para
  // removeParticipant).
  private async findOpenOccupantBySourceAcrossGroup(
    roomId: string,
    sourceIdentity: string,
  ): Promise<
    | {
        id: string;
        livekitIdentity: string;
        breakoutRoomId: string;
        livekitRoomName: string | undefined;
        leavePolicy: LeavePolicy | undefined;
      }
    | undefined
  > {
    const openRows = await this.fetchOpenRows(roomId);
    if (openRows.length === 0) return undefined;
    const [occupant] = await this.db
      .select({
        id: callBreakoutOccupants.id,
        livekitIdentity: callBreakoutOccupants.livekitIdentity,
        breakoutRoomId: callBreakoutOccupants.breakoutRoomId,
      })
      .from(callBreakoutOccupants)
      .where(
        and(
          inArray(
            callBreakoutOccupants.breakoutRoomId,
            openRows.map((row) => row.id),
          ),
          eq(callBreakoutOccupants.sourceIdentity, sourceIdentity),
          isNull(callBreakoutOccupants.returnedAt),
        ),
      )
      .limit(1);
    if (!occupant) return undefined;
    const room = openRows.find((row) => row.id === occupant.breakoutRoomId);
    return {
      id: occupant.id,
      livekitIdentity: occupant.livekitIdentity,
      breakoutRoomId: occupant.breakoutRoomId,
      livekitRoomName: room?.livekitRoomName,
      leavePolicy: room?.leavePolicy as LeavePolicy | undefined,
    };
  }

  // Decisión 3, consecuencia 1 (design.md): a diferencia de
  // findOpenOccupantByLivekitIdentity (acotado a UNA mini sala, usado por
  // selfReturn), esta busca por livekitIdentity SIN acotar a una mini sala
  // -- necesario para el salto mini-sala -> mini-sala, donde el origen y
  // el destino son mini salas DISTINTAS. livekit_identity es único
  // (unique index), así que a lo sumo una fila abierta puede coincidir.
  private async findOpenOccupantByLivekitIdentityAnyRoom(
    livekitIdentity: string,
  ): Promise<
    { id: string; sourceIdentity: string; breakoutRoomId: string; livekitRoomName?: string } | undefined
  > {
    const [occupant] = await this.db
      .select({
        id: callBreakoutOccupants.id,
        sourceIdentity: callBreakoutOccupants.sourceIdentity,
        breakoutRoomId: callBreakoutOccupants.breakoutRoomId,
      })
      .from(callBreakoutOccupants)
      .where(
        and(
          eq(callBreakoutOccupants.livekitIdentity, livekitIdentity),
          isNull(callBreakoutOccupants.returnedAt),
        ),
      )
      .limit(1);
    return occupant;
  }

  // Bugfix (breakout-rooms-ux-fix): resuelve el nombre de sala de LiveKit de
  // una mini sala por id -- usado por moveIn cuando el origen real de quien
  // se traslada es OTRA mini sala (no la principal), para que
  // removeParticipant apunte a la sala correcta en vez de siempre a la
  // principal.
  private async getBreakoutRoomNameById(breakoutRoomId: string): Promise<string | undefined> {
    const [row] = await this.db
      .select({ livekitRoomName: callBreakoutRooms.livekitRoomName })
      .from(callBreakoutRooms)
      .where(eq(callBreakoutRooms.id, breakoutRoomId))
      .limit(1);
    return row?.livekitRoomName;
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
      joinPolicy: row.joinPolicy as JoinPolicy,
      autoCloseAt: row.autoCloseAt,
      occupants: occupants.map((occupant) => ({
        livekitIdentity: occupant.livekitIdentity,
        displayName: occupant.displayName,
        userId: occupant.userId,
      })),
    };
  }
}

import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, asc, eq, gte, inArray, lt, lte, sql } from 'drizzle-orm';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import { randomUUID } from 'node:crypto';
import type { RoomParticipant } from '../auth/room-access.service';
import { DRIZZLE, type DrizzleDb } from '../../db/drizzle.module';
import {
  callEvents,
  callHistory,
  callParticipantIdentities,
  callSessionParticipants,
  callSessions,
  roomMembers,
  rooms,
  users,
  type RoomRole,
} from '../../db/schema';
import { RoomResolverService } from '../rooms/room-resolver.service';
import { RoomsService } from '../rooms/rooms.service';
import { CALL_HISTORY_PAGE_SIZE, callHistoryCutoff } from './call-history-retention';
import type { ListCallHistoryDto } from './dto/list-call-history.dto';
import type { ReportTrackStateDto } from './dto/report-track-state.dto';

// Código estable para el rechazo del gate de anfitrión (D5, design.md): el
// cliente se acopla a este código, no al texto del mensaje.
const NO_HOST_CONNECTED_CODE = 'NO_HOST_CONNECTED';
const NO_HOST_CONNECTED_MESSAGE = 'Esperá a que se conecte un anfitrión para unirte a la llamada.';

export interface CallHistoryEntry {
  id: string;
  roomId: string;
  // Etiqueta de visualización únicamente: la ruta y la autorización dejaron
  // de usar el código (D4-C) -- roomId es la clave real.
  roomCode: string;
  roomName: string;
  startedAt: Date;
  sessionId: string | null;
}

export interface CallHistoryPage {
  entries: CallHistoryEntry[];
  nextCursor: string | null;
  hasArchived: boolean;
}

@Injectable()
export class CallsService {
  private readonly logger = new Logger(CallsService.name);

  constructor(
    private readonly roomsService: RoomsService,
    private readonly config: ConfigService,
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly resolver: RoomResolverService,
  ) {}

  async join(roomCode: string, participant: RoomParticipant) {
    // D4: el binding es por roomId, resuelto DESPUÉS de buscar la sala real
    // -- el código puede haber sido reciclado a otra sala, así que comparar
    // contra el string ya no prueba nada. getByCodeOrThrow ya rechaza
    // (403/404) una sala cerrada, retirada o vencida; no hace falta
    // repetir ese chequeo acá.
    const room = await this.roomsService.getByCodeOrThrow(roomCode);
    if (participant.roomId !== room.id)
      throw new ForbiddenException('El acceso pertenece a otra sala');

    const url = this.config.get<string>('LIVEKIT_URL');
    const apiKey = this.config.get<string>('LIVEKIT_API_KEY');
    const apiSecret = this.config.get<string>('LIVEKIT_API_SECRET');
    if (!url || !apiKey || !apiSecret) {
      throw new ServiceUnavailableException('Las llamadas todavía no están configuradas');
    }
    const maxParticipants = Number(this.config.get('MAX_ROOM_PARTICIPANTS', '6'));
    if (!Number.isInteger(maxParticipants) || maxParticipants < 2 || maxParticipants > 20) {
      throw new ServiceUnavailableException(
        'La capacidad de la sala no está configurada correctamente',
      );
    }

    // Gate de anfitrión (D1/D2, design.md): el rol se resuelve LOCAL y
    // PRIMERO, antes de contactar a LiveKit. Es lo que permite que un
    // administrador cortocircuite el chequeo de presencia por completo (ver
    // más abajo) y pueda iniciar la llamada incluso si LiveKit está
    // inestable — la excepción que la propuesta exige.
    const role = await this.resolveLocalRole(room.id, participant.userId);

    // El navegador recibe la URL pública; el API puede usar la red interna de Docker.
    const apiUrl = this.config.get<string>('LIVEKIT_API_URL') || url.replace(/^ws/, 'http');
    const client = new RoomServiceClient(apiUrl, apiKey, apiSecret);
    try {
      // createRoom es idempotente. El servidor aplica el cupo al conectar, no al emitir pases.
      // Va ANTES de listParticipants (gate de abajo) para que una sala
      // creada con certeza y una lista vacía de participantes signifiquen
      // sin ambigüedad "nadie conectado", no "la sala no existe".
      await client.createRoom({
        name: roomCode,
        maxParticipants,
        emptyTimeout: 300,
        departureTimeout: 30,
      });
    } catch {
      // No registrar respuestas externas: pueden incluir credenciales o URLs internas.
      this.logger.warn('No se pudo preparar la sala de medios en LiveKit');
      throw new ServiceUnavailableException(
        'El servidor de llamadas no está disponible. Intentá nuevamente.',
      );
    }

    // El admin nunca pasa por esta consulta (D2): solo los no-admin dependen
    // de que haya al menos un administrador ya conectado a la videollamada.
    if (role !== 'administrador') {
      await this.assertHostConnected(client, roomCode, room.id);
    }

    // Correlación identity↔usuario/invitado para esta sala, escrita antes de
    // emitir el token (es el único lugar que tiene juntos participant.sub,
    // participant.userId, participant.name y room.id). El JWT de acceso a la
    // sala vive 24h con un participant.sub FIJO, así que este POST puede
    // reenviarse con el MISMO identity (reintento, re-montaje del cliente):
    // por eso es un upsert por livekitIdentity y no un insert simple.
    // roleAtIssue guarda el snapshot de rol resuelto arriba: es lo que el
    // gate de futuros solicitantes y el cierre forzado del PR7 usan para
    // reconocer admins conectados sin volver a consultar roomMembers.
    await this.db
      .insert(callParticipantIdentities)
      .values({
        livekitIdentity: participant.sub,
        roomId: room.id,
        userId: participant.userId ?? null,
        displayName: participant.name,
        roleAtIssue: role ?? null,
      })
      .onConflictDoUpdate({
        target: callParticipantIdentities.livekitIdentity,
        set: { issuedAt: new Date(), roleAtIssue: role ?? null },
      });

    const access = new AccessToken(apiKey, apiSecret, {
      identity: participant.sub,
      name: participant.name,
      ttl: '15m',
    });
    access.addGrant({
      room: roomCode,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      // Las reacciones viajan por el data channel; el cliente valida cada mensaje recibido.
      canPublishData: true,
      roomAdmin: false,
      roomRecord: false,
    });

    if (participant.userId) {
      // Solo las cuentas registradas generan historial; los invitados se omiten
      // en silencio. Un fallo al registrar no debe impedir que la llamada continúe.
      await this.db
        .insert(callHistory)
        .values({ roomId: room.id, userId: participant.userId })
        .catch(() => {
          this.logger.warn('No se pudo registrar el historial de la llamada');
        });
    }

    // D5: "entrada" -- unirse a la llamada en sí (el tercer y último sitio).
    await this.resolver.touchEntry(room.id);

    return {
      url,
      token: await access.toJwt(),
      roomName: roomCode,
      participantLimit: maxParticipants,
    };
  }

  // Rol del solicitante, resuelto local contra roomMembers (snapshot al
  // momento de unirse). Los invitados (sin userId) nunca son admin: no
  // tienen fila en roomMembers y no se consulta nada por ellos (spec
  // host-gate/invitados-no-admin).
  private async resolveLocalRole(
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

  // Gate de anfitrión para un solicitante no-admin (D1/D2, design.md):
  // consulta el estado EN VIVO de LiveKit (no el log de eventos, que es una
  // proyección rezagada) y lo cruza contra el snapshot de rol guardado en
  // call_participant_identities. Si LiveKit no responde, se rechaza con 503
  // (fail-closed honesto), nunca con 403 (eso le mentiría al solicitante).
  private async assertHostConnected(
    client: RoomServiceClient,
    roomCode: string,
    roomId: string,
  ): Promise<void> {
    let connectedIdentities: string[];
    try {
      const participants = await client.listParticipants(roomCode);
      connectedIdentities = participants
        .map((p) => p.identity)
        .filter((identity): identity is string => !!identity);
    } catch {
      this.logger.warn('No se pudo verificar la presencia de un anfitrión en la videollamada');
      throw new ServiceUnavailableException(
        'No se pudo verificar si hay un anfitrión conectado. Intentá nuevamente.',
      );
    }

    // Lista vacía: nadie conectado, se rechaza sin consultar la base.
    let hostConnected = false;
    if (connectedIdentities.length > 0) {
      const [admin] = await this.db
        .select({ id: callParticipantIdentities.id })
        .from(callParticipantIdentities)
        .where(
          and(
            eq(callParticipantIdentities.roomId, roomId),
            inArray(callParticipantIdentities.livekitIdentity, connectedIdentities),
            eq(callParticipantIdentities.roleAtIssue, 'administrador'),
          ),
        )
        .limit(1);
      hostConnected = !!admin;
    }

    if (!hostConnected) {
      throw new ForbiddenException({
        message: NO_HOST_CONNECTED_MESSAGE,
        code: NO_HOST_CONNECTED_CODE,
      });
    }
  }

  /**
   * LiveKit no manda webhook de mute/unmute (solo `track_published`/
   * `track_unpublished`, que tras la primera publicación dejan de dispararse:
   * `setMicrophoneEnabled`/`setCameraEnabled` solo mutean el track ya
   * publicado — ver design.md). Esto es lo único que puede completar esa
   * foto: el propio cliente avisándole a NUESTRO backend, no a LiveKit.
   *
   * Se resuelve `livekitRoomSid` contra LiveKit en vivo (mismo patrón que
   * `CallSessionCloseService.hasConnectedAdmin`) en vez de confiar en un sid
   * mandado por el cliente: así `aggregate-session.ts` sigue agrupando todo
   * por el mismo identificador autoritativo que ya usan los eventos de
   * webhook, sin tener que confiar en lo que diga el participante.
   *
   * Best-effort a propósito: un mute/unmute jamás debe fallar ni demorar la
   * llamada real por un problema de este reporte secundario.
   */
  async reportTrackState(
    roomCode: string,
    participant: RoomParticipant,
    { source, enabled }: ReportTrackStateDto,
  ): Promise<void> {
    // Comparación barata por código, deliberadamente NO autoritativa (D4,
    // mismo criterio que WsJwtAuthGuard): RoomAccessGuard ya hizo el
    // binding real por roomId antes de llegar acá. No se resuelve la sala
    // de nuevo para este chequeo secundario -- sería una consulta extra en
    // un reporte best-effort que, por diseño, nunca debe demorar la llamada.
    if (participant.roomCode !== roomCode) return;

    const url = this.config.get<string>('LIVEKIT_URL');
    const apiKey = this.config.get<string>('LIVEKIT_API_KEY');
    const apiSecret = this.config.get<string>('LIVEKIT_API_SECRET');
    if (!url || !apiKey || !apiSecret) return;
    const apiUrl = this.config.get<string>('LIVEKIT_API_URL') || url.replace(/^ws/, 'http');
    const client = new RoomServiceClient(apiUrl, apiKey, apiSecret);

    try {
      const [room] = await client.listRooms([roomCode]);
      // La sala ya no existe en LiveKit (la llamada terminó justo ahora):
      // no hay ninguna call_session abierta a la que agregar este evento.
      if (!room?.sid) return;

      await this.db
        .insert(callEvents)
        .values({
          id: `CL_${randomUUID()}`,
          livekitRoomSid: room.sid,
          roomCode,
          eventType: enabled ? 'track_unmuted' : 'track_muted',
          livekitIdentity: participant.sub,
          trackSource: source,
          occurredAt: new Date(),
          payload: { origin: 'client', source, enabled },
        })
        .onConflictDoNothing();
    } catch (error) {
      this.logger.warn(
        `No se pudo registrar el estado de ${source} (${enabled ? 'unmute' : 'mute'}): ${
          error instanceof Error ? error.message : 'motivo desconocido'
        }`,
      );
    }
  }

  async listHistory(userId: string, options: ListCallHistoryDto = {}): Promise<CallHistoryPage> {
    const cutoff = callHistoryCutoff();
    const isArchive = options.view === 'archive';
    const userFilter = eq(callHistory.userId, userId);
    const roomFilter = options.roomId ? eq(callHistory.roomId, options.roomId) : undefined;
    const expired = lt(callHistory.startedAt, cutoff);

    // Resolve the cursor in SQL to keep the timestamp's full precision and scope it to the user.
    const boundary = options.before
      ? this.db
          .select({ startedAt: callHistory.startedAt, id: callHistory.id })
          .from(callHistory)
          .where(and(userFilter, roomFilter, eq(callHistory.id, options.before)))
      : undefined;

    const page = this.db
      .select({ id: callHistory.id, roomId: callHistory.roomId, startedAt: callHistory.startedAt })
      .from(callHistory)
      .where(
        and(
          userFilter,
          roomFilter,
          isArchive ? expired : gte(callHistory.startedAt, cutoff),
          boundary && sql`(${callHistory.startedAt}, ${callHistory.id}) < (${boundary})`,
        ),
      )
      .orderBy(
        sql`${callHistory.startedAt} desc nulls last`,
        sql`${callHistory.id} desc nulls last`,
      )
      .limit(CALL_HISTORY_PAGE_SIZE + 1)
      .as('history_page');

    // Find the first actual join for this user after the attempted join, in the same room.
    const session = this.db
      .select({ id: callSessionParticipants.sessionId })
      .from(callSessionParticipants)
      .innerJoin(callSessions, eq(callSessionParticipants.sessionId, callSessions.id))
      .where(
        and(
          eq(callSessionParticipants.userId, userId),
          eq(callSessions.roomId, page.roomId),
          gte(callSessionParticipants.firstJoinedAt, page.startedAt),
          lte(callSessionParticipants.firstJoinedAt, sql`${page.startedAt} + interval '5 minutes'`),
        ),
      )
      .orderBy(asc(callSessionParticipants.firstJoinedAt), asc(callSessionParticipants.sessionId))
      .limit(1)
      .as('matched_session');

    const [rows, archived] = await Promise.all([
      this.db
        .select({
          id: page.id,
          roomId: page.roomId,
          roomCode: rooms.code,
          roomName: rooms.name,
          startedAt: page.startedAt,
          sessionId: session.id,
        })
        .from(page)
        .innerJoin(rooms, eq(page.roomId, rooms.id))
        .leftJoinLateral(session, sql`true`)
        .orderBy(sql`${page.startedAt} desc nulls last`, sql`${page.id} desc nulls last`),
      isArchive
        ? []
        : this.db
            .select({ id: callHistory.id })
            .from(callHistory)
            .where(and(userFilter, roomFilter, expired))
            .limit(1),
    ]);

    const entries = rows.slice(0, CALL_HISTORY_PAGE_SIZE);
    return {
      entries,
      nextCursor: rows.length > CALL_HISTORY_PAGE_SIZE ? rows[CALL_HISTORY_PAGE_SIZE - 1].id : null,
      hasArchived: archived.length > 0,
    };
  }

  async clearHistoryArchive(userId: string): Promise<void> {
    const cutoff = callHistoryCutoff();
    await this.db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({
          callHistoryDeletedBefore: sql`greatest(${users.callHistoryDeletedBefore}, ${cutoff.toISOString()}::timestamp)`,
        })
        .where(eq(users.id, userId));
      await tx
        .delete(callHistory)
        .where(and(eq(callHistory.userId, userId), lt(callHistory.startedAt, cutoff)));
    });
  }

  // Ver las notas de sala desde el historial no requiere un token de acceso
  // de sala en vivo (eso ya venció); en cambio, haber estado en call_history
  // para esta sala es la prueba de pertenencia con la cuenta ya autenticada.
  //
  // D4-C: un solo identificador autoriza Y recupera. No hay join a `rooms`,
  // no hay código: estructuralmente imposible que la autorización y la
  // recuperación de datos se resuelvan por caminos distintos (la
  // vulnerabilidad original dependía exactamente de eso, ver design.md).
  async getRoomNotesForHistory(userId: string, roomId: string) {
    const [visit] = await this.db
      .select({ roomId: callHistory.roomId })
      .from(callHistory)
      .where(and(eq(callHistory.userId, userId), eq(callHistory.roomId, roomId)))
      .limit(1);
    if (!visit) throw new ForbiddenException('No tenés historial en esta sala');
    return this.roomsService.getRoomNotesById(roomId);
  }
}

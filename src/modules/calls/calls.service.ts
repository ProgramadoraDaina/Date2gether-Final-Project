import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import { randomUUID } from 'node:crypto';
import type { RoomParticipant } from '../auth/room-access.service';
import { DRIZZLE, type DrizzleDb } from '../../db/drizzle.module';
import {
  callBreakoutOccupants,
  callBreakoutRooms,
  callEvents,
  callHistory,
  callParticipantIdentities,
  callSessionParticipants,
  callSessions,
  roomMembers,
  rooms,
  type RoomRole,
} from '../../db/schema';
import { RoomResolverService } from '../rooms/room-resolver.service';
import { RoomsService } from '../rooms/rooms.service';
import { BREAKOUT_RETURN_LOCKED_CODE } from './breakout-rooms.service';
import { CallGroupResolverService } from './call-group-resolver.service';
import type { ReportTrackStateDto } from './dto/report-track-state.dto';

// Código estable para el rechazo del gate de anfitrión (D5, design.md): el
// cliente se acopla a este código, no al texto del mensaje.
const NO_HOST_CONNECTED_CODE = 'NO_HOST_CONNECTED';
const NO_HOST_CONNECTED_MESSAGE = 'Esperá a que se conecte un anfitrión para unirte a la llamada.';

// D8, design.md: mismo código que BreakoutRoomsService.selfReturn usa para
// el rechazo del lado servidor -- este es el enforcement del OTRO punto (el
// gate de join() sobre la sala principal), así que comparten el código.
const BREAKOUT_RETURN_LOCKED_MESSAGE = 'El host te va a devolver a la sala principal.';

const HISTORY_LIMIT = 50;

export interface CallHistoryEntry {
  roomId: string;
  // Etiqueta de visualización únicamente: la ruta y la autorización dejaron
  // de usar el código (D4-C) -- roomId es la clave real.
  roomCode: string;
  roomName: string;
  startedAt: Date;
  sessionId: string | null;
}

@Injectable()
export class CallsService {
  private readonly logger = new Logger(CallsService.name);

  constructor(
    private readonly roomsService: RoomsService,
    private readonly config: ConfigService,
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly resolver: RoomResolverService,
    private readonly groupResolver: CallGroupResolverService,
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
    // de que haya al menos un administrador ya conectado a la videollamada,
    // en CUALQUIER sala del grupo (principal + mini salas activas, D1/D9).
    // Sin mini salas abiertas, resolveCallGroupRoomNames degenera a
    // [roomCode] y assertHostConnected recorre el fast path de D2 -- cero
    // cambio de comportamiento para una llamada sin mini salas.
    if (role !== 'administrador') {
      const groupRoomNames = await this.groupResolver.resolveCallGroupRoomNames(room.id, roomCode);
      // D8/D9: solo cuando el grupo tiene mini salas abiertas (length > 1,
      // la misma condición que ya distingue el fast path de D2 un poco más
      // abajo) se consulta si el solicitante tiene una asignación abierta
      // `locked` -- reusa la lista ya resuelta arriba, sin costo nuevo para
      // una llamada sin mini salas.
      if (groupRoomNames.length > 1) {
        await this.assertBreakoutReturnAllowed(room.id, participant.sub);
      }
      await this.assertHostConnected(client, groupRoomNames, room.id);
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

  // Gate de anfitrión a nivel GRUPO (design.md D1-D3, D9): consulta el
  // estado EN VIVO de LiveKit (no el log de eventos, que es una proyección
  // rezagada) sobre todas las salas del grupo y lo cruza contra el snapshot
  // de rol guardado en call_participant_identities. Si LiveKit no responde,
  // se rechaza con 503 (fail-closed honesto), nunca con 403 (eso le
  // mentiría al solicitante).
  //
  // D2: con groupRoomNames.length === 1 (sin mini salas abiertas) se
  // recorre el código de HOY, intacto -- es el fast path que hace del
  // control de acceso de una sola sala un camino de ejecución literal, no
  // un caso "equivalente" que haya que demostrar.
  private async assertHostConnected(
    client: RoomServiceClient,
    groupRoomNames: string[],
    roomId: string,
  ): Promise<void> {
    const connectedIdentities =
      groupRoomNames.length === 1
        ? await this.listRoomParticipantIdentities(client, groupRoomNames[0])
        : await this.listGroupParticipantIdentities(client, groupRoomNames);

    const hostConnected = await this.hasAdminAmongIdentities(connectedIdentities, roomId);
    if (!hostConnected) {
      throw new ForbiddenException({
        message: NO_HOST_CONNECTED_MESSAGE,
        code: NO_HOST_CONNECTED_CODE,
      });
    }
  }

  // Camino de hoy (D2), sin cambios de comportamiento: una sola llamada a
  // listParticipants, con la misma propagación de excepción que antes del
  // cambio.
  private async listRoomParticipantIdentities(
    client: RoomServiceClient,
    roomCode: string,
  ): Promise<string[]> {
    try {
      const participants = await client.listParticipants(roomCode);
      return participants
        .map((p) => p.identity)
        .filter((identity): identity is string => !!identity);
    } catch {
      this.logger.warn('No se pudo verificar la presencia de un anfitrión en la videollamada');
      throw new ServiceUnavailableException(
        'No se pudo verificar si hay un anfitrión conectado. Intentá nuevamente.',
      );
    }
  }

  // Camino multi-sala (D3): existencia por listRooms, presencia por
  // listParticipants solo sobre las salas que SÍ existen. Una mini sala
  // ausente de listRooms se trata como vacía (no se le llama
  // listParticipants); cualquier error de listRooms/listParticipants sobre
  // una sala existente se propaga igual que en el camino de una sola sala
  // (mismo fail-safe, sin cambios).
  private async listGroupParticipantIdentities(
    client: RoomServiceClient,
    groupRoomNames: string[],
  ): Promise<string[]> {
    try {
      const existingRooms = await client.listRooms(groupRoomNames);
      const existingNames = new Set(existingRooms.map((r) => r.name));
      const participantLists = await Promise.all(
        groupRoomNames
          .filter((name) => existingNames.has(name))
          .map((name) => client.listParticipants(name)),
      );
      return participantLists
        .flat()
        .map((p) => p.identity)
        .filter((identity): identity is string => !!identity);
    } catch {
      this.logger.warn('No se pudo verificar la presencia de un anfitrión en la videollamada');
      throw new ServiceUnavailableException(
        'No se pudo verificar si hay un anfitrión conectado. Intentá nuevamente.',
      );
    }
  }

  // Cruce de identities conectadas contra roleAtIssue='administrador'
  // (C2/D7): el filtro por roomId sigue intacto en los dos caminos -- todas
  // las identities del grupo, incluidas las de mini sala, comparten el
  // mismo roomId del padre (D7, Fase 5).
  private async hasAdminAmongIdentities(identities: string[], roomId: string): Promise<boolean> {
    if (identities.length === 0) return false;
    const [admin] = await this.db
      .select({ id: callParticipantIdentities.id })
      .from(callParticipantIdentities)
      .where(
        and(
          eq(callParticipantIdentities.roomId, roomId),
          inArray(callParticipantIdentities.livekitIdentity, identities),
          eq(callParticipantIdentities.roleAtIssue, 'administrador'),
        ),
      )
      .limit(1);
    return !!admin;
  }

  // D8 punto 1 (design.md): un no-admin con una asignación abierta a una
  // mini sala `locked` no puede volver a la principal por su cuenta --
  // rechazo del lado servidor ANTES de emitir el token, sin importar que su
  // JWT de 24h siga siendo técnicamente válido. `administrador` nunca pasa
  // por acá (D8: `locked` no aplica a admin, y el llamador en join() solo
  // invoca esto en el camino no-admin).
  private async assertBreakoutReturnAllowed(roomId: string, sourceIdentity: string): Promise<void> {
    const [openAssignment] = await this.db
      .select({ leavePolicy: callBreakoutRooms.leavePolicy })
      .from(callBreakoutOccupants)
      .innerJoin(callBreakoutRooms, eq(callBreakoutOccupants.breakoutRoomId, callBreakoutRooms.id))
      .where(
        and(
          eq(callBreakoutOccupants.sourceIdentity, sourceIdentity),
          isNull(callBreakoutOccupants.returnedAt),
          eq(callBreakoutRooms.roomId, roomId),
        ),
      )
      .limit(1);
    if (openAssignment?.leavePolicy === 'locked') {
      throw new ForbiddenException({
        message: BREAKOUT_RETURN_LOCKED_MESSAGE,
        code: BREAKOUT_RETURN_LOCKED_CODE,
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

  async listHistory(userId: string): Promise<CallHistoryEntry[]> {
    const rows = await this.db
      .select({
        roomId: callHistory.roomId,
        roomCode: rooms.code,
        roomName: rooms.name,
        startedAt: callHistory.startedAt,
      })
      .from(callHistory)
      .innerJoin(rooms, eq(callHistory.roomId, rooms.id))
      .where(eq(callHistory.userId, userId))
      .orderBy(desc(callHistory.startedAt))
      .limit(HISTORY_LIMIT);

    if (rows.length === 0) return [];

    // Sin FK entre call_history y call_sessions: se correlaciona acá por
    // sala + cercanía temporal. firstJoinedAt (cuándo ESTE usuario se
    // conectó de verdad) es más preciso que el startedAt de la sala
    // entera, que puede ser antes si otra persona entró primero.
    const participantSessions = await this.db
      .select({
        sessionId: callSessionParticipants.sessionId,
        firstJoinedAt: callSessionParticipants.firstJoinedAt,
        roomId: callSessions.roomId,
      })
      .from(callSessionParticipants)
      .innerJoin(callSessions, eq(callSessionParticipants.sessionId, callSessions.id))
      .where(eq(callSessionParticipants.userId, userId));

    // Cada intento se empareja con la sesión cuyo primer join de este
    // usuario ocurrió más cerca DESPUÉS de ese intento (pedir el token de
    // LiveKit siempre precede a la conexión real). Ventana generosa: no
    // debería tardar minutos en conectar si conecta.
    const MATCH_WINDOW_MS = 5 * 60 * 1000;
    return rows.map((row) => {
      let bestSessionId: string | null = null;
      let bestDelta = Infinity;
      for (const candidate of participantSessions) {
        if (candidate.roomId !== row.roomId) continue;
        const delta = candidate.firstJoinedAt.getTime() - row.startedAt.getTime();
        if (delta >= 0 && delta <= MATCH_WINDOW_MS && delta < bestDelta) {
          bestDelta = delta;
          bestSessionId = candidate.sessionId;
        }
      }
      return {
        roomId: row.roomId,
        roomCode: row.roomCode,
        roomName: row.roomName,
        startedAt: row.startedAt,
        sessionId: bestSessionId,
      };
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

import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import {
  RoomServiceClient,
  TrackSource,
  WebhookReceiver,
  trackSourceToString,
  type WebhookEvent,
} from 'livekit-server-sdk';
import { DRIZZLE, type DrizzleDb } from '../../db/drizzle.module';
import {
  callBreakoutOccupants,
  callBreakoutRooms,
  callEvents,
  callParticipantIdentities,
  callSessionParticipants,
  callSessions,
  roomMembers,
} from '../../db/schema';
import { RoomEventsService } from '../rooms/room-events.service';
import { aggregateSession, type SessionEvent } from './aggregate-session';
import { isBreakoutRoomName, parseBreakoutRoomName } from './call-group';
import { CallSessionCloseService } from './call-session-close.service';

// Los 6 tipos de evento que esta fase sabe identificar y despachar (spec
// webhook/eventos-soportados). Cualquier otro tipo se persiste igual, sin
// pasar por el dispatcher.
const SUPPORTED_EVENT_TYPES = [
  'room_started',
  'room_finished',
  'participant_joined',
  'participant_left',
  'track_published',
  'track_unpublished',
] as const;

type SupportedEventType = (typeof SUPPORTED_EVENT_TYPES)[number];

/**
 * Ingesta de webhooks de LiveKit: verificación de firma, deduplicación por
 * `id` de evento y despacho por tipo. Ver design.md (sección
 * `CallsWebhookController`) para el razonamiento completo.
 *
 * El insert deduplicado sobre `call_events` es el único punto de idempotencia
 * del que depende todo lo demás (PR4 materialización, PR7 gate/cierre).
 */
@Injectable()
export class CallsWebhookService {
  private readonly logger = new Logger(CallsWebhookService.name);
  private readonly receiver: WebhookReceiver;
  private readonly client: RoomServiceClient;

  constructor(
    config: ConfigService,
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly closeService: CallSessionCloseService,
    private readonly roomEvents: RoomEventsService,
  ) {
    this.receiver = new WebhookReceiver(
      config.get<string>('LIVEKIT_API_KEY', ''),
      config.get<string>('LIVEKIT_API_SECRET', ''),
    );
    this.roomEvents.onParticipantKicked(({ roomCode, participantId }) => {
      void this.client.removeParticipant(roomCode, participantId).catch(() => {
        this.logger.warn('No se pudo sacar de la llamada a una persona expulsada');
      });
    });
    const wsUrl = config.get<string>('LIVEKIT_URL') ?? '';
    const apiUrl = config.get<string>('LIVEKIT_API_URL') || wsUrl.replace(/^ws/, 'http');
    this.client = new RoomServiceClient(
      apiUrl,
      config.get<string>('LIVEKIT_API_KEY', ''),
      config.get<string>('LIVEKIT_API_SECRET', ''),
    );
  }

  async handle(rawBody: Buffer | undefined, authHeader: string | undefined): Promise<void> {
    // Chequeo explícito ANTES de llamar a WebhookReceiver: si no distinguimos
    // "no vino body" de "firma inválida" terminamos devolviendo 401 por una
    // razón equivocada (gotcha señalado en tasks.md 4.4/4.5).
    if (!rawBody || rawBody.length === 0) {
      throw new BadRequestException('Falta el cuerpo crudo de la solicitud');
    }

    const bodyText = rawBody.toString('utf8');
    let event: WebhookEvent;
    try {
      event = await this.receiver.receive(bodyText, authHeader);
    } catch (error) {
      // Se registra el motivo exacto (p. ej. "sha256 checksum of body does
      // not match" vs "authorization header is empty" vs un error de
      // verificación del JWT) porque son causas de diagnóstico muy distintas
      // y un mensaje genérico las vuelve indistinguibles en producción. No se
      // registra el header ni el cuerpo: uno es la firma, el otro puede
      // traer datos del participante (convención ya vigente en CallsService).
      const reason = error instanceof Error ? error.message : 'motivo desconocido';
      this.logger.warn(`Webhook de LiveKit rechazado: firma inválida o ausente (${reason})`);
      throw new UnauthorizedException('Firma de webhook inválida');
    }

    const inserted = await this.db
      .insert(callEvents)
      .values(this.toEventRow(event, bodyText))
      .onConflictDoNothing()
      .returning({ id: callEvents.id });

    if (inserted.length === 0) {
      // Entrega duplicada: ya se procesó este id. La dedupe vive en la base
      // (ON CONFLICT), no en una consulta previa — evita una carrera entre
      // "leer si existe" y "escribir".
      return;
    }

    await this.dispatch(event);
  }

  private toEventRow(event: WebhookEvent, bodyText: string) {
    return {
      id: event.id,
      livekitRoomSid: event.room?.sid ?? '',
      roomCode: event.room?.name ?? '',
      eventType: event.event,
      livekitIdentity: event.participant?.identity ?? null,
      trackSource: this.resolveTrackSource(event),
      occurredAt: new Date(Number(event.createdAt) * 1000),
      payload: JSON.parse(bodyText) as unknown,
    };
  }

  private resolveTrackSource(event: WebhookEvent): string | null {
    const source = event.track?.source;
    if (source === undefined || source === TrackSource.UNKNOWN) return null;
    return trackSourceToString(source);
  }

  // Dispatcher por tipo de evento. En este PR (Fase 4) solo identifica el
  // tipo y persiste; los efectos de negocio reales se conectan en PR4
  // (materialización, room_finished) y PR7 (gate de admin + cierre forzado,
  // participant_joined/left). Los métodos de abajo son los huecos donde esa
  // lógica se enchufa — vacíos a propósito en este PR.
  private async dispatch(event: WebhookEvent): Promise<void> {
    if (!this.isSupportedEventType(event.event)) {
      // Tipo no reconocido (p. ej. egress_started): ya quedó persistido
      // arriba, auditoría completa sin generar ningún efecto.
      return;
    }
    switch (event.event) {
      case 'room_started':
        this.onRoomStarted(event);
        break;
      case 'room_finished':
        await this.onRoomFinished(event);
        break;
      case 'participant_joined':
        await this.onParticipantJoined(event);
        break;
      case 'participant_left':
        await this.onParticipantLeft(event);
        break;
      case 'track_published':
        this.onTrackPublished(event);
        break;
      case 'track_unpublished':
        this.onTrackUnpublished(event);
        break;
    }
  }

  private isSupportedEventType(eventType: string): eventType is SupportedEventType {
    return (SUPPORTED_EVENT_TYPES as readonly string[]).includes(eventType);
  }

  // --- Huecos para PR7 (ver design.md), deliberadamente vacíos aquí ---
  // room_started/track_* quedan vacíos a propósito — nada en este cambio
  // los necesita. participant_joined se conecta en la Fase 5 (ver abajo).
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private onRoomStarted(event: WebhookEvent): void {}
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private onTrackPublished(event: WebhookEvent): void {}
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private onTrackUnpublished(event: WebhookEvent): void {}

  /**
   * Expulsión de un ocupante `locked` que reconecta a la principal con su
   * token previo todavía vigente (D8 punto 2, design.md): el rechazo en
   * join() no alcanza por sí solo porque ese token sigue siendo
   * técnicamente válido. Ventana de fuga de 1-2s declarada y aceptada (spec
   * breakout-rooms/expulsión-locked) -- es el techo de lo que LiveKit
   * permite sin un hook de admisión del lado servidor.
   *
   * Solo aplica a `participant_joined` de la sala PRINCIPAL: un join a una
   * mini sala (identity NUEVA, D7) no está sujeto a esta regla.
   */
  private async onParticipantJoined(event: WebhookEvent): Promise<void> {
    const identity = event.participant?.identity;
    const roomCode = event.room?.name;
    if (!identity || !roomCode || isBreakoutRoomName(roomCode)) return;

    const [openAssignment] = await this.db
      .select({
        occupantId: callBreakoutOccupants.id,
        assignedAt: callBreakoutOccupants.assignedAt,
        leavePolicy: callBreakoutRooms.leavePolicy,
      })
      .from(callBreakoutOccupants)
      .innerJoin(callBreakoutRooms, eq(callBreakoutOccupants.breakoutRoomId, callBreakoutRooms.id))
      .where(
        and(
          eq(callBreakoutOccupants.sourceIdentity, identity),
          isNull(callBreakoutOccupants.returnedAt),
          isNull(callBreakoutRooms.closedAt),
        ),
      )
      .limit(1);
    if (!openAssignment) return;

    // Los webhooks llegan con demora: un join previo a la asignación no es una fuga.
    const joinedAt = Number(event.createdAt) * 1000;
    const assignedAt = openAssignment.assignedAt?.getTime();
    if (assignedAt && joinedAt && joinedAt < assignedAt) return;

    // Mismo criterio que join(): `locked` nunca aplica a un administrador.
    const [identityRow] = await this.db
      .select({ role: roomMembers.role })
      .from(callParticipantIdentities)
      .innerJoin(
        roomMembers,
        and(
          eq(roomMembers.roomId, callParticipantIdentities.roomId),
          eq(roomMembers.userId, callParticipantIdentities.userId),
        ),
      )
      .where(eq(callParticipantIdentities.livekitIdentity, identity))
      .limit(1);
    const isAdmin = identityRow?.role === 'administrador';
    if (isAdmin || openAssignment.leavePolicy !== 'locked') {
      // Volvió a la principal por un camino permitido: deja de figurar en la mini sala.
      await this.db
        .update(callBreakoutOccupants)
        .set({ returnedAt: new Date() })
        .where(
          and(
            eq(callBreakoutOccupants.id, openAssignment.occupantId),
            isNull(callBreakoutOccupants.returnedAt),
          ),
        );
      return;
    }

    // Decisión 2 (design.md "Señal de motivo de remoción") + spec
    // call-webhook-ingestion "Señal explícita en la expulsión...locked":
    // motivo propio, distinto de BREAKOUT_MOVE_IN/BREAKOUT_FORCED_RETURN --
    // debe sobrevivir al tratamiento de "no es error" que el cliente aplica
    // a esas dos. `identity` ya es el de la principal (= sub) para este
    // camino: el ocupante reconectó CON ESE identity, así que coincide con
    // sourceIdentity sin necesidad de una consulta extra.
    this.roomEvents.emitBreakoutRemoval({
      roomCode,
      targetIdentity: identity,
      reason: 'BREAKOUT_RETURN_LOCKED',
    });
    try {
      await this.client.removeParticipant(roomCode, identity);
    } catch {
      this.logger.warn('No se pudo expulsar a un ocupante locked reconectado a la sala principal');
    }
  }

  /**
   * Cierre forzado idempotente (Fase 6, design.md D3/D4): si el identity que
   * se fue tiene rol actual de administrador, se delega
   * en CallSessionCloseService la decisión de agendar (o no) un cierre.
   */
  private async onParticipantLeft(event: WebhookEvent): Promise<void> {
    const livekitRoomSid = event.room?.sid;
    const identity = event.participant?.identity;
    if (!livekitRoomSid || !identity) return;

    // roomId se lee de la MISMA fila que ya se consultaba (cero consultas
    // nuevas en el camino de webhook, tasks.md 4.4.8): es el roomId de la
    // sala PADRE (D7) incluso para una identity de mini sala -- la
    // atribución de grupo que CallSessionCloseService necesita para su
    // propio gate ya está resuelta acá sin tener que volver a preguntarla.
    const [row] = await this.db
      .select({ role: roomMembers.role, roomId: callParticipantIdentities.roomId })
      .from(callParticipantIdentities)
      .innerJoin(
        roomMembers,
        and(
          eq(roomMembers.roomId, callParticipantIdentities.roomId),
          eq(roomMembers.userId, callParticipantIdentities.userId),
        ),
      )
      .where(eq(callParticipantIdentities.livekitIdentity, identity))
      .limit(1);
    if (!row || row.role !== 'administrador') return;

    await this.closeService.onAdminLeft(livekitRoomSid, event.room?.name ?? '', row.roomId);
  }

  /**
   * Materialización de la línea de tiempo (PR4, ver design.md "Flujo 2").
   *
   * `room_started`/`participant_*` siguen siendo huecos vacíos en este PR
   * (PR7), así que la cabecera de `call_sessions` puede no existir todavía
   * cuando llega `room_finished`: por eso este handler también la crea de
   * forma perezosa (ON CONFLICT DO NOTHING) antes de intentar reclamarla,
   * en lugar de asumir que ya la creó otro handler.
   *
   * El compare-and-set sobre `materialized_at` es la segunda capa de
   * idempotencia (la primera es el insert deduplicado por id de evento en
   * `handle()`): protege contra una reentrega de `room_finished` con un id
   * de evento distinto pero que describe el mismo fin de sesión.
   */
  private async onRoomFinished(event: WebhookEvent): Promise<void> {
    const livekitRoomSid = event.room?.sid;
    if (!livekitRoomSid) return;
    const roomCode = event.room?.name ?? '';
    const endedAt = new Date(Number(event.createdAt) * 1000);

    // La sesión ya terminó por su cuenta: cualquier cierre forzado agendado
    // para este sid (Fase 6, D3) queda sin efecto. Ver design.md Flujo 2.
    this.closeService.cancelPending(livekitRoomSid);

    await this.db.transaction(async (tx) => {
      const sessionEvents: SessionEvent[] = await tx
        .select({
          eventType: callEvents.eventType,
          livekitIdentity: callEvents.livekitIdentity,
          trackSource: callEvents.trackSource,
          occurredAt: callEvents.occurredAt,
        })
        .from(callEvents)
        .where(eq(callEvents.livekitRoomSid, livekitRoomSid));

      // started_at más antiguo que ya haya quedado persistido en el log para
      // este sid (incluye room_started, aunque su dispatch sea un hueco
      // vacío: igual se persiste en handle() antes de despachar).
      const startedAt = sessionEvents.reduce<Date>(
        (earliest, e) => (e.occurredAt < earliest ? e.occurredAt : earliest),
        sessionEvents[0]?.occurredAt ?? endedAt,
      );

      // D4-D: roomId se resuelve desde call_participant_identities (el
      // identificador autoritativo que CallsService.join() ya escribió),
      // nunca desde una búsqueda por rooms.code -- un room_finished tardío
      // tras un code reciclado atribuiría la sesión a la sala NUEVA.
      // roomId queda en null cuando ningún identity es conocido (la columna
      // ya es nullable).
      const identityKeys = [
        ...new Set(sessionEvents.map((e) => e.livekitIdentity).filter((id): id is string => !!id)),
      ];
      const identities = identityKeys.length
        ? await tx
            .select({
              livekitIdentity: callParticipantIdentities.livekitIdentity,
              userId: callParticipantIdentities.userId,
              displayName: callParticipantIdentities.displayName,
              roomId: callParticipantIdentities.roomId,
            })
            .from(callParticipantIdentities)
            .where(inArray(callParticipantIdentities.livekitIdentity, identityKeys))
        : [];
      const roomId = identities[0]?.roomId ?? null;

      // Vínculo de grupo (design.md D5.3, D6; spec call-participation-timeline
      // ADDED "Vínculo de grupo en la sesión de una mini sala"). Atribución
      // en el dispatcher: un roomCode sin '::' no dispara ninguna consulta
      // nueva (cero costo para toda llamada sin mini salas, spec
      // webhook-ingestion/verificación-sin-cambios); un roomCode con '::'
      // resuelve call_breakout_rooms.livekit_room_name -> parent_livekit_room_sid.
      // Si no hay match (grupo desconocido), degrada a null -- mismo
      // tratamiento que una sala sin mini salas (spec
      // webhook-ingestion/roomCode-sin-grupo): sin efecto de negocio.
      let callGroupId: string | null = null;
      if (parseBreakoutRoomName(roomCode)) {
        const [breakout] = await tx
          .select({ parentLivekitRoomSid: callBreakoutRooms.parentLivekitRoomSid })
          .from(callBreakoutRooms)
          .where(eq(callBreakoutRooms.livekitRoomName, roomCode))
          // Slot names are reused once closed: the newest row is the current one.
          .orderBy(desc(callBreakoutRooms.createdAt))
          .limit(1);
        callGroupId = breakout?.parentLivekitRoomSid ?? null;
      }

      await tx
        .insert(callSessions)
        .values({ livekitRoomSid, roomId, roomCode, startedAt, callGroupId })
        .onConflictDoNothing();

      const claimed = await tx
        .update(callSessions)
        .set({ endedAt, materializedAt: new Date() })
        .where(
          and(eq(callSessions.livekitRoomSid, livekitRoomSid), isNull(callSessions.materializedAt)),
        )
        .returning({ id: callSessions.id });

      if (claimed.length === 0) {
        // Reentrega de room_finished: ya se materializó antes, sin efecto.
        return;
      }
      const sessionId = claimed[0].id;

      const summaries = aggregateSession(sessionEvents, identities, endedAt);
      if (summaries.length === 0) return;

      await tx.insert(callSessionParticipants).values(
        summaries.map((summary) => ({
          sessionId,
          ...summary,
          // jsonb no tiene el manejo especial de Date que sí tiene la columna
          // `timestamp`: hay que serializar a ISO a mano antes de insertar.
          trackIntervals: summary.trackIntervals.map((interval) => ({
            source: interval.source,
            startedAt: interval.startedAt.toISOString(),
            endedAt: interval.endedAt.toISOString(),
          })),
        })),
      );
    });
  }
}

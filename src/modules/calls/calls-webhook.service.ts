import { BadRequestException, Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import {
  TrackSource,
  WebhookReceiver,
  trackSourceToString,
  type WebhookEvent,
} from 'livekit-server-sdk';
import { DRIZZLE, type DrizzleDb } from '../../db/drizzle.module';
import {
  callEvents,
  callParticipantIdentities,
  callSessionParticipants,
  callSessions,
  rooms,
} from '../../db/schema';
import { aggregateSession, type SessionEvent } from './aggregate-session';

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

  constructor(
    config: ConfigService,
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
  ) {
    this.receiver = new WebhookReceiver(
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
    } catch {
      // No se registra el header ni el cuerpo: uno es la firma, el otro puede
      // traer datos del participante (convención ya vigente en CallsService).
      this.logger.warn('Webhook de LiveKit rechazado: firma inválida o ausente');
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
        this.onParticipantJoined(event);
        break;
      case 'participant_left':
        this.onParticipantLeft(event);
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
  private onRoomStarted(_event: WebhookEvent): void {}
  private onParticipantJoined(_event: WebhookEvent): void {}
  private onParticipantLeft(_event: WebhookEvent): void {}
  private onTrackPublished(_event: WebhookEvent): void {}
  private onTrackUnpublished(_event: WebhookEvent): void {}

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

      const [room] = roomCode
        ? await tx.select({ id: rooms.id }).from(rooms).where(eq(rooms.code, roomCode)).limit(1)
        : [];

      await tx
        .insert(callSessions)
        .values({ livekitRoomSid, roomId: room?.id ?? null, roomCode, startedAt })
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

      const identityKeys = [
        ...new Set(
          sessionEvents.map((e) => e.livekitIdentity).filter((id): id is string => !!id),
        ),
      ];
      const identities = identityKeys.length
        ? await tx
            .select({
              livekitIdentity: callParticipantIdentities.livekitIdentity,
              userId: callParticipantIdentities.userId,
              displayName: callParticipantIdentities.displayName,
            })
            .from(callParticipantIdentities)
            .where(inArray(callParticipantIdentities.livekitIdentity, identityKeys))
        : [];

      const summaries = aggregateSession(sessionEvents, identities, endedAt);
      if (summaries.length === 0) return;

      await tx
        .insert(callSessionParticipants)
        .values(summaries.map((summary) => ({ sessionId, ...summary })));
    });
  }
}

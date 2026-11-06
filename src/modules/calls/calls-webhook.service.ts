import { BadRequestException, Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  TrackSource,
  WebhookReceiver,
  trackSourceToString,
  type WebhookEvent,
} from 'livekit-server-sdk';
import { DRIZZLE, type DrizzleDb } from '../../db/drizzle.module';
import { callEvents } from '../../db/schema';

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

    this.dispatch(event);
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
  private dispatch(event: WebhookEvent): void {
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
        this.onRoomFinished(event);
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

  // --- Huecos para PR4/PR7 (ver design.md), deliberadamente vacíos aquí ---
  private onRoomStarted(_event: WebhookEvent): void {}
  private onRoomFinished(_event: WebhookEvent): void {}
  private onParticipantJoined(_event: WebhookEvent): void {}
  private onParticipantLeft(_event: WebhookEvent): void {}
  private onTrackPublished(_event: WebhookEvent): void {}
  private onTrackUnpublished(_event: WebhookEvent): void {}
}

import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { RoomServiceClient } from 'livekit-server-sdk';
import { DRIZZLE, type DrizzleDb } from '../../db/drizzle.module';
import { callEvents, callParticipantIdentities, callSessions, rooms } from '../../db/schema';

// Ventana de gracia (D3, design.md): 15s. No es un sleep ciego antes de
// cerrar: es una RE-VERIFICACIÓN agendada. Un admin que se reconecta vuelve
// con un identity NUEVO (RoomAccessService.create() genera sub =
// randomUUID() en cada acceso), así que no se puede "esperar a que vuelva
// el mismo": la única pregunta contestable a T+15s es "¿hay algún admin
// conectado ahora?".
const GRACE_WINDOW_MS = 15_000;

/**
 * Cierre forzado idempotente de la videollamada cuando se desconecta el
 * último administrador conectado (ver design.md D3/D4). Deliberadamente
 * separado de CallsWebhookService: CallsService.join() también necesita
 * resolver presencia de admin (su propio camino, ver assertHostConnected en
 * calls.service.ts) y este servicio no debe depender del de ingesta de
 * webhooks.
 */
@Injectable()
export class CallSessionCloseService {
  private readonly logger = new Logger(CallSessionCloseService.name);
  // Capa 1 de idempotencia (D4): single-flight en proceso. Evita agendar
  // dos timers para el mismo sid cuando dos participant_left de admins
  // distintos llegan casi simultáneos. No es la garantía real (eso es la
  // capa 2, el compare-and-set en Postgres): es un filtro barato para el
  // caso común.
  private readonly pendingCloses = new Map<string, NodeJS.Timeout>();
  private readonly client: RoomServiceClient;

  constructor(
    config: ConfigService,
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
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
   * Se invoca desde el dispatcher de webhooks cuando el identity que generó
   * un `participant_left` tenía `roleAtIssue = 'administrador'`. No cierra
   * de inmediato: si en este instante ya no queda ningún admin conectado,
   * agenda un re-chequeo a T+15s (D3) en vez de forzar el cierre ya mismo.
   */
  async onAdminLeft(livekitRoomSid: string, roomCode: string): Promise<void> {
    if (this.pendingCloses.has(livekitRoomSid)) return;

    const hasAdmin = await this.hasConnectedAdmin(roomCode);
    if (hasAdmin) return;

    // Re-chequeo tras el await de arriba: una segunda llamada casi
    // simultánea (otro admin desconectándose del mismo sid) puede haber
    // agendado el timer mientras esperábamos la respuesta de LiveKit.
    if (this.pendingCloses.has(livekitRoomSid)) return;

    const timer = setTimeout(() => {
      this.pendingCloses.delete(livekitRoomSid);
      void this.recheckAndClose(livekitRoomSid, roomCode);
    }, GRACE_WINDOW_MS);
    this.pendingCloses.set(livekitRoomSid, timer);
  }

  /**
   * Cancela un cierre agendado para este sid, si hay uno. Se invoca desde
   * `room_finished` (ver design.md, Flujo 2: "cancelar timer pendiente del
   * sid") para no dejar un timer colgado sobre una sesión que ya terminó
   * por su cuenta.
   */
  cancelPending(livekitRoomSid: string): void {
    const timer = this.pendingCloses.get(livekitRoomSid);
    if (!timer) return;
    clearTimeout(timer);
    this.pendingCloses.delete(livekitRoomSid);
  }

  private async recheckAndClose(livekitRoomSid: string, roomCode: string): Promise<void> {
    const hasAdmin = await this.hasConnectedAdmin(roomCode);
    // El admin volvió (el mismo u otro) dentro de la ventana: se cancela el
    // cierre sin tocar nada más.
    if (hasAdmin) return;
    await this.claimAndClose(livekitRoomSid, roomCode);
  }

  // Estado EN VIVO de LiveKit (D1), igual que en CallsService.join(): el
  // log de eventos es una proyección rezagada, no sirve para esta decisión.
  private async hasConnectedAdmin(roomCode: string): Promise<boolean> {
    try {
      const participants = await this.client.listParticipants(roomCode);
      const identities = participants
        .map((p) => p.identity)
        .filter((identity): identity is string => !!identity);
      if (identities.length === 0) return false;

      const [admin] = await this.db
        .select({ id: callParticipantIdentities.id })
        .from(callParticipantIdentities)
        .where(
          and(
            inArray(callParticipantIdentities.livekitIdentity, identities),
            eq(callParticipantIdentities.roleAtIssue, 'administrador'),
          ),
        )
        .limit(1);
      return !!admin;
    } catch {
      // Si no se puede verificar, NO se fuerza el cierre: el registro
      // autoritativo de fin de sesión es room_finished, que LiveKit emite
      // igual (D4, "convergencia best-effort"). Forzar un cierre sin poder
      // confirmar que no hay admin sería peor que no cerrar.
      this.logger.warn('No se pudo verificar la presencia de un admin para el cierre forzado');
      return true;
    }
  }

  private async claimAndClose(livekitRoomSid: string, roomCode: string): Promise<void> {
    // BUG CORREGIDO: el camino de cierre forzado llega ANTES de que exista
    // room_finished (de hecho, deleteRoom() más abajo es lo que lo provoca),
    // así que la fila de call_sessions para este sid casi nunca existe
    // todavía acá. Sin esta creación perezosa, el UPDATE de abajo siempre
    // afectaría 0 filas -- no porque "otro handler ya reclamó el cierre",
    // sino porque la fila jamás fue creada -- y deleteRoom() nunca se
    // llamaría.
    await this.ensureSessionRow(livekitRoomSid, roomCode);

    // Capa 2 (D4): compare-and-set persistido, atómico en Postgres — la
    // garantía real de exclusión, incluso entre procesos o reinicios.
    const claimed = await this.db
      .update(callSessions)
      .set({ forcedCloseAt: new Date(), closeReason: 'last_admin_left' })
      .where(
        and(eq(callSessions.livekitRoomSid, livekitRoomSid), isNull(callSessions.forcedCloseAt)),
      )
      .returning({ id: callSessions.id });

    if (claimed.length === 0) return; // otro handler ya reclamó el cierre

    // Capa 3 (D4): invocación tolerante. Cerrar una sala que ya no existe
    // (porque LiveKit la reapareó, o porque un cierre anterior ya corrió)
    // no es un error: se registra a nivel `log`, nunca `error`, y nunca se
    // re-lanza ni se incluye la respuesta externa de LiveKit.
    try {
      await this.client.deleteRoom(roomCode);
    } catch {
      this.logger.log('La sala de medios ya estaba cerrada');
    }
  }

  /**
   * Creación perezosa de la cabecera de call_sessions (D8), mismo patrón ya
   * establecido en CallsWebhookService.onRoomFinished: ON CONFLICT DO
   * NOTHING, así que si la fila ya existe (creada por este mismo método en
   * una carrera, o por onRoomFinished si room_finished llegó primero) no se
   * pisa nada. started_at se calcula igual que ahí: el mínimo occurred_at ya
   * persistido en call_events para este sid (ese log tiene filas desde el
   * inicio de la sesión aunque room_started/participant_joined sigan siendo
   * huecos vacíos del dispatcher — el evento crudo se persiste en handle()
   * antes de despachar). Si no hay eventos, new Date() como fallback
   * defensivo (no debería pasar en producción).
   */
  private async ensureSessionRow(livekitRoomSid: string, roomCode: string): Promise<void> {
    const events = await this.db
      .select({ occurredAt: callEvents.occurredAt })
      .from(callEvents)
      .where(eq(callEvents.livekitRoomSid, livekitRoomSid));
    const startedAt = events.reduce<Date>(
      (earliest, e) => (e.occurredAt < earliest ? e.occurredAt : earliest),
      events[0]?.occurredAt ?? new Date(),
    );

    const [room] = roomCode
      ? await this.db.select({ id: rooms.id }).from(rooms).where(eq(rooms.code, roomCode)).limit(1)
      : [];

    await this.db
      .insert(callSessions)
      .values({ livekitRoomSid, roomId: room?.id ?? null, roomCode, startedAt })
      .onConflictDoNothing();
  }
}

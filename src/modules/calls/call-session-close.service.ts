import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, gt, inArray, isNull } from 'drizzle-orm';
import { RoomServiceClient } from 'livekit-server-sdk';
import { DRIZZLE, type DrizzleDb } from '../../db/drizzle.module';
import {
  callBreakoutOccupants,
  callBreakoutRooms,
  callEvents,
  callParticipantIdentities,
  callSessions,
  roomMembers,
} from '../../db/schema';
import { BreakoutRoomsService } from './breakout-rooms.service';
import { CallGroupResolverService } from './call-group-resolver.service';

// Ventana de gracia (D3, design.md): 15s. No es un sleep ciego antes de
// cerrar: es una RE-VERIFICACIÓN agendada. Un admin que se reconecta vuelve
// con un identity NUEVO (RoomAccessService.create() genera sub =
// randomUUID() en cada acceso), así que no se puede "esperar a que vuelva
// el mismo": la única pregunta contestable a T+15s es "¿hay algún admin
// conectado ahora?".
const GRACE_WINDOW_MS = 15_000;

// R1 (design.md "Decisión R1 — Marcador durable de 'asignación en vuelo'"):
// un admin con una asignación abierta y fresca a una mini sala del grupo
// está EN TRÁNSITO -- todavía no aparece en listParticipants de ninguna
// sala del grupo. 30s, no 15s (GRACE_WINDOW_MS): es un marcador
// independiente, no un ensanchamiento del gate de cierre forzado ya en
// producción.
const ASSIGNMENT_IN_FLIGHT_MS = 30_000;

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
    private readonly groupResolver: CallGroupResolverService,
    private readonly breakoutRooms: BreakoutRoomsService,
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
   * un `participant_left` tiene el rol actual de administrador. No cierra
   * de inmediato: si en este instante ya no queda ningún admin conectado EN
   * NINGUNA sala del grupo (principal + mini salas activas, D1/D3), agenda
   * un re-chequeo a T+15s (D3) en vez de forzar el cierre ya mismo.
   *
   * `roomCode`/`livekitRoomSid` llegan tal cual los reportó LiveKit -- si
   * pertenecen a una mini sala (contienen '::'), `resolveGroupAnchor` los
   * traduce al ancla del grupo (sid y código de la sala PADRE) antes de
   * cualquier otra cosa; para un roomCode sin '::' esa resolución es un
   * no-op sin consultas (D6), así que el camino sin mini salas queda
   * bit a bit igual que antes de esta generalización.
   *
   * `roomId` (D7): el roomId del PADRE, ya resuelto por el llamador desde
   * `call_participant_identities` -- todas las identities del grupo,
   * incluidas las de mini sala, comparten ese mismo roomId.
   */
  async onAdminLeft(
    livekitRoomSid: string,
    roomCode: string,
    roomId: string | null = null,
  ): Promise<void> {
    const anchor = await this.groupResolver.resolveGroupAnchor(livekitRoomSid, roomCode);
    if (this.pendingCloses.has(anchor.parentSid)) return;

    const hasAdmin = await this.hasConnectedAdmin(anchor.parentCode, roomId);
    if (hasAdmin) return;

    // Re-chequeo tras el await de arriba: una segunda llamada casi
    // simultánea (otro admin desconectándose del mismo sid) puede haber
    // agendado el timer mientras esperábamos la respuesta de LiveKit.
    if (this.pendingCloses.has(anchor.parentSid)) return;

    const timer = setTimeout(() => {
      this.pendingCloses.delete(anchor.parentSid);
      void this.recheckAndClose(anchor.parentSid, anchor.parentCode, roomId);
    }, GRACE_WINDOW_MS);
    this.pendingCloses.set(anchor.parentSid, timer);
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

  private async recheckAndClose(
    livekitRoomSid: string,
    roomCode: string,
    roomId: string | null,
  ): Promise<void> {
    const hasAdmin = await this.hasConnectedAdmin(roomCode, roomId);
    // El admin volvió (el mismo u otro, en cualquier sala del grupo) dentro
    // de la ventana: se cancela el cierre sin tocar nada más.
    if (hasAdmin) return;
    await this.claimAndClose(livekitRoomSid, roomCode, roomId);
  }

  // Estado EN VIVO de LiveKit a nivel GRUPO (D1/D3), igual criterio que
  // CallsService.assertHostConnected: el log de eventos es una proyección
  // rezagada, no sirve para esta decisión.
  //
  // D2: con un solo nombre en el grupo (sin mini salas abiertas, o roomId
  // desconocido) se recorre el camino de HOY, intacto -- sin el filtro de
  // roomId que C4 fija como el comportamiento actual. El filtro de roomId
  // solo se agrega cuando el grupo tiene más de una sala (D7: todas las
  // identities del grupo comparten el roomId del padre).
  private async hasConnectedAdmin(
    roomCode: string,
    roomId: string | null = null,
  ): Promise<boolean> {
    try {
      const groupRoomNames = await this.groupResolver.resolveCallGroupRoomNames(roomId, roomCode);
      const identities = await this.listGroupIdentities(groupRoomNames);
      if (identities.length === 0) {
        // R1: nadie conectado en NINGUNA sala del grupo todavía no prueba
        // que el grupo quedó sin admin -- un admin puede estar EN TRÁNSITO
        // (removida de la principal, todavía no reconectada a la mini
        // sala). Se evalúa solo con mini salas abiertas (D2/D9 intactas
        // para toda llamada sin mini salas: groupRoomNames.length === 1
        // nunca entra acá).
        if (groupRoomNames.length > 1) {
          return await this.hasAdminAssignmentInFlight(roomId);
        }
        return false;
      }

      const conditions = [
        inArray(callParticipantIdentities.livekitIdentity, identities),
        eq(roomMembers.role, 'administrador'),
      ];
      if (groupRoomNames.length > 1 && roomId) {
        conditions.push(eq(callParticipantIdentities.roomId, roomId));
      }

      const [admin] = await this.db
        .select({ id: callParticipantIdentities.id })
        .from(callParticipantIdentities)
        .innerJoin(
          roomMembers,
          and(
            eq(roomMembers.roomId, callParticipantIdentities.roomId),
            eq(roomMembers.userId, callParticipantIdentities.userId),
          ),
        )
        .where(and(...conditions))
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

  /**
   * R1 (design.md "Decisión R1"): ¿hay, en este grupo, una fila de ocupante
   * ABIERTA (`returned_at IS NULL`) de una mini sala ABIERTA
   * (`closed_at IS NULL`), con `assigned_at` dentro de los últimos
   * `ASSIGNMENT_IN_FLIGHT_MS`, cuya identity de ORIGEN tenía
   * `roleAtIssue = 'administrador'`? Si sí, ese admin está EN TRÁNSITO:
   * todavía no aparece en `listParticipants` de ninguna sala, pero la
   * asignación ya quedó escrita por `moveIn` ANTES de desconectar de la
   * principal (mismo orden que design.md documenta para el Flujo 1).
   *
   * Se evalúa SOLO desde `hasConnectedAdmin`, nunca desde
   * `CallsService.assertHostConnected`: son preguntas distintas (ver
   * design.md, "Vive solo en CallSessionCloseService.hasConnectedAdmin").
   */
  private async hasAdminAssignmentInFlight(roomId: string | null): Promise<boolean> {
    if (!roomId) return false;
    const cutoff = new Date(Date.now() - ASSIGNMENT_IN_FLIGHT_MS);
    const [row] = await this.db
      .select({ id: callBreakoutOccupants.id })
      .from(callBreakoutOccupants)
      .innerJoin(callBreakoutRooms, eq(callBreakoutOccupants.breakoutRoomId, callBreakoutRooms.id))
      .innerJoin(
        callParticipantIdentities,
        eq(callBreakoutOccupants.livekitIdentity, callParticipantIdentities.livekitIdentity),
      )
      .where(
        and(
          eq(callBreakoutRooms.roomId, roomId),
          isNull(callBreakoutRooms.closedAt),
          isNull(callBreakoutOccupants.returnedAt),
          gt(callBreakoutOccupants.assignedAt, cutoff),
          eq(callParticipantIdentities.roleAtIssue, 'administrador'),
        ),
      )
      .limit(1);
    return !!row;
  }

  // D2 (fast path, código de hoy) + D3 (multi-sala: existencia por
  // listRooms, presencia por listParticipants solo sobre las existentes).
  // Mismo criterio que CallsService.listGroupParticipantIdentities -- acá
  // separado porque este servicio usa su propio `this.client` ya
  // configurado en el constructor, en vez de recibirlo por parámetro.
  private async listGroupIdentities(groupRoomNames: string[]): Promise<string[]> {
    if (groupRoomNames.length === 1) {
      const participants = await this.client.listParticipants(groupRoomNames[0]);
      return participants
        .map((p) => p.identity)
        .filter((identity): identity is string => !!identity);
    }

    const existingRooms = await this.client.listRooms(groupRoomNames);
    const existingNames = new Set(existingRooms.map((r) => r.name));
    const participantLists = await Promise.all(
      groupRoomNames
        .filter((name) => existingNames.has(name))
        .map((name) => this.client.listParticipants(name)),
    );
    return participantLists
      .flat()
      .map((p) => p.identity)
      .filter((identity): identity is string => !!identity);
  }

  private async claimAndClose(
    livekitRoomSid: string,
    roomCode: string,
    roomId: string | null = null,
  ): Promise<void> {
    // BUG CORREGIDO: el camino de cierre forzado llega ANTES de que exista
    // room_finished (de hecho, deleteRoom() más abajo es lo que lo provoca),
    // así que la fila de call_sessions para este sid casi nunca existe
    // todavía acá. Sin esta creación perezosa, el UPDATE de abajo siempre
    // afectaría 0 filas -- no porque "otro handler ya reclamó el cierre",
    // sino porque la fila jamás fue creada -- y deleteRoom() nunca se
    // llamaría.
    await this.ensureSessionRow(livekitRoomSid, roomCode);

    // Fase 5 (Flujo 3, design.md): mini salas primero, principal al final.
    // closeGroupBreakouts es tolerante por diseño (nunca tira, nunca
    // logger.error) -- un roomId null (grupo sin correlación conocida) es
    // un no-op, así que el camino sin mini salas queda bit a bit igual.
    await this.breakoutRooms.closeGroupBreakouts(roomId, roomCode);

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
      .select({ occurredAt: callEvents.occurredAt, livekitIdentity: callEvents.livekitIdentity })
      .from(callEvents)
      .where(eq(callEvents.livekitRoomSid, livekitRoomSid));
    const startedAt = events.reduce<Date>(
      (earliest, e) => (e.occurredAt < earliest ? e.occurredAt : earliest),
      events[0]?.occurredAt ?? new Date(),
    );

    // D4-D: roomId se resuelve desde call_participant_identities, igual que
    // CallsWebhookService.onRoomFinished -- nunca desde una búsqueda por
    // rooms.code (un room_finished tardío tras un code reciclado atribuiría
    // la sesión a la sala NUEVA). roomId queda en null cuando ningún
    // identity de este sid es conocido.
    const identityKeys = [
      ...new Set(events.map((e) => e.livekitIdentity).filter((id): id is string => !!id)),
    ];
    const identities = identityKeys.length
      ? await this.db
          .select({ roomId: callParticipantIdentities.roomId })
          .from(callParticipantIdentities)
          .where(inArray(callParticipantIdentities.livekitIdentity, identityKeys))
      : [];
    const roomId = identities[0]?.roomId ?? null;

    await this.db
      .insert(callSessions)
      .values({ livekitRoomSid, roomId, roomCode, startedAt })
      .onConflictDoNothing();
  }
}

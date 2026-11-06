/**
 * Agregación pura de la línea de tiempo de una sesión de llamada.
 *
 * Toma el registro crudo de eventos de LiveKit de una sesión (ya persistidos
 * en `call_events`) más la correlación identity↔usuario/invitado de esa
 * sala, y devuelve el resumen por participante que se materializa en
 * `call_session_participants` al recibir `room_finished` (ver design.md,
 * sección "Flujo 2").
 *
 * Es deliberadamente una función pura, sin acceso a la base ni a LiveKit:
 * eso es lo que la hace fácil de testear con fixtures armados a mano y lo
 * que habilita re-ejecutarla manualmente sobre el log crudo si
 * `room_finished` nunca llega (spec timeline/resiliencia-parcial).
 */

export interface SessionEvent {
  eventType: string;
  livekitIdentity: string | null;
  trackSource: string | null;
  occurredAt: Date;
}

export interface IdentityCorrelation {
  livekitIdentity: string;
  userId: string | null;
  displayName: string;
}

export interface ParticipantSummary {
  participantKey: string;
  userId: string | null;
  displayName: string;
  isGuest: boolean;
  firstJoinedAt: Date;
  lastLeftAt: Date;
  totalSeconds: number;
  spoke: boolean;
  screenShared: boolean;
  rejoinCount: number;
}

// Acumulador interno por participant_key. `intervalCount` en 0 significa
// "todavía no se cerró ningún intervalo real de unión/salida para esta
// persona" (p. ej. solo se vio un track_published sin su join emparejado
// todavía): closeInterval() lo trata como si fuera la primera vez, en lugar
// de mezclarlo con los timestamps de relleno.
interface ParticipantAccumulator {
  userId: string | null;
  displayName: string;
  isGuest: boolean;
  firstJoinedAt: Date;
  lastLeftAt: Date;
  totalSeconds: number;
  spoke: boolean;
  screenShared: boolean;
  intervalCount: number;
}

// Pliega varias identities aleatorias de la misma persona (reconexiones) en
// una sola clave: la cuenta si la hay, o el nombre del invitado en minúsculas.
function participantKeyOf(identity: IdentityCorrelation): string {
  return identity.userId ?? `guest:${identity.displayName.toLowerCase()}`;
}

export function aggregateSession(
  events: SessionEvent[],
  identities: IdentityCorrelation[],
  fallbackEndAt: Date,
): ParticipantSummary[] {
  const identityByLivekitIdentity = new Map(identities.map((i) => [i.livekitIdentity, i]));
  const accumulators = new Map<string, ParticipantAccumulator>();
  // Join abierto por identity de LiveKit (no por participant_key): cada
  // identity tiene a lo sumo un join sin cerrar a la vez.
  const openJoinByIdentity = new Map<string, Date>();

  function closeInterval(identity: IdentityCorrelation, joinedAt: Date, leftAt: Date): void {
    const key = participantKeyOf(identity);
    const seconds = Math.max(0, Math.round((leftAt.getTime() - joinedAt.getTime()) / 1000));
    const existing = accumulators.get(key);

    if (!existing || existing.intervalCount === 0) {
      accumulators.set(key, {
        userId: identity.userId,
        displayName: identity.displayName,
        isGuest: identity.userId === null,
        firstJoinedAt: joinedAt,
        lastLeftAt: leftAt,
        totalSeconds: seconds,
        spoke: existing?.spoke ?? false,
        screenShared: existing?.screenShared ?? false,
        intervalCount: 1,
      });
      return;
    }

    existing.totalSeconds += seconds;
    existing.intervalCount += 1;
    if (joinedAt < existing.firstJoinedAt) existing.firstJoinedAt = joinedAt;
    if (leftAt > existing.lastLeftAt) existing.lastLeftAt = leftAt;
  }

  function markTrack(identity: IdentityCorrelation, trackSource: string | null): void {
    const key = participantKeyOf(identity);
    const existing = accumulators.get(key);
    const base: ParticipantAccumulator = existing ?? {
      userId: identity.userId,
      displayName: identity.displayName,
      isGuest: identity.userId === null,
      firstJoinedAt: fallbackEndAt,
      lastLeftAt: fallbackEndAt,
      totalSeconds: 0,
      spoke: false,
      screenShared: false,
      intervalCount: 0,
    };
    if (trackSource === 'microphone') base.spoke = true;
    if (trackSource === 'screen_share') base.screenShared = true;
    accumulators.set(key, base);
  }

  const ordered = [...events].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

  for (const event of ordered) {
    // room_started / room_finished no traen identity: no participan del resumen.
    if (!event.livekitIdentity) continue;
    const identity = identityByLivekitIdentity.get(event.livekitIdentity);
    // Defensivo: no debería pasar porque la correlación se escribe antes de
    // emitir el token, pero un evento huérfano no debe tirar la agregación.
    if (!identity) continue;

    switch (event.eventType) {
      case 'participant_joined':
        openJoinByIdentity.set(event.livekitIdentity, event.occurredAt);
        break;
      case 'participant_left': {
        const joinedAt = openJoinByIdentity.get(event.livekitIdentity);
        if (joinedAt) {
          closeInterval(identity, joinedAt, event.occurredAt);
          openJoinByIdentity.delete(event.livekitIdentity);
        }
        break;
      }
      case 'track_published':
        markTrack(identity, event.trackSource);
        break;
      default:
        // track_unpublished y cualquier otro tipo no afectan el resumen:
        // spoke/screenShared ya quedaron en true con el track_published.
        break;
    }
  }

  // Cierre implícito: cualquier join que nunca recibió su participant_left
  // (navegador colgado) se cierra con fallbackEndAt (spec
  // timeline/cierre-implícito).
  for (const [livekitIdentity, joinedAt] of openJoinByIdentity) {
    const identity = identityByLivekitIdentity.get(livekitIdentity);
    if (!identity) continue;
    closeInterval(identity, joinedAt, fallbackEndAt);
  }

  return [...accumulators.entries()]
    .map(([participantKey, acc]) => ({
      participantKey,
      userId: acc.userId,
      displayName: acc.displayName,
      isGuest: acc.isGuest,
      firstJoinedAt: acc.firstJoinedAt,
      lastLeftAt: acc.lastLeftAt,
      totalSeconds: acc.totalSeconds,
      spoke: acc.spoke,
      screenShared: acc.screenShared,
      rejoinCount: Math.max(0, acc.intervalCount - 1),
    }))
    .sort((a, b) => a.firstJoinedAt.getTime() - b.firstJoinedAt.getTime());
}

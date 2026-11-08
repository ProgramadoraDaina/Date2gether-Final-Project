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

// Las únicas fuentes de track que la línea de tiempo dibuja como intervalo
// propio. `screen_share_audio` (el audio del tab compartido) se ignora: no
// hay nada visual que mostrar distinto de `screen_share` para este producto.
export type TrackIntervalSource = 'camera' | 'microphone' | 'screen_share';

const TRACKED_SOURCES: readonly string[] = ['camera', 'microphone', 'screen_share'];

function isTrackedSource(source: string | null): source is TrackIntervalSource {
  return !!source && TRACKED_SOURCES.includes(source);
}

// Un intervalo real "prendido → apagado" de cámara/mic/pantalla, con hora
// exacta de cada extremo. A diferencia de `spoke`/`screenShared` (que solo
// dicen "pasó alguna vez"), esto reconstruye CUÁNDO y permite prender/apagar
// varias veces en la misma sesión.
export interface TrackInterval {
  source: TrackIntervalSource;
  startedAt: Date;
  endedAt: Date;
}

export interface ParticipantSummary {
  participantKey: string;
  userId: string | null;
  displayName: string;
  isGuest: boolean;
  firstJoinedAt: Date;
  lastLeftAt: Date;
  totalSeconds: number;
  // Derivados de trackIntervals (algún intervalo de esa fuente existe):
  // se conservan como booleanos aparte porque ya los usan vistas que solo
  // necesitan "¿pasó o no?", sin la granularidad de los intervalos.
  spoke: boolean;
  screenShared: boolean;
  rejoinCount: number;
  trackIntervals: TrackInterval[];
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
  trackIntervals: TrackInterval[];
  intervalCount: number;
}

// Pliega varias identities aleatorias de la misma persona (reconexiones) en
// una sola clave: la cuenta si la hay, o el nombre del invitado en minúsculas.
function participantKeyOf(identity: IdentityCorrelation): string {
  return identity.userId ?? `guest:${identity.displayName.toLowerCase()}`;
}

// Separador que no puede aparecer en un identity de LiveKit (son uuid/random
// strings): seguro para componer la clave compuesta identity+fuente sin
// colisionar con un identity que por casualidad contenga la fuente como texto.
const TRACK_KEY_SEP = ' ';

function trackKey(livekitIdentity: string, source: TrackIntervalSource): string {
  return `${livekitIdentity}${TRACK_KEY_SEP}${source}`;
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
  // Mismo criterio que openJoinByIdentity, pero por identity+fuente de track:
  // una identity puede tener cámara Y mic abiertos a la vez, cada uno con su
  // propio intervalo independiente.
  const openTrackByKey = new Map<string, Date>();

  function ensureAccumulator(identity: IdentityCorrelation): ParticipantAccumulator {
    const key = participantKeyOf(identity);
    const existing = accumulators.get(key);
    if (existing) return existing;
    const created: ParticipantAccumulator = {
      userId: identity.userId,
      displayName: identity.displayName,
      isGuest: identity.userId === null,
      firstJoinedAt: fallbackEndAt,
      lastLeftAt: fallbackEndAt,
      totalSeconds: 0,
      trackIntervals: [],
      intervalCount: 0,
    };
    accumulators.set(key, created);
    return created;
  }

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
        trackIntervals: existing?.trackIntervals ?? [],
        intervalCount: 1,
      });
      return;
    }

    existing.totalSeconds += seconds;
    existing.intervalCount += 1;
    if (joinedAt < existing.firstJoinedAt) existing.firstJoinedAt = joinedAt;
    if (leftAt > existing.lastLeftAt) existing.lastLeftAt = leftAt;
  }

  // Intervalo real "prendido → apagado" ya cerrado (por su unpublish, o por
  // el cierre implícito al final de esta función). Ignora duraciones <= 0
  // (defensivo: no debería pasar, pero un reloj desordenado no debe generar
  // una barra con ancho negativo en el frontend).
  function closeTrackInterval(
    identity: IdentityCorrelation,
    source: TrackIntervalSource,
    startedAt: Date,
    endedAt: Date,
  ): void {
    if (endedAt.getTime() <= startedAt.getTime()) return;
    ensureAccumulator(identity).trackIntervals.push({ source, startedAt, endedAt });
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
      // `track_unmuted`/`track_muted` no vienen del webhook de LiveKit (ese
      // nunca los manda): los reporta el propio cliente, porque
      // setMicrophoneEnabled/setCameraEnabled solo mutean el track ya
      // publicado después de la primera vez (ver CallsService.reportTrackState).
      // Se tratan como el mismo abrir/cerrar que publish/unpublish porque,
      // para esta línea de tiempo, "muteado" y "no publicado" significan lo
      // mismo: la fuente está apagada.
      case 'track_published':
      case 'track_unmuted':
        if (isTrackedSource(event.trackSource)) {
          openTrackByKey.set(trackKey(event.livekitIdentity, event.trackSource), event.occurredAt);
        }
        break;
      case 'track_unpublished':
      case 'track_muted':
        if (isTrackedSource(event.trackSource)) {
          const key = trackKey(event.livekitIdentity, event.trackSource);
          const startedAt = openTrackByKey.get(key);
          if (startedAt) {
            closeTrackInterval(identity, event.trackSource, startedAt, event.occurredAt);
            openTrackByKey.delete(key);
          }
        }
        break;
      default:
        break;
    }
  }

  // Cierre implícito: cualquier join que nunca recibió su participant_left
  // (navegador colgado) se cierra con fallbackEndAt (spec
  // timeline/cierre-implícito). Mismo criterio para un track que quedó
  // prendido sin su unpublish (p. ej. colgó con la cámara encendida).
  for (const [livekitIdentity, joinedAt] of openJoinByIdentity) {
    const identity = identityByLivekitIdentity.get(livekitIdentity);
    if (!identity) continue;
    closeInterval(identity, joinedAt, fallbackEndAt);
  }
  for (const [key, startedAt] of openTrackByKey) {
    const [livekitIdentity, source] = key.split(TRACK_KEY_SEP) as [string, TrackIntervalSource];
    const identity = identityByLivekitIdentity.get(livekitIdentity);
    if (!identity) continue;
    closeTrackInterval(identity, source, startedAt, fallbackEndAt);
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
      spoke: acc.trackIntervals.some((ti) => ti.source === 'microphone'),
      screenShared: acc.trackIntervals.some((ti) => ti.source === 'screen_share'),
      rejoinCount: Math.max(0, acc.intervalCount - 1),
      trackIntervals: [...acc.trackIntervals].sort(
        (a, b) => a.startedAt.getTime() - b.startedAt.getTime(),
      ),
    }))
    .sort((a, b) => a.firstJoinedAt.getTime() - b.firstJoinedAt.getTime());
}

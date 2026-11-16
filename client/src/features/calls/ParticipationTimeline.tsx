import type { CallSessionParticipantSummary, TrackInterval, TrackIntervalSource } from '@/lib/api';
import { useTranslation } from '@/features/translation/useTranslation';
import { NAME_COLOR_HEX, resolveNameColorId } from '@/lib/nameColors';
import { InitialsAvatar } from './InitialsAvatar';
import styles from './ParticipationTimeline.module.css';

interface ParticipationTimelineProps {
  participants: CallSessionParticipantSummary[];
  startedAt: string;
  endedAt: string | null;
}

// mm:ss simple: una sesión de videollamada no llega a durar horas enteras en
// este producto, así que no hace falta un formateador de horas.
function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

// m:ss compacto para las marcas del eje: con varias marcas en la misma regla,
// "5m 0s" repetido se vuelve ruido visual. Acá sí importa el formato denso.
function formatClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

// Candidatos de intervalo para las marcas del eje, de más fino a más grueso.
// Se elige el primero que deje como máximo 6 marcas intermedias, para que ni
// una llamada de 40 segundos ni una de 2 horas saturen la regla de ticks.
const TICK_CANDIDATES_SEC = [15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200];

function pickTickIntervalSeconds(totalSeconds: number): number {
  const found = TICK_CANDIDATES_SEC.find((candidate) => totalSeconds / candidate <= 6);
  return found ?? TICK_CANDIDATES_SEC[TICK_CANDIDATES_SEC.length - 1];
}

// Marcas intermedias en múltiplos del intervalo elegido, más el cierre exacto
// al final. El cierre se agrega siempre y las marcas demasiado cercanas a él
// se descartan para que las etiquetas no se pisen entre sí.
function buildAxisTicks(totalSeconds: number): number[] {
  const interval = pickTickIntervalSeconds(totalSeconds);
  const ticks: number[] = [0];
  for (let t = interval; t < totalSeconds - interval * 0.4; t += interval) {
    ticks.push(t);
  }
  ticks.push(totalSeconds);
  return ticks;
}

// Mínimo de ancho visible: un intervalo casi instantáneo (p. ej. alguien que
// prende y apaga la cámara en el mismo segundo) no debe desaparecer del todo.
const MIN_SEGMENT_WIDTH_PCT = 1;

function clampPct(value: number): number {
  return Math.min(100, Math.max(0, value));
}

// left/width de una franja o de la barra de presencia, ya con el ancho
// mínimo aplicado. Si el intervalo real es casi puntual y termina pegado al
// borde derecho (p. ej. alguien que se va justo cuando termina la sesión),
// sumarle MIN_SEGMENT_WIDTH_PCT al ancho sin tocar el inicio empuja el
// borde derecho más allá del 100% — nada lo recorta, así que asomaba un
// pedacito suelto en el borde del gráfico. Ancla el inicio hacia la
// izquierda en ese caso en vez de desbordar el contenedor.
function boxPct(startPct: number, endPct: number): { leftPct: number; widthPct: number } {
  const left = clampPct(startPct);
  const widthPct = Math.max(clampPct(endPct) - left, MIN_SEGMENT_WIDTH_PCT);
  return { leftPct: Math.min(left, 100 - widthPct), widthPct };
}

// Paleta categórica validada en globals.css (ver --timeline-* ahí): cámara/
// mic/pantalla compartida se distinguen entre sí en los dos temas, incluso
// simulando daltonismo. Antes cámara y "se reconectó" eran hex sueltos acá
// mismo, fijos sin importar el tema — por eso no se notaba al cambiar a modo
// oscuro, nunca reaccionaban.
const CAMERA_COLOR = 'var(--timeline-camera)';
const MIC_COLOR = 'var(--timeline-mic)';
const SCREEN_SHARE_COLOR = 'var(--timeline-screen-share)';
const REJOIN_COLOR = 'var(--timeline-rejoin)';

// Mismas formas que en MeetingRoom.tsx/PreCallLobby.tsx (cámara y mic): la
// identidad de cada carril ahora vive en un ícono fijo a la izquierda, no
// solo en el color — el color solo no alcanza para daltonismo ni para
// franjas demasiado angostas como para llevar texto adentro.
function CameraIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="11"
      height="11"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="6" width="13" height="12" rx="2" />
      <path d="M16 10l5-3v10l-5-3" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="11"
      height="11"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <line x1="12" y1="18" x2="12" y2="22" />
      <line x1="8" y1="22" x2="16" y2="22" />
    </svg>
  );
}

function ScreenShareIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="11"
      height="11"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8" />
      <path d="M12 16v4" />
    </svg>
  );
}

// Dos flechas en círculo: convención estándar de "se reconectó"/refresh, no
// hay una forma de "reconexión" propia que inventar acá.
function RejoinIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="11"
      height="11"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 12a9 9 0 0 1 15.3-6.4L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15.3 6.4L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  );
}

const LANE_ICON: Record<TrackIntervalSource, () => React.JSX.Element> = {
  camera: CameraIcon,
  microphone: MicIcon,
  screen_share: ScreenShareIcon,
};

const LANES: Array<{ source: TrackIntervalSource; color: string; textColor?: string }> = [
  { source: 'camera', color: CAMERA_COLOR },
  { source: 'microphone', color: MIC_COLOR },
  { source: 'screen_share', color: SCREEN_SHARE_COLOR, textColor: 'var(--color-accent-contrast)' },
];

const LANE_LABEL_KEY: Record<TrackIntervalSource, string> = {
  camera: 'Cámara encendida',
  microphone: 'Habló',
  screen_share: 'Compartió pantalla',
};

export function ParticipationTimeline({
  participants,
  startedAt,
  endedAt,
}: ParticipationTimelineProps) {
  const { t, language } = useTranslation();
  const locale = language === 'en' ? 'en-US' : 'es-AR';

  function formatTime(iso: string | null): string {
    if (!iso) return '—';
    return new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(new Date(iso));
  }

  if (participants.length === 0) {
    return <p>{t('Esta sesión no tiene participantes registrados.')}</p>;
  }

  const sessionStartMs = new Date(startedAt).getTime();
  // Si todavía no llegó room_finished, usamos la última salida conocida como
  // borde derecho del eje: es la mejor aproximación disponible al momento de
  // renderizar, sin esperar a que se materialice la sesión.
  const fallbackEndMs = Math.max(
    sessionStartMs,
    ...participants.map((p) => (p.lastLeftAt ? new Date(p.lastLeftAt).getTime() : sessionStartMs)),
  );
  const sessionEndMs = endedAt ? new Date(endedAt).getTime() : fallbackEndMs;
  const totalDurationMs = Math.max(sessionEndMs - sessionStartMs, 1000);
  const totalDurationSeconds = Math.round(totalDurationMs / 1000);
  const axisTicks = buildAxisTicks(totalDurationSeconds);

  function pctFor(iso: string): number {
    return clampPct(((new Date(iso).getTime() - sessionStartMs) / totalDurationMs) * 100);
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.legend}>
        <span className={styles.legendItem}>
          <span className={styles.legendIcon} style={{ backgroundColor: CAMERA_COLOR }}>
            <CameraIcon />
          </span>
          {t('Cámara')}
        </span>
        <span className={styles.legendItem}>
          <span className={styles.legendIcon} style={{ backgroundColor: MIC_COLOR }}>
            <MicIcon />
          </span>
          {t('Habló')}
        </span>
        <span className={styles.legendItem}>
          <span
            className={styles.legendIcon}
            style={{ backgroundColor: SCREEN_SHARE_COLOR, color: 'var(--color-accent-contrast)' }}
          >
            <ScreenShareIcon />
          </span>
          {t('Compartió pantalla')}
        </span>
        <span className={styles.legendItem}>
          <span className={styles.legendIcon} style={{ backgroundColor: REJOIN_COLOR }}>
            <RejoinIcon />
          </span>
          {t('Se reconectó')}
        </span>
      </div>

      <div className={styles.axis} aria-hidden="true">
        <span className={styles.axisSpacer} />
        <div className={styles.axisTrack}>
          {axisTicks.map((seconds) => (
            <span
              key={seconds}
              className={styles.axisTick}
              style={{ left: `${clampPct((seconds / totalDurationSeconds) * 100)}%` }}
            >
              <span className={styles.axisTickMark} />
              <span className={styles.axisTickLabel}>{formatClock(seconds)}</span>
            </span>
          ))}
        </div>
      </div>

      <div className={styles.panel}>
        <ul className={styles.list}>
          {participants.map((participant) => {
            const colorId = resolveNameColorId(participant.displayName, participant.nameColor);
            const presenceColor = NAME_COLOR_HEX[colorId];
            const joinMs = new Date(participant.firstJoinedAt).getTime();
            const leaveMs = participant.lastLeftAt
              ? new Date(participant.lastLeftAt).getTime()
              : sessionEndMs;
            const { leftPct: presenceLeftPct, widthPct: presenceWidthPct } = boxPct(
              ((joinMs - sessionStartMs) / totalDurationMs) * 100,
              ((leaveMs - sessionStartMs) / totalDurationMs) * 100,
            );

            const intervalsBySource = new Map<TrackIntervalSource, TrackInterval[]>();
            for (const interval of participant.trackIntervals) {
              const list = intervalsBySource.get(interval.source) ?? [];
              list.push(interval);
              intervalsBySource.set(interval.source, list);
            }

            return (
              <li key={participant.participantKey} className={styles.entry}>
                <div className={styles.sidebar}>
                  <InitialsAvatar
                    name={participant.displayName}
                    nameColor={participant.nameColor}
                    size={44}
                  />
                  <div className={styles.sidebarText}>
                    <strong>{participant.displayName}</strong>
                    {participant.isGuest && (
                      <span className={styles.guestTag}>{t('Invitado')}</span>
                    )}
                  </div>
                </div>

                <div className={styles.entryBody}>
                  <div className={styles.track}>
                    {/* Columna fija fuera del área mapeada a porcentaje: el
                        ícono identifica el carril aunque el segmento sea
                        angosto o el color solo no alcance (daltonismo). */}
                    <div className={styles.laneIcons} aria-hidden="true">
                      {LANES.map(({ source, color, textColor }) => {
                        const Icon = LANE_ICON[source];
                        return (
                          <span
                            key={source}
                            className={styles.laneIcon}
                            style={{ backgroundColor: color, color: textColor ?? '#fff' }}
                          >
                            <Icon />
                          </span>
                        );
                      })}
                    </div>
                    <div className={styles.timelineArea}>
                      <div
                        className={styles.presenceBackdrop}
                        style={{
                          left: `${presenceLeftPct}%`,
                          width: `${presenceWidthPct}%`,
                          backgroundColor: `color-mix(in srgb, ${presenceColor} 18%, transparent)`,
                        }}
                      />
                      <div className={styles.lanes}>
                        {LANES.map(({ source, color }) => (
                          <div key={source} className={styles.lane}>
                            {(intervalsBySource.get(source) ?? []).map((interval, index) => {
                              const { leftPct, widthPct } = boxPct(
                                pctFor(interval.startedAt),
                                pctFor(interval.endedAt),
                              );
                              const seconds = Math.max(
                                0,
                                Math.round(
                                  (new Date(interval.endedAt).getTime() -
                                    new Date(interval.startedAt).getTime()) /
                                    1000,
                                ),
                              );
                              const label = t(LANE_LABEL_KEY[source]);

                              return (
                                <div
                                  key={index}
                                  className={styles.segmentWrap}
                                  style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                                  tabIndex={0}
                                >
                                  <div className={styles.segment} style={{ backgroundColor: color }} />
                                  <div className={styles.segmentTooltip}>
                                    <strong>{label}</strong>
                                    <span>
                                      {participant.displayName} · {formatTime(interval.startedAt)}–
                                      {formatTime(interval.endedAt)} ({formatDuration(seconds)})
                                    </span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className={styles.entryTimes}>
                    <span>
                      {t('Entró')}: {formatTime(participant.firstJoinedAt)}
                    </span>
                    <span>
                      {t('Salió')}: {formatTime(participant.lastLeftAt)}
                    </span>
                    <span>
                      {t('Duración')}: {formatDuration(participant.totalSeconds)}
                    </span>
                  </div>

                  {/* Fuente confiable de spoke/screenShared/rejoin: a diferencia
                      de los carriles de arriba, no depende de que haya ancho
                      suficiente para no recortarse. */}
                  {(participant.spoke || participant.screenShared || participant.rejoinCount > 0) && (
                    <div className={styles.chips}>
                      {participant.spoke && (
                        <span className={styles.chip} style={{ backgroundColor: MIC_COLOR }}>
                          <MicIcon />
                          {t('Habló')}
                        </span>
                      )}
                      {participant.screenShared && (
                        <span
                          className={styles.chip}
                          style={{
                            backgroundColor: SCREEN_SHARE_COLOR,
                            color: 'var(--color-accent-contrast)',
                          }}
                        >
                          <ScreenShareIcon />
                          {t('Compartió pantalla')}
                        </span>
                      )}
                      {participant.rejoinCount > 0 && (
                        <span className={styles.chip} style={{ backgroundColor: REJOIN_COLOR }}>
                          <RejoinIcon />
                          {t('Se reconectó')} {participant.rejoinCount}x
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        <p className={styles.summary}>
          {t('Duración total')}: {formatDuration(totalDurationSeconds)} ·{' '}
          {participants.length === 1
            ? t('1 participante')
            : `${participants.length} ${t('participantes')}`}
        </p>
      </div>
    </div>
  );
}

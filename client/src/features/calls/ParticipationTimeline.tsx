import type { CallSessionParticipantSummary } from '@/lib/api';
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

// Mínimo de ancho visible: una entrada/salida casi instantánea (p. ej. alguien
// que se cae apenas conectado) no debe desaparecer del todo de la barra.
const MIN_BAR_WIDTH_PCT = 1.5;
// Por debajo de este ancho no vale la pena intentar meter texto/íconos adentro
// de la barra: `overflow: hidden` en `.bar` se encarga de recortar prolijo
// cualquier caso intermedio en vez de calcular un umbral exacto por contenido.
const MIN_WIDTH_FOR_LABEL_PCT = 12;

function clampPct(value: number): number {
  return Math.min(100, Math.max(0, value));
}

// Paleta de estado para los tres eventos que sí podemos afirmar que pasaron
// (aunque no sepamos cuándo exactamente): reutiliza los tokens de la app
// donde existen, y solo define un ámbar propio para "se reconectó" porque
// no hay un token de advertencia global.
const SPOKE_COLOR = 'var(--color-success)';
const SCREEN_SHARE_COLOR = 'var(--color-accent)';
const REJOIN_COLOR = '#e9a23b';

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

  return (
    <div className={styles.wrapper}>
      <div className={styles.legend}>
        <span className={styles.legendItem}>
          <span className={styles.legendDot} style={{ backgroundColor: SPOKE_COLOR }} />
          {t('Habló')}
        </span>
        <span className={styles.legendItem}>
          <span className={styles.legendDot} style={{ backgroundColor: SCREEN_SHARE_COLOR }} />
          {t('Compartió pantalla')}
        </span>
        <span className={styles.legendItem}>
          <span className={styles.legendDot} style={{ backgroundColor: REJOIN_COLOR }} />
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
            const barColor = NAME_COLOR_HEX[colorId];
            const joinMs = new Date(participant.firstJoinedAt).getTime();
            const leaveMs = participant.lastLeftAt
              ? new Date(participant.lastLeftAt).getTime()
              : sessionEndMs;
            const leftPct = clampPct(((joinMs - sessionStartMs) / totalDurationMs) * 100);
            const rightPct = clampPct(((leaveMs - sessionStartMs) / totalDurationMs) * 100);
            const widthPct = Math.max(rightPct - leftPct, MIN_BAR_WIDTH_PCT);
            const showLabel = widthPct >= MIN_WIDTH_FOR_LABEL_PCT;

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
                  <div
                    className={styles.track}
                    title={`${t('Entró')}: ${formatTime(participant.firstJoinedAt)} · ${t('Salió')}: ${formatTime(participant.lastLeftAt)}`}
                  >
                    <div
                      className={styles.bar}
                      style={{
                        left: `${leftPct}%`,
                        width: `${widthPct}%`,
                        borderColor: barColor,
                        backgroundColor: `color-mix(in srgb, ${barColor} 35%, transparent)`,
                      }}
                    >
                      {showLabel && (
                        <>
                          <span className={styles.barLabel}>
                            {formatDuration(participant.totalSeconds)}
                          </span>
                          {participant.spoke && (
                            <span
                              className={styles.barBadge}
                              style={{ backgroundColor: SPOKE_COLOR }}
                            >
                              {t('Habló')}
                            </span>
                          )}
                          {participant.screenShared && (
                            <span
                              className={styles.barBadge}
                              style={{
                                backgroundColor: SCREEN_SHARE_COLOR,
                                color: 'var(--color-accent-contrast)',
                              }}
                            >
                              {t('Compartió pantalla')}
                            </span>
                          )}
                        </>
                      )}
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
                      de la etiqueta dentro de la barra, no depende de que haya
                      ancho suficiente para no recortarse. */}
                  {(participant.spoke || participant.screenShared || participant.rejoinCount > 0) && (
                    <div className={styles.chips}>
                      {participant.spoke && (
                        <span className={styles.chip} style={{ backgroundColor: SPOKE_COLOR }}>
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
                          {t('Compartió pantalla')}
                        </span>
                      )}
                      {participant.rejoinCount > 0 && (
                        <span className={styles.chip} style={{ backgroundColor: REJOIN_COLOR }}>
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

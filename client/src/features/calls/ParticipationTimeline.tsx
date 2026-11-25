import type { CallSessionParticipantSummary, TrackInterval, TrackIntervalSource } from '@/lib/api';
import { useTranslation } from '@/features/translation/useTranslation';
import { InitialsAvatar } from './InitialsAvatar';
import styles from './ParticipationTimeline.module.css';

interface ParticipationTimelineProps {
  participants: CallSessionParticipantSummary[];
  startedAt: string;
  endedAt: string | null;
}

function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

const MINUTE_MS = 60_000;
// Pasos del eje en minutos: se usa el primero que deje como mucho 6 marcas.
const TICK_STEPS_MIN = [1, 2, 5, 10, 15, 30, 60, 120];
// Una marca intermedia pegada al inicio o al fin taparía la hora exacta del borde.
const EDGE_GAP_PCT = 9;

// Marcas en horas redondas del reloj (18:36, 18:38…), no en minutos desde el inicio.
export function buildClockTicks(startMs: number, endMs: number): number[] {
  const total = endMs - startMs;
  const step =
    (TICK_STEPS_MIN.find((minutes) => total / (minutes * MINUTE_MS) <= 6) ?? 120) * MINUTE_MS;
  const ticks: number[] = [];
  for (let at = Math.ceil(startMs / step) * step; at < endMs; at += step) {
    const pct = ((at - startMs) / total) * 100;
    if (pct > EDGE_GAP_PCT && pct < 100 - EDGE_GAP_PCT) ticks.push(at);
  }
  return ticks;
}

// Un intervalo de un segundo tiene que seguir viéndose.
const MIN_SEGMENT_WIDTH_PCT = 0.6;

function clampPct(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function boxPct(startPct: number, endPct: number): { leftPct: number; widthPct: number } {
  const left = clampPct(startPct);
  const widthPct = Math.max(clampPct(endPct) - left, MIN_SEGMENT_WIDTH_PCT);
  return { leftPct: Math.min(left, 100 - widthPct), widthPct };
}

// Cada carril tiene un significado fijo; el color de nombre queda solo en el avatar.
const LANES: Array<{ source: TrackIntervalSource; label: string; legend: string }> = [
  { source: 'camera', label: 'Cámara', legend: 'Cámara encendida' },
  { source: 'microphone', label: 'Habló', legend: 'Habló' },
  { source: 'screen_share', label: 'Pantalla', legend: 'Compartió pantalla' },
];

export function ParticipationTimeline({
  participants,
  startedAt,
  endedAt,
}: ParticipationTimelineProps) {
  const { t, language } = useTranslation();
  const locale = language === 'en' ? 'en-US' : 'es-AR';
  const clock = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' });

  function formatTime(value: string | number | null): string {
    if (value === null) return '—';
    return clock.format(new Date(value));
  }

  if (participants.length === 0) {
    return <p>{t('Esta sesión no tiene participantes registrados.')}</p>;
  }

  const sessionStartMs = new Date(startedAt).getTime();
  // Sin room_finished todavía, la última salida conocida hace de borde derecho.
  const fallbackEndMs = Math.max(
    sessionStartMs,
    ...participants.map((p) => (p.lastLeftAt ? new Date(p.lastLeftAt).getTime() : sessionStartMs)),
  );
  const sessionEndMs = endedAt ? new Date(endedAt).getTime() : fallbackEndMs;
  const totalDurationMs = Math.max(sessionEndMs - sessionStartMs, 1000);
  const totalDurationSeconds = Math.round(totalDurationMs / 1000);
  const ticks = buildClockTicks(sessionStartMs, sessionStartMs + totalDurationMs);

  const pctAt = (ms: number) => clampPct(((ms - sessionStartMs) / totalDurationMs) * 100);
  const pctFor = (iso: string) => pctAt(new Date(iso).getTime());

  const gridLines = (
    <div className={styles.gridLines} aria-hidden="true">
      {ticks.map((at) => (
        <span key={at} className={styles.gridLine} style={{ left: `${pctAt(at)}%` }} />
      ))}
    </div>
  );

  return (
    <div className={styles.wrapper}>
      <ul className={styles.legend} aria-label={t('Referencias')}>
        <li className={styles.legendItem}>
          <span className={`${styles.swatch} ${styles.presenceSwatch}`} />
          {t('En la llamada')}
        </li>
        {LANES.map(({ source, legend }) => (
          <li key={source} className={styles.legendItem}>
            <span className={styles.swatch} data-source={source} />
            {t(legend)}
          </li>
        ))}
      </ul>

      <div className={styles.panel}>
        <div className={styles.axisRow} aria-hidden="true">
          <span />
          <div className={styles.axis}>
            <span className={`${styles.tick} ${styles.tickStart}`} style={{ left: '0%' }}>
              {formatTime(sessionStartMs)}
            </span>
            {ticks.map((at) => (
              <span key={at} className={styles.tick} style={{ left: `${pctAt(at)}%` }}>
                {formatTime(at)}
              </span>
            ))}
            <span className={`${styles.tick} ${styles.tickEnd}`} style={{ left: '100%' }}>
              {formatTime(sessionEndMs)}
            </span>
          </div>
        </div>

        <ul className={styles.list}>
          {participants.map((participant) => {
            const joinMs = new Date(participant.firstJoinedAt).getTime();
            const leaveMs = participant.lastLeftAt
              ? new Date(participant.lastLeftAt).getTime()
              : sessionEndMs;
            const presence = boxPct(pctAt(joinMs), pctAt(leaveMs));
            const intervalsBySource = new Map<TrackIntervalSource, TrackInterval[]>();
            for (const interval of participant.trackIntervals) {
              const list = intervalsBySource.get(interval.source) ?? [];
              list.push(interval);
              intervalsBySource.set(interval.source, list);
            }

            return (
              <li key={participant.participantKey} className={styles.entry}>
                <div className={styles.person}>
                  <InitialsAvatar
                    name={participant.displayName}
                    nameColor={participant.nameColor}
                    size={36}
                  />
                  <div className={styles.personText}>
                    <strong>{participant.displayName}</strong>
                    {participant.isGuest && (
                      <span className={styles.guestTag}>{t('Invitado')}</span>
                    )}
                    <span className={styles.personTimes}>
                      {formatTime(participant.firstJoinedAt)} → {formatTime(participant.lastLeftAt)}{' '}
                      · {formatDuration(participant.totalSeconds)}
                    </span>
                  </div>
                </div>

                <div className={styles.rows}>
                  <div className={styles.row}>
                    <span className={styles.rowLabel}>{t('En la llamada')}</span>
                    <div className={styles.timelineArea}>
                      <div
                        className={styles.presence}
                        style={{ left: `${presence.leftPct}%`, width: `${presence.widthPct}%` }}
                        title={`${t('Entró')} ${formatTime(participant.firstJoinedAt)} · ${t('Salió')} ${formatTime(participant.lastLeftAt)}`}
                      />
                      {gridLines}
                    </div>
                  </div>
                  {LANES.map(({ source, label, legend }) => (
                    <div key={source} className={styles.row}>
                      <span className={styles.rowLabel}>{t(label)}</span>
                      <div className={`${styles.timelineArea} ${styles.lane}`}>
                        {gridLines}
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
                          return (
                            <div
                              key={index}
                              className={styles.segmentWrap}
                              style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                              tabIndex={0}
                            >
                              <div className={styles.segment} data-source={source} />
                              <div className={styles.segmentTooltip}>
                                <strong>{t(legend)}</strong>
                                <span>
                                  {participant.displayName} · {formatTime(interval.startedAt)}–
                                  {formatTime(interval.endedAt)} ({formatDuration(seconds)})
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}

                  {(participant.spoke ||
                    participant.screenShared ||
                    participant.rejoinCount > 0) && (
                    <div className={styles.chips}>
                      {participant.spoke && (
                        <span className={styles.chip} data-source="microphone">
                          {t('Habló')}
                        </span>
                      )}
                      {participant.screenShared && (
                        <span className={styles.chip} data-source="screen_share">
                          {t('Compartió pantalla')}
                        </span>
                      )}
                      {participant.rejoinCount > 0 && (
                        <span className={styles.chip} data-source="rejoin">
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
          {formatTime(sessionStartMs)} → {formatTime(sessionEndMs)} · {t('Duración total')}:{' '}
          {formatDuration(totalDurationSeconds)} ·{' '}
          {participants.length === 1
            ? t('1 participante')
            : `${participants.length} ${t('participantes')}`}
        </p>
      </div>
    </div>
  );
}

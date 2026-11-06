import type { CallSessionParticipantSummary } from '@/lib/api';
import { useTranslation } from '@/features/translation/useTranslation';
import { InitialsAvatar } from './InitialsAvatar';
import styles from './ParticipationTimeline.module.css';

interface ParticipationTimelineProps {
  participants: CallSessionParticipantSummary[];
}

// mm:ss simple: una sesión de videollamada no llega a durar horas enteras en
// este producto, así que no hace falta un formateador de horas.
function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

// Lista de participación materializada por sesión (PR5: GET
// /calls/sessions/:sessionId/timeline). Cada fila es ya un resumen agregado
// por `aggregateSession()` del lado del servidor: una sola entrada por
// persona, aunque se haya reconectado varias veces.
export function ParticipationTimeline({ participants }: ParticipationTimelineProps) {
  const { t, language } = useTranslation();
  const locale = language === 'en' ? 'en-US' : 'es-AR';

  function formatTime(iso: string | null): string {
    if (!iso) return '—';
    return new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(new Date(iso));
  }

  if (participants.length === 0) {
    return <p>{t('Esta sesión no tiene participantes registrados.')}</p>;
  }

  return (
    <ul className={styles.list}>
      {participants.map((participant) => (
        <li key={participant.participantKey} className={styles.entry}>
          <InitialsAvatar name={participant.displayName} nameColor={participant.nameColor} />
          <div className={styles.entryBody}>
            <div className={styles.entryHeader}>
              <strong>{participant.displayName}</strong>
              {participant.isGuest && <span className={styles.guestTag}>{t('Invitado')}</span>}
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
            {(participant.spoke || participant.screenShared) && (
              <div className={styles.chips}>
                {participant.spoke && <span className={styles.chip}>{t('Habló')}</span>}
                {participant.screenShared && (
                  <span className={styles.chip}>{t('Compartió pantalla')}</span>
                )}
              </div>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

import { useTranslation } from '../translation/useTranslation';
import styles from './NextOccurrence.module.css';

interface NextOccurrenceProps {
  // ISO-8601 UTC instant from GET /rooms/:code/schedule/next, or null when
  // the room has no upcoming slot. Never a timezone -- the response shape
  // itself has no field that could carry the owner's zone (design.md D6);
  // Intl.DateTimeFormat(undefined, …) below resolves the VIEWER's own zone.
  nextOccurrenceAt: string | null;
}

export function NextOccurrence({ nextOccurrenceAt }: NextOccurrenceProps) {
  const { t } = useTranslation();

  if (!nextOccurrenceAt) {
    return <p className={styles.empty}>{t('Esta sala no tiene un próximo horario programado.')}</p>;
  }

  const formatted = new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(nextOccurrenceAt));

  return (
    <p className={styles.notice}>
      {t('Próximo encuentro programado:')} <strong>{formatted}</strong>
    </p>
  );
}

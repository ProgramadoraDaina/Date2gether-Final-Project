'use client';

import { useTranslation } from '../translation/useTranslation';
import type { BreakoutAssignment } from '../chat/useRoomSocket';
import { formatCountdown, useCountdown } from './useCountdown';
import styles from './BreakoutSelfStatus.module.css';

interface BreakoutSelfStatusProps {
  assignment: BreakoutAssignment;
  onReturn: () => void;
  returning?: boolean;
}

// Sin botón "Volver" en salas locked: el texto explícito evita la sensación de estar atrapado.
export function BreakoutSelfStatus({
  assignment,
  onReturn,
  returning = false,
}: BreakoutSelfStatusProps) {
  const { t } = useTranslation();
  const canReturnFreely = assignment.leavePolicy === 'free_return';
  const left = useCountdown(assignment.closesAt ?? null);

  return (
    <div className={styles.banner} role="status">
      <span className={styles.kicker}>{t('Mini sala')}</span>
      <span className={styles.label}>{assignment.label}</span>
      {left !== null && (
        <>
          <span className={styles.divider} aria-hidden="true" />
          <span className={styles.countdownText}>{t('Volvés a la sala principal en')}</span>
          <span className={styles.clock} role="timer">
            {formatCountdown(left)}
          </span>
        </>
      )}
      {canReturnFreely ? (
        <button
          type="button"
          className={styles.returnButton}
          onClick={onReturn}
          disabled={returning}
        >
          {t('Volver')}
        </button>
      ) : (
        <span className={styles.lockedNotice}>
          {t('El host te va a devolver a la sala principal.')}
        </span>
      )}
      {left !== null && (
        <span className={styles.track} aria-hidden="true">
          <span className={styles.fill} />
        </span>
      )}
    </div>
  );
}

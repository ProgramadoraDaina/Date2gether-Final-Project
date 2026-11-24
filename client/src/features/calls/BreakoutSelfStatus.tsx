'use client';

import { createPortal } from 'react-dom';
import { useRef } from 'react';
import { useTranslation } from '../translation/useTranslation';
import type { BreakoutAssignment } from '../chat/useRoomSocket';
import { formatCountdown, useCountdown } from './useCountdown';
import styles from './BreakoutSelfStatus.module.css';

interface BreakoutSelfStatusProps {
  assignment: BreakoutAssignment;
  onReturn: () => void;
  returning?: boolean;
}

const URGENT_SECONDS = 10;

// Sin botón "Volver" en salas locked: el texto explícito evita la sensación de estar atrapado.
export function BreakoutSelfStatus({
  assignment,
  onReturn,
  returning = false,
}: BreakoutSelfStatusProps) {
  const { t } = useTranslation();
  const canReturnFreely = assignment.leavePolicy === 'free_return';
  const closesAt = assignment.closesAt ?? null;
  const left = useCountdown(closesAt);
  // La barra se vacía respecto del tiempo que quedaba cuando llegó el aviso, no desde cero.
  const total = useRef<{ closesAt: string; seconds: number } | null>(null);
  if (closesAt && left !== null && total.current?.closesAt !== closesAt) {
    total.current = { closesAt, seconds: Math.max(left, 1) };
  }
  const progress = left !== null && total.current ? left / total.current.seconds : null;
  const urgent = left !== null && left <= URGENT_SECONDS;

  return createPortal(
    <div
      className={`${styles.banner} ${left !== null ? styles.counting : ''} ${urgent ? styles.urgent : ''}`}
      role="status"
      data-testid="self-status"
    >
      <div className={styles.row}>
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
          left === null && (
            <span className={styles.lockedNotice}>
              {t('El host te va a devolver a la sala principal.')}
            </span>
          )
        )}
      </div>
      {progress !== null && (
        <span className={styles.track} aria-hidden="true">
          <span className={styles.fill} style={{ transform: `scaleX(${progress})` }} />
        </span>
      )}
    </div>,
    document.body,
  );
}

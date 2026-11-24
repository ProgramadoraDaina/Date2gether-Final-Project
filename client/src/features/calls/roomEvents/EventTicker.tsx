'use client';

import { useTranslation } from '@/features/translation/useTranslation';
import type { RouletteEventState } from './useRoomEvents';
import styles from './EventTicker.module.css';

interface EventTickerProps {
  state: RouletteEventState;
  onClose(): void;
}

// Zócalo estilo noticiero: se mantiene abajo del video hasta que vence
// (15 min, ver useRoomEvents) o un evento nuevo lo reemplaza, lo que pase
// primero. onClose es solo el cierre manual antes de tiempo.
export function EventTicker({ state, onClose }: EventTickerProps) {
  const { t } = useTranslation();
  return (
    <div className={styles.ticker} role="status">
      <span className={styles.badge}>🎡 {t('Ruleta')}</span>
      <span className={styles.track}>
        <span className={styles.content}>
          🎉 {state.winner.userName} {t('ganó la ruleta')}
        </span>
      </span>
      <button type="button" className={styles.close} onClick={onClose} aria-label={t('Cerrar')}>
        ✕
      </button>
    </div>
  );
}

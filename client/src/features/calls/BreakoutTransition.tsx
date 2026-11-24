'use client';

import { createPortal } from 'react-dom';
import { useTranslation } from '../translation/useTranslation';
import styles from './BreakoutTransition.module.css';

export type BreakoutTransitionState = { kind: 'enter'; label: string } | { kind: 'return' };

export function BreakoutTransition({ transition }: { transition: BreakoutTransitionState }) {
  const { t } = useTranslation();
  const entering = transition.kind === 'enter';
  const from = entering ? t('Sala principal') : t('Mini sala');
  const to = entering ? transition.label : t('Sala principal');

  return createPortal(
    <div className={styles.overlay} role="status" aria-live="polite">
      <div className={styles.content}>
        <span className={styles.route}>
          {from} → {to}
        </span>
        <h2 className={styles.title}>
          {entering ? `${t('Entrando a')} ${transition.label}` : t('Volviendo a la sala principal')}
        </h2>
        <p className={styles.hint}>
          {entering
            ? t('Tu cámara y tu micrófono quedan como estaban.')
            : t('Te reconectamos solo, no tenés que hacer nada.')}
        </p>
        <div className={styles.track} aria-hidden="true">
          <div className={styles.sweep} />
        </div>
      </div>
    </div>,
    document.body,
  );
}

'use client';

import { useState } from 'react';
import { useTranslation } from '@/features/translation/useTranslation';
import styles from './KickButton.module.css';

interface KickButtonProps {
  name: string;
  onKick: () => void;
}

export function KickButton({ name, onKick }: KickButtonProps) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button
        type="button"
        className={styles.kick}
        onClick={() => setConfirming(true)}
        aria-label={`${t('Expulsar a')} ${name}`}
        title={`${t('Expulsar a')} ${name}`}
      >
        {t('Expulsar')}
      </button>
    );
  }

  return (
    <div className={styles.confirm} role="group" aria-label={`${t('Expulsar a')} ${name}`}>
      <span>{t('¿Expulsar de la sala?')}</span>
      <button
        type="button"
        className={styles.danger}
        onClick={() => {
          setConfirming(false);
          onKick();
        }}
      >
        {t('Sí, expulsar')}
      </button>
      <button type="button" className={styles.kick} onClick={() => setConfirming(false)}>
        {t('Cancelar')}
      </button>
    </div>
  );
}

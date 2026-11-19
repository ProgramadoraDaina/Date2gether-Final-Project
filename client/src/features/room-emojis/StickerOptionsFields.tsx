'use client';

import { useTranslation } from '@/features/translation/useTranslation';
import {
  STICKER_ANIMATIONS,
  STICKER_DURATIONS,
  STICKER_POSITIONS,
  STICKER_SIZES,
  type StickerOptions,
} from '@/lib/api';
import styles from './StickerOptionsFields.module.css';

const SIZE_LABELS: Record<StickerOptions['size'], string> = {
  small: 'Chico',
  medium: 'Mediano',
  large: 'Grande',
};

const POSITION_LABELS: Record<StickerOptions['position'], string> = {
  'top-left': 'Arriba a la izquierda',
  top: 'Arriba',
  'top-right': 'Arriba a la derecha',
  left: 'Izquierda',
  center: 'Centro',
  right: 'Derecha',
  'bottom-left': 'Abajo a la izquierda',
  bottom: 'Abajo',
  'bottom-right': 'Abajo a la derecha',
};

const ANIMATION_LABELS: Record<StickerOptions['animation'], string> = {
  static: 'Fija',
  float: 'Flota',
  spin: 'Gira',
  pulse: 'Late',
  shake: 'Tiembla',
};

interface StickerOptionsFieldsProps {
  value: StickerOptions;
  onChange: (value: StickerOptions) => void;
}

export function StickerOptionsFields({ value, onChange }: StickerOptionsFieldsProps) {
  const { t } = useTranslation();
  const set = <K extends keyof StickerOptions>(key: K, option: StickerOptions[K]) =>
    onChange({ ...value, [key]: option });

  return (
    <div className={styles.fields}>
      <span className={styles.label}>{t('Duración')}</span>
      <div className={styles.options} role="radiogroup" aria-label={t('Duración')}>
        {STICKER_DURATIONS.map((duration) => (
          <button
            key={duration}
            type="button"
            role="radio"
            aria-checked={value.duration === duration}
            className={styles.option}
            onClick={() => set('duration', duration)}
          >
            {duration} s
          </button>
        ))}
      </div>

      <span className={styles.label}>{t('Posición en tu cámara')}</span>
      <div className={styles.positions} role="radiogroup" aria-label={t('Posición en tu cámara')}>
        {STICKER_POSITIONS.map((position) => (
          <button
            key={position}
            type="button"
            role="radio"
            aria-checked={value.position === position}
            aria-label={t(POSITION_LABELS[position])}
            title={t(POSITION_LABELS[position])}
            className={styles.position}
            onClick={() => set('position', position)}
          />
        ))}
      </div>

      <span className={styles.label}>{t('Tamaño')}</span>
      <div className={styles.options} role="radiogroup" aria-label={t('Tamaño')}>
        {STICKER_SIZES.map((size) => (
          <button
            key={size}
            type="button"
            role="radio"
            aria-checked={value.size === size}
            className={styles.option}
            onClick={() => set('size', size)}
          >
            {t(SIZE_LABELS[size])}
          </button>
        ))}
      </div>

      <span className={styles.label}>{t('Animación')}</span>
      <div className={styles.options} role="radiogroup" aria-label={t('Animación')}>
        {STICKER_ANIMATIONS.map((animation) => (
          <button
            key={animation}
            type="button"
            role="radio"
            aria-checked={value.animation === animation}
            className={styles.option}
            onClick={() => set('animation', animation)}
          >
            {t(ANIMATION_LABELS[animation])}
          </button>
        ))}
      </div>
    </div>
  );
}

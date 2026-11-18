'use client';

import { useCallback, useRef, useState } from 'react';
import { useDismiss } from '@/lib/useDismiss';
import { useTranslation } from '@/features/translation/useTranslation';
import { useCallSettingsStore, type CaptionSize } from './store';
import styles from './CallSettings.module.css';

const CAPTION_SIZES: { value: CaptionSize; label: string }[] = [
  { value: 'small', label: 'Chica' },
  { value: 'medium', label: 'Mediana' },
  { value: 'large', label: 'Grande' },
];

function SettingsIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="4" y1="7" x2="20" y2="7" />
      <line x1="4" y1="17" x2="20" y2="17" />
      <circle cx="9" cy="7" r="2" fill="currentColor" />
      <circle cx="15" cy="17" r="2" fill="currentColor" />
    </svg>
  );
}

export function CallSettingsButton({ buttonClassName }: { buttonClassName: string }) {
  const { t } = useTranslation();
  const { captionSize, setCaptionSize } = useCallSettingsStore();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  useDismiss(
    open,
    wrapRef,
    useCallback(() => setOpen(false), []),
  );
  const label = t('Ajustes de la llamada');

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        type="button"
        className={buttonClassName}
        onClick={() => setOpen((value) => !value)}
        title={label}
        aria-label={label}
        aria-expanded={open}
      >
        <SettingsIcon />
      </button>
      {open && (
        <div className={styles.panel} role="dialog" aria-label={label}>
          <fieldset className={styles.field}>
            <legend className={styles.legend}>{t('Tamaño de los subtítulos')}</legend>
            <div className={styles.segmented}>
              {CAPTION_SIZES.map(({ value, label: optionLabel }) => (
                <label key={value} className={styles.option}>
                  <input
                    type="radio"
                    name="caption-size"
                    value={value}
                    checked={captionSize === value}
                    onChange={() => setCaptionSize(value)}
                  />
                  <span>{t(optionLabel)}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      )}
    </div>
  );
}

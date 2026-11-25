'use client';

import { useLanguageStore } from './store';
import styles from './LanguagePicker.module.css';

// Cada opción se nombra en su propio idioma: quien no entiende la interfaz igual encuentra la suya.
const OPTIONS = [
  { value: 'es', label: 'Español' },
  { value: 'en', label: 'English' },
] as const;

export function LanguagePicker() {
  const language = useLanguageStore((state) => state.language);
  const setLanguage = useLanguageStore((state) => state.setLanguage);
  return (
    <div className={styles.picker} role="group" aria-label="Idioma / Language">
      {OPTIONS.map(({ value, label }) => (
        <button
          key={value}
          type="button"
          lang={value}
          className={styles.option}
          aria-pressed={language === value}
          onClick={() => setLanguage(value)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

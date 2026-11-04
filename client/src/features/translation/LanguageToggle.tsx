'use client';

import { useTranslation } from './useTranslation';
import styles from './LanguageToggle.module.css';

export function LanguageToggle() {
  const { language, toggle } = useTranslation();
  const isEs = language === 'es';

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isEs ? 'Switch language to English (EN)' : 'Cambiar idioma a español (ES)'}
      title={isEs ? 'English' : 'Español'}
      className={styles.languageToggle}
    >
      {isEs ? 'EN' : 'ES'}
    </button>
  );
}

'use client';

import { useTheme } from './useTheme';
import { useTranslation } from '@/features/translation/useTranslation';

export function ThemeToggle() {
  const { t } = useTranslation();
  const { theme, toggle } = useTheme();
  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={isDark}
      aria-label={isDark ? t('Cambiar a modo claro') : t('Cambiar a modo oscuro')}
      title={isDark ? t('Cambiar a modo claro') : t('Cambiar a modo oscuro')}
      className="theme-toggle"
    >
      {isDark ? '☀️' : '🌙'}
    </button>
  );
}

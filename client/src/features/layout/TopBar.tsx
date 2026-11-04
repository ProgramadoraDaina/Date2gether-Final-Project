'use client';

import { usePathname } from 'next/navigation';
import { LanguageToggle } from '@/features/translation/LanguageToggle';
import { useTheme } from '@/features/theme/useTheme';
import styles from './TopBar.module.css';

export function TopBar() {
  const pathname = usePathname();
  // El toggle de tema vive en Settings (y en el sidebar de sala), pero el
  // efecto que aplica data-theme al <html> tiene que correr en toda página
  // fuera de una sala, no solo donde se muestra el botón.
  useTheme();
  if (pathname?.startsWith('/room/')) return null;

  return (
    <div className={styles.topBar}>
      <LanguageToggle />
    </div>
  );
}

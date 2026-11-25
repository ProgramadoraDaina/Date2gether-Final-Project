'use client';

import { usePathname } from 'next/navigation';
import { ThemeToggle } from '@/features/theme/ThemeToggle';
import { LanguageToggle } from '@/features/translation/LanguageToggle';
import styles from './TopBar.module.css';

// Solo antes de entrar a la cuenta; adentro, tema e idioma viven en Configuración.
const AUTH_PATHS = ['/login', '/register'];

export function TopBar() {
  const pathname = usePathname();
  if (!pathname || !AUTH_PATHS.includes(pathname)) return null;

  return (
    <div className={styles.topBar}>
      <ThemeToggle />
      <LanguageToggle />
    </div>
  );
}

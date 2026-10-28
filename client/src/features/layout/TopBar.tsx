'use client';

import { usePathname } from 'next/navigation';
import { LanguageToggle } from '@/features/translation/LanguageToggle';
import { ThemeToggle } from '@/features/theme/ThemeToggle';
import styles from './TopBar.module.css';

export function TopBar() {
  const pathname = usePathname();
  if (pathname?.startsWith('/room/')) return null;

  return (
    <div className={styles.topBar}>
      <LanguageToggle />
      <ThemeToggle />
    </div>
  );
}

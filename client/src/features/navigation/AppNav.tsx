'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslation } from '@/features/translation/useTranslation';
import styles from './AppNav.module.css';

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
}

function HomeIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 11.5 12 4l9 7.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5.5 10v9a1 1 0 0 0 1 1H9.5v-6h5v6H17.5a1 1 0 0 0 1-1v-9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function HistoryIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 7v5l3.5 2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path
        d="M9.49 4.93 L10.52 4.65 L10.64 1.59 L13.36 1.59 L13.48 4.65 L15.23 5.23 L16.15 5.75 L18.4 3.68 L20.32 5.6 L18.25 7.85 L19.07 9.49 L19.35 10.52 L22.41 10.64 L22.41 13.36 L19.35 13.48 L18.77 15.23 L18.25 16.15 L20.32 18.4 L18.4 20.32 L16.15 18.25 L14.51 19.07 L13.48 19.35 L13.36 22.41 L10.64 22.41 L10.52 19.35 L8.77 18.77 L7.85 18.25 L5.6 20.32 L3.68 18.4 L5.75 16.15 L4.93 14.51 L4.65 13.48 L1.59 13.36 L1.59 10.64 L4.65 10.52 L5.23 8.77 L5.75 7.85 L3.68 5.6 L5.6 3.68 L7.85 5.75 Z"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function AppNav() {
  const { t } = useTranslation();
  const pathname = usePathname();

  const topItems: NavItem[] = [
    { href: '/', label: t('Inicio'), icon: <HomeIcon /> },
    { href: '/history', label: t('Historial'), icon: <HistoryIcon /> },
  ];
  const bottomItems: NavItem[] = [
    { href: '/settings', label: t('Configuración'), icon: <SettingsIcon /> },
  ];

  function renderItem({ href, label, icon }: NavItem) {
    const isActive = pathname === href;
    return (
      <Link
        key={href}
        href={href}
        className={`${styles.navItem} ${isActive ? styles.navItemActive : ''}`}
        aria-current={isActive ? 'page' : undefined}
      >
        <span className={styles.icon}>{icon}</span>
        <span className={styles.label}>{label}</span>
      </Link>
    );
  }

  return (
    <nav className={styles.rail} aria-label={t('Navegación principal')}>
      <div className={styles.top}>{topItems.map(renderItem)}</div>
      <div className={styles.bottom}>{bottomItems.map(renderItem)}</div>
    </nav>
  );
}

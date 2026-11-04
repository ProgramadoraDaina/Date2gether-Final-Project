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
      <circle cx="12" cy="12" r="3" strokeLinecap="round" strokeLinejoin="round" />
      <path
        d="M19.4 13a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V19a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H4a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H10a1.65 1.65 0 0 0 1-1.51V4a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V10a1.65 1.65 0 0 0 1.51 1H20a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
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

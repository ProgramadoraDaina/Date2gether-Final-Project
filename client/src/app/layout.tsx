import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { TopBar } from '@/features/layout/TopBar';
import { THEME_SCRIPT } from '@/features/theme/themeScript';
import { ThemeSync } from '@/features/theme/ThemeSync';
import styles from './layout.module.css';
import '@livekit/components-styles';
import './globals.css';

export const metadata: Metadata = {
  title: 'Date2gether',
  description: 'Videollamadas simples, en el navegador.',
  icons: { icon: '/favicon.svg' },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // suppressHydrationWarning: el script del <head> agrega data-theme antes de que React hidrate.
    <html lang="es" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <ThemeSync />
        <TopBar />
        <main className={styles.appShell}>{children}</main>
      </body>
    </html>
  );
}

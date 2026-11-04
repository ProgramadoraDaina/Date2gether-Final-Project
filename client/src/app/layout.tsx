import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { TopBar } from '@/features/layout/TopBar';
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
    <html lang="es">
      <body>
        <TopBar />
        <main className={styles.appShell}>{children}</main>
      </body>
    </html>
  );
}

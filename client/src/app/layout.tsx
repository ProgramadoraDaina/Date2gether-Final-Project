import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { TopBar } from '@/features/layout/TopBar';
import '@livekit/components-styles';
import './globals.css';
import styles from './layout.module.css';

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

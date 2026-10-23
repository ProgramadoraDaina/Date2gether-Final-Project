import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { LanguageToggle } from '@/features/translation/LanguageToggle';
import './globals.css';

export const metadata: Metadata = {
  title: 'Date2gether',
  description: 'Videollamadas simples, en el navegador.',
  icons: { icon: '/favicon.svg' },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <LanguageToggle />
        <main className="app-shell">{children}</main>
      </body>
    </html>
  );
}

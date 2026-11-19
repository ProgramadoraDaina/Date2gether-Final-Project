import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { IBM_Plex_Sans, Space_Grotesk } from 'next/font/google';
import { TopBar } from '@/features/layout/TopBar';
import { requestOrigin } from '@/features/share/origin';
import { SHARE_IMAGE_SIZE } from '@/features/share/shareCard';
import { THEME_SCRIPT } from '@/features/theme/themeScript';
import { ThemeSync } from '@/features/theme/ThemeSync';
import styles from './layout.module.css';
import '@livekit/components-styles';
import './globals.css';

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-space-grotesk',
});

const ibmPlexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-ibm-plex-sans',
});

const SITE_DESCRIPTION = 'Videollamadas simples, en el navegador.';

export async function generateMetadata(): Promise<Metadata> {
  const origin = await requestOrigin();
  const images = [{ url: new URL('/og', origin).href, ...SHARE_IMAGE_SIZE, alt: 'Date2gether' }];
  return {
    metadataBase: origin,
    title: { default: 'Date2gether', template: '%s · Date2gether' },
    description: SITE_DESCRIPTION,
    applicationName: 'Date2gether',
    openGraph: {
      type: 'website',
      siteName: 'Date2gether',
      locale: 'es_AR',
      title: 'Date2gether',
      description: SITE_DESCRIPTION,
      images,
    },
    twitter: {
      card: 'summary_large_image',
      title: 'Date2gether',
      description: SITE_DESCRIPTION,
      images,
    },
    icons: {
      icon: [
        { url: '/favicon.svg', type: 'image/svg+xml' },
        { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
        { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      ],
      apple: { url: '/apple-icon.png', sizes: '180x180' },
    },
  };
}

// Sin esto, Chrome en Android no sabe que la página ya maneja su propio
// tema oscuro (ver globals.css, :root[data-theme='dark']) y puede aplicar
// su "forced dark" heurístico encima: repinta botones con un color plano
// ignorando background/border reales, lo que puede llegar a verse como
// bloques sólidos sin separación entre sí.
export const viewport: Viewport = {
  colorScheme: 'light dark',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // suppressHydrationWarning: el script del <head> agrega data-theme antes de que React hidrate.
    <html
      lang="es"
      suppressHydrationWarning
      className={`${spaceGrotesk.variable} ${ibmPlexSans.variable}`}
    >
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

import type { ReactNode } from 'react';
import { shareMetadata } from '@/features/share/pageShare';

export function generateMetadata() {
  return shareMetadata(
    'Configuración',
    'Tema, idioma y notificaciones de Date2gether.',
    'Configuración · Date2gether',
  );
}

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}

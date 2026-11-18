import type { ReactNode } from 'react';
import { shareMetadata } from '@/features/share/pageShare';

export function generateMetadata() {
  return shareMetadata(
    'Historial',
    'Tus llamadas anteriores, con su resumen y transcripción.',
    'Historial · Date2gether',
  );
}

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}

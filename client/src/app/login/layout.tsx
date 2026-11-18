import type { ReactNode } from 'react';
import { shareMetadata } from '@/features/share/pageShare';

export function generateMetadata() {
  return shareMetadata(
    'Iniciar sesión',
    'Entrá a tu cuenta de Date2gether.',
    'Iniciar sesión · Date2gether',
  );
}

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}

import type { ReactNode } from 'react';
import { shareMetadata } from '@/features/share/pageShare';

export function generateMetadata() {
  return shareMetadata(
    'Crear cuenta',
    'Creá tu cuenta gratis y guardá tus salas.',
    'Crear cuenta · Date2gether',
  );
}

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}

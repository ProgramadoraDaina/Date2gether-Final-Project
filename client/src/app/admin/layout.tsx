import type { ReactNode } from 'react';
import { shareMetadata } from '@/features/share/pageShare';

export function generateMetadata() {
  return shareMetadata(
    'Administración',
    'Gestión de cuentas y roles de la plataforma.',
    'Administración · Date2gether',
  );
}

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}

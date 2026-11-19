import type { ReactNode } from 'react';
import { shareMetadata } from '@/features/share/pageShare';

export function generateMetadata() {
  return shareMetadata(
    'Mis salas',
    'Tus salas, sus horarios y el historial de cada una.',
    'Mis salas · Date2gether',
  );
}

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}

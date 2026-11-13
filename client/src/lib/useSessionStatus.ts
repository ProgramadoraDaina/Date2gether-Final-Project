import { useSyncExternalStore } from 'react';
import { isLoggedIn, onAuthChange } from './auth';

const serverSnapshot = (): boolean | null => null;

// null mientras se hidrata; después refleja la presencia de la sesión local.
export function useSessionStatus(): boolean | null {
  return useSyncExternalStore<boolean | null>(onAuthChange, isLoggedIn, serverSnapshot);
}

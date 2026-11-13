import { useCallback, useSyncExternalStore } from 'react';

// El servidor y la hidratación empiezan sin datos privados del navegador.
const serverSnapshot = () => null;

export function useLocalStorageValue(key: string): string | null {
  const snapshot = useCallback(() => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }, [key]);
  const subscribe = useCallback(
    (notify: () => void) => {
      function onStorage(event: StorageEvent) {
        if (event.key === key || event.key === null) notify();
      }
      window.addEventListener('storage', onStorage);
      return () => window.removeEventListener('storage', onStorage);
    },
    [key],
  );
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}

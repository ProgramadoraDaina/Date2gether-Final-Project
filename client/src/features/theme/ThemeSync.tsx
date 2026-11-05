'use client';

import { useEffect } from 'react';
import { applyThemeToDocument } from './dom-helpers';
import { useThemeStore } from './store';

// Único dueño de data-theme en el cliente: corre en todas las pantallas, no solo donde hay un ThemeToggle.
export function ThemeSync() {
  const theme = useThemeStore((s) => s.theme);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    // Antes de leer localStorage, el store vale null: aplicarlo pisaría el tema que puso el script del <head>.
    const apply = () => {
      if (!useThemeStore.persist.hasHydrated()) return;
      applyThemeToDocument(useThemeStore.getState().theme ?? (media.matches ? 'dark' : 'light'));
    };
    apply();
    const stopWaitingHydration = useThemeStore.persist.onFinishHydration(apply);
    media.addEventListener('change', apply);
    return () => {
      stopWaitingHydration();
      media.removeEventListener('change', apply);
    };
  }, [theme]);

  useEffect(() => {
    void useThemeStore.persist.rehydrate();
  }, []);

  return null;
}

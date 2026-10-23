import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Theme = 'light' | 'dark';

interface ThemeState {
  // null: sin preferencia explícita del usuario, se sigue el tema del sistema.
  theme: Theme | null;
  setTheme: (theme: Theme) => void;
}

const STORAGE_KEY = 'date2gether:theme';

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: null,
      setTheme: (theme) => set({ theme }),
    }),
    {
      name: STORAGE_KEY,
      version: 1,
      // Evita leer localStorage antes del primer render del cliente: el SSR
      // no tiene storage, así que el primer render del cliente debe partir
      // del mismo default ('theme: null') para no romper la hidratación.
      // useTheme() dispara rehydrate() manualmente en un efecto post-mount.
      skipHydration: true,
    },
  ),
);

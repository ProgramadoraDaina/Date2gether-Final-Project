import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Language = 'es' | 'en';

interface LanguageState {
  language: Language;
  setLanguage: (lang: Language) => void;
  toggle: () => void;
}

const STORAGE_KEY = 'date2gether:language';

export const useLanguageStore = create<LanguageState>()(
  persist(
    (set, get) => ({
      language: 'en',
      setLanguage: (lang) => set({ language: lang }),
      toggle: () => get().setLanguage(get().language === 'es' ? 'en' : 'es'),
    }),
    {
      name: STORAGE_KEY,
      version: 1,
      // Evita leer localStorage antes del primer render del cliente: el SSR
      // no tiene storage, así que el primer render del cliente debe partir
      // del mismo default ('language: en') para no romper la hidratación.
      // useTranslation() dispara rehydrate() manualmente en un efecto post-mount,
      // igual que useTheme() en ../theme/useTheme.ts.
      skipHydration: true,
    },
  ),
);

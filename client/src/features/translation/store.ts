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
      setLanguage: (lang) => {
        document.documentElement.lang = lang;
        set({ language: lang });
      },
      toggle: () => get().setLanguage(get().language === 'es' ? 'en' : 'es'),
    }),
    {
      name: STORAGE_KEY,
      version: 1,
      onRehydrateStorage: () => (state) => {
        if (state) document.documentElement.lang = state.language;
      },
    },
  ),
);

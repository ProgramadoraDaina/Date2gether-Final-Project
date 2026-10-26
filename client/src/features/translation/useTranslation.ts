import { useCallback, useEffect } from 'react';
import { useLanguageStore } from './store';
import { applyLanguageToDocument } from './dom-helpers';
import en from './dictionary';

export function useTranslation() {
  const language = useLanguageStore((s) => s.language);
  const setLanguage = useLanguageStore((s) => s.setLanguage);
  const toggle = useLanguageStore((s) => s.toggle);

  // skipHydration en el store: recién después del primer render leemos
  // localStorage, para que no difiera del HTML que mandó el server.
  useEffect(() => {
    useLanguageStore.persist.rehydrate();
  }, []);

  useEffect(() => {
    applyLanguageToDocument(language);
  }, [language]);

  const t = useCallback(
    (key: string): string => (language === 'en' ? (en[key] ?? key) : key),
    [language],
  );

  return { t, language, setLanguage, toggle };
}

import { useLanguageStore } from './store';
import en from './dictionary';

export function useTranslation() {
  const language = useLanguageStore((s) => s.language);
  const setLanguage = useLanguageStore((s) => s.setLanguage);
  const toggle = useLanguageStore((s) => s.toggle);

  const t = (key: string): string => (language === 'en' ? en[key] ?? key : key);

  return { t, language, setLanguage, toggle };
}

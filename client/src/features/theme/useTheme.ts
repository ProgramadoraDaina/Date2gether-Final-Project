import { useEffect } from 'react';
import { useThemeStore } from './store';
import { useSystemTheme } from './useSystemTheme';
import { applyThemeToDocument } from './dom-helpers';

export function useTheme() {
  const explicitTheme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const systemTheme = useSystemTheme();

  const theme = explicitTheme ?? systemTheme;

  // skipHydration en el store: recién después del primer render leemos
  // localStorage, para que no difiera del HTML que mandó el server.
  useEffect(() => {
    useThemeStore.persist.rehydrate();
  }, []);

  useEffect(() => {
    applyThemeToDocument(theme);
  }, [theme]);

  const toggle = () => setTheme(theme === 'dark' ? 'light' : 'dark');

  return { theme, toggle };
}

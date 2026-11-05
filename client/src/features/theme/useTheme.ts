import { useThemeStore } from './store';
import { useSystemTheme } from './useSystemTheme';

// Solo lee y cambia la preferencia: aplicarla al documento es trabajo de ThemeSync.
export function useTheme() {
  const explicitTheme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const systemTheme = useSystemTheme();

  const theme = explicitTheme ?? systemTheme;

  const toggle = () => setTheme(theme === 'dark' ? 'light' : 'dark');

  return { theme, toggle };
}

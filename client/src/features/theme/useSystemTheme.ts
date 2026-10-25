import { useEffect, useState } from 'react';
import type { Theme } from './store';

export function useSystemTheme(): Theme {
  // Arranca igual que el SSR ('light'): leer matchMedia acá rompería la
  // hidratación si el sistema está en dark. El valor real se aplica en el
  // efecto, después del primer render.
  const [systemTheme, setSystemTheme] = useState<Theme>('light');

  useEffect(() => {
    try {
      const media = window.matchMedia('(prefers-color-scheme: dark)');
      setSystemTheme(media.matches ? 'dark' : 'light');
      const handler = (event: MediaQueryListEvent) => {
        setSystemTheme(event.matches ? 'dark' : 'light');
      };
      media.addEventListener('change', handler);
      return () => media.removeEventListener('change', handler);
    } catch {
      setSystemTheme('light');
    }
  }, []);

  return systemTheme;
}

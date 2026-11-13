import { useSyncExternalStore } from 'react';
import type { Theme } from './store';

const QUERY = '(prefers-color-scheme: dark)';
const serverSnapshot = (): Theme => 'light';

function snapshot(): Theme {
  try {
    return window.matchMedia(QUERY).matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

function subscribe(notify: () => void) {
  try {
    const media = window.matchMedia(QUERY);
    media.addEventListener('change', notify);
    return () => media.removeEventListener('change', notify);
  } catch {
    return () => {};
  }
}

export function useSystemTheme(): Theme {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}

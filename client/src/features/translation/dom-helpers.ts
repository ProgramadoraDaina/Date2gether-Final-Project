import type { Language } from './store';

export function applyLanguageToDocument(language: Language): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = language;
}

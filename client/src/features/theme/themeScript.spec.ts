import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { THEME_SCRIPT } from './themeScript';
import { useThemeStore } from './store';

function runScript() {
  new Function(THEME_SCRIPT)();
}

function mockSystemDark(dark: boolean) {
  window.matchMedia = jest.fn(() => ({ matches: dark })) as unknown as typeof window.matchMedia;
}

describe('THEME_SCRIPT', () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
    mockSystemDark(false);
  });

  afterEach(() => {
    useThemeStore.setState({ theme: null });
  });

  it('aplica el tema oscuro guardado aunque el sistema esté en claro', () => {
    useThemeStore.getState().setTheme('dark');
    runScript();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('aplica el tema claro guardado aunque el sistema esté en oscuro', () => {
    useThemeStore.getState().setTheme('light');
    mockSystemDark(true);
    runScript();
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('sin preferencia guardada sigue al sistema', () => {
    mockSystemDark(true);
    runScript();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('con un valor corrupto en localStorage no rompe la página (ThemeSync aplica el tema después)', () => {
    localStorage.setItem('date2gether:theme', '{no es json');
    runScript();
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });
});

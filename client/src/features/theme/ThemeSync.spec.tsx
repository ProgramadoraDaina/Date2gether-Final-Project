import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, render } from '@testing-library/react';
import { useThemeStore } from './store';

jest.mock('./dom-helpers', () => ({ applyThemeToDocument: jest.fn() }));

function mockSystemTheme(dark: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: jest.fn(() => ({
      matches: dark,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    })),
  });
}

describe('ThemeSync', () => {
  beforeEach(() => {
    localStorage.clear();
    useThemeStore.setState({ theme: null });
    jest.clearAllMocks();
  });

  it('aplica el tema actual al documento cada vez que cambia', async () => {
    const { applyThemeToDocument } = await import('./dom-helpers');
    const { ThemeSync } = await import('./ThemeSync');
    mockSystemTheme(false);
    await act(async () => {
      render(<ThemeSync />);
    });
    expect(applyThemeToDocument).toHaveBeenLastCalledWith('light');
    act(() => useThemeStore.getState().setTheme('dark'));
    expect(applyThemeToDocument).toHaveBeenLastCalledWith('dark');
  });

  it('sin preferencia elegida, sigue el tema del sistema', async () => {
    const { applyThemeToDocument } = await import('./dom-helpers');
    const { ThemeSync } = await import('./ThemeSync');
    mockSystemTheme(true);
    await act(async () => {
      render(<ThemeSync />);
    });
    expect(applyThemeToDocument).toHaveBeenLastCalledWith('dark');
  });
});

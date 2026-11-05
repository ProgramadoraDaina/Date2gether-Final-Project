import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react';
import { useThemeStore } from './store';

jest.mock('./useSystemTheme', () => ({ useSystemTheme: jest.fn(() => 'light') }));
jest.mock('./dom-helpers', () => ({ applyThemeToDocument: jest.fn() }));

describe('useTheme', () => {
  beforeEach(() => {
    useThemeStore.setState({ theme: null });
    jest.clearAllMocks();
  });

  it('usa el tema del sistema mientras la persona no eligió uno de forma explícita', async () => {
    const { useSystemTheme } = await import('./useSystemTheme');
    (useSystemTheme as jest.Mock<typeof useSystemTheme>).mockReturnValue('dark');
    const { useTheme } = await import('./useTheme');
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('dark');
  });

  it('una vez que la persona elige un tema a mano, ese tema gana aunque el sistema diga otra cosa', async () => {
    const { useSystemTheme } = await import('./useSystemTheme');
    (useSystemTheme as jest.Mock<typeof useSystemTheme>).mockReturnValue('dark');
    useThemeStore.setState({ theme: 'light' });
    const { useTheme } = await import('./useTheme');
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('light');
  });

  it('toggle invierte el tema actual, sea el elegido a mano o el heredado del sistema', async () => {
    const { useSystemTheme } = await import('./useSystemTheme');
    (useSystemTheme as jest.Mock<typeof useSystemTheme>).mockReturnValue('light');
    const { useTheme } = await import('./useTheme');
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('light');
    act(() => result.current.toggle());
    expect(result.current.theme).toBe('dark');
  });

  it('aplica el tema actual al documento cada vez que cambia', async () => {
    const { applyThemeToDocument } = await import('./dom-helpers');
    const { useSystemTheme } = await import('./useSystemTheme');
    (useSystemTheme as jest.Mock<typeof useSystemTheme>).mockReturnValue('light');
    const { useTheme } = await import('./useTheme');
    const { result } = renderHook(() => useTheme());
    expect(applyThemeToDocument).toHaveBeenCalledWith('light');
    act(() => result.current.toggle());
    expect(applyThemeToDocument).toHaveBeenLastCalledWith('dark');
  });
});

import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react';
import { useSystemTheme } from './useSystemTheme';

function fakeMatchMedia(initialMatches: boolean) {
  const listeners: Array<(event: MediaQueryListEvent) => void> = [];
  const media = {
    matches: initialMatches,
    addEventListener: jest.fn(
      (_event: string, handler: (event: MediaQueryListEvent) => void) => {
        listeners.push(handler);
      },
    ),
    removeEventListener: jest.fn(),
  };
  return {
    media,
    emitChange: (matches: boolean) =>
      listeners.forEach((listener) => listener({ matches } as MediaQueryListEvent)),
  };
}

describe('useSystemTheme', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'matchMedia');
  });

  it('refleja el modo oscuro del sistema operativo apenas se monta', () => {
    const { media } = fakeMatchMedia(true);
    window.matchMedia = jest.fn().mockReturnValue(media) as unknown as typeof window.matchMedia;
    const { result } = renderHook(() => useSystemTheme());
    expect(result.current).toBe('dark');
  });

  it('se actualiza solo cuando el sistema cambia de tema mientras la app está abierta', () => {
    const { media, emitChange } = fakeMatchMedia(false);
    window.matchMedia = jest.fn().mockReturnValue(media) as unknown as typeof window.matchMedia;
    const { result } = renderHook(() => useSystemTheme());
    expect(result.current).toBe('light');
    act(() => emitChange(true));
    expect(result.current).toBe('dark');
  });

  it('deja de escuchar los cambios del sistema al desmontarse, para no filtrar el listener', () => {
    const { media } = fakeMatchMedia(false);
    window.matchMedia = jest.fn().mockReturnValue(media) as unknown as typeof window.matchMedia;
    const { unmount } = renderHook(() => useSystemTheme());
    unmount();
    expect(media.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  });

  it('si el navegador no soporta matchMedia, no rompe y queda en modo claro', () => {
    expect(window.matchMedia).toBeUndefined();
    const { result } = renderHook(() => useSystemTheme());
    expect(result.current).toBe('light');
  });
});

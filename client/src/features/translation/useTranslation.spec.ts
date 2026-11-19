import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react';
import { useLanguageStore } from './store';

jest.mock('./dom-helpers', () => ({ applyLanguageToDocument: jest.fn() }));

describe('useTranslation', () => {
  beforeEach(() => {
    useLanguageStore.setState({ language: 'es' });
    jest.clearAllMocks();
  });

  it('en español devuelve el texto tal cual, sin pasar por el diccionario', async () => {
    const { useTranslation } = await import('./useTranslation');
    const { result } = renderHook(() => useTranslation());
    expect(result.current.t('Entrar')).toBe('Entrar');
  });

  it('en inglés traduce las claves que están cargadas en el diccionario', async () => {
    useLanguageStore.setState({ language: 'en' });
    const { useTranslation } = await import('./useTranslation');
    const { result } = renderHook(() => useTranslation());
    expect(result.current.t('Entrar')).toBe('Log in');
  });

  it('en inglés, si una clave todavía no tiene traducción cargada, muestra el texto en español como respaldo en vez de romper', async () => {
    useLanguageStore.setState({ language: 'en' });
    const { useTranslation } = await import('./useTranslation');
    const { result } = renderHook(() => useTranslation());
    expect(result.current.t('un texto que todavía no se tradujo')).toBe(
      'un texto que todavía no se tradujo',
    );
  });

  it('cambiar de idioma con toggle actualiza el idioma que se le aplica al documento', async () => {
    const { applyLanguageToDocument } = await import('./dom-helpers');
    const { useTranslation } = await import('./useTranslation');
    const { result } = renderHook(() => useTranslation());
    expect(applyLanguageToDocument).toHaveBeenCalledWith('es');
    act(() => result.current.toggle());
    expect(applyLanguageToDocument).toHaveBeenLastCalledWith('en');
  });
});

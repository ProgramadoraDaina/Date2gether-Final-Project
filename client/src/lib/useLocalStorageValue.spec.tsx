import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import { useLocalStorageValue } from './useLocalStorageValue';

describe('useLocalStorageValue', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('hidrata el valor guardado sin diferencias con el HTML del servidor', async () => {
    localStorage.setItem('saved-name', 'Ana');
    function Name() {
      return <span>{useLocalStorageValue('saved-name') ?? 'Sin nombre'}</span>;
    }
    const container = document.createElement('div');
    container.innerHTML = renderToString(<Name />);
    expect(container.textContent).toBe('Sin nombre');
    document.body.appendChild(container);
    const recover = jest.fn();
    let root!: ReturnType<typeof hydrateRoot>;
    try {
      await act(async () => {
        root = hydrateRoot(container, <Name />, { onRecoverableError: recover });
      });
      expect(container.textContent).toBe('Ana');
      expect(recover).not.toHaveBeenCalled();
    } finally {
      act(() => root?.unmount());
      container.remove();
    }
  });

  it('refleja cambios y borrados de otra pestaña y deja de escuchar al desmontar', () => {
    const remove = jest.spyOn(window, 'removeEventListener');
    const { result, unmount } = renderHook(() => useLocalStorageValue('saved-name'));
    expect(result.current).toBeNull();
    act(() => {
      localStorage.setItem('saved-name', 'Ana');
      window.dispatchEvent(new StorageEvent('storage', { key: 'saved-name' }));
    });
    expect(result.current).toBe('Ana');
    act(() => {
      localStorage.clear();
      window.dispatchEvent(new StorageEvent('storage', { key: null }));
    });
    expect(result.current).toBeNull();
    unmount();
    expect(remove).toHaveBeenCalledWith('storage', expect.any(Function));
    remove.mockRestore();
  });

  it('funciona aunque el navegador bloquee localStorage', () => {
    const getItem = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError');
    });
    try {
      const { result } = renderHook(() => useLocalStorageValue('saved-name'));
      expect(result.current).toBeNull();
    } finally {
      getItem.mockRestore();
    }
  });
});

import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react';
import { useResizablePanel } from './useResizablePanel';

function mouseDownEvent(clientX: number) {
  return { preventDefault: jest.fn(), clientX } as unknown as Parameters<
    ReturnType<typeof useResizablePanel>['handleMouseDown']
  >[0];
}

describe('useResizablePanel', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('arranca en defaultWidth cuando no hay nada guardado', () => {
    const { result } = renderHook(() =>
      useResizablePanel({ storageKey: 'panel-a', defaultWidth: 300, min: 200, max: 400, edge: 'right' }),
    );
    expect(result.current.width).toBe(300);
  });

  it('restaura el ancho guardado si está dentro del rango', () => {
    localStorage.setItem('panel-b', '350');
    const { result } = renderHook(() =>
      useResizablePanel({ storageKey: 'panel-b', defaultWidth: 300, min: 200, max: 400, edge: 'right' }),
    );
    expect(result.current.width).toBe(350);
  });

  it('ignora un valor guardado fuera de rango o no numérico', () => {
    localStorage.setItem('panel-c', '9999');
    const { result } = renderHook(() =>
      useResizablePanel({ storageKey: 'panel-c', defaultWidth: 300, min: 200, max: 400, edge: 'right' }),
    );
    expect(result.current.width).toBe(300);
  });

  it('arrastrar actualiza el ancho, lo recorta al rango y lo persiste al soltar', () => {
    const { result } = renderHook(() =>
      useResizablePanel({ storageKey: 'panel-d', defaultWidth: 300, min: 200, max: 400, edge: 'right' }),
    );

    act(() => {
      result.current.handleMouseDown(mouseDownEvent(500));
    });
    act(() => {
      // edge:'right' invierte el signo: mover el mouse a la izquierda agranda.
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 400 }));
    });
    expect(result.current.width).toBe(400);

    act(() => {
      // Más allá del máximo: debe recortarse, no desbordar.
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 0 }));
    });
    expect(result.current.width).toBe(400);

    act(() => {
      window.dispatchEvent(new MouseEvent('mouseup'));
    });
    expect(localStorage.getItem('panel-d')).toBe('400');
  });

  it('si el componente se desmonta a mitad de un arrastre, limpia los listeners de window', () => {
    const addSpy = jest.spyOn(window, 'addEventListener');
    const removeSpy = jest.spyOn(window, 'removeEventListener');

    const { result, unmount } = renderHook(() =>
      useResizablePanel({ storageKey: 'panel-e', defaultWidth: 300, min: 200, max: 400, edge: 'left' }),
    );

    act(() => {
      result.current.handleMouseDown(mouseDownEvent(100));
    });
    const moveListenersAdded = addSpy.mock.calls.filter(([type]) => type === 'mousemove').length;
    const upListenersAdded = addSpy.mock.calls.filter(([type]) => type === 'mouseup').length;
    expect(moveListenersAdded).toBe(1);
    expect(upListenersAdded).toBe(1);

    // Se desmonta SIN soltar el mouse: antes del fix, estos listeners quedaban
    // colgados en `window` para siempre.
    unmount();

    const moveListenersRemoved = removeSpy.mock.calls.filter(([type]) => type === 'mousemove').length;
    const upListenersRemoved = removeSpy.mock.calls.filter(([type]) => type === 'mouseup').length;
    expect(moveListenersRemoved).toBe(1);
    expect(upListenersRemoved).toBe(1);

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});

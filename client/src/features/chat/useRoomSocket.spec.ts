import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react';
import type { Socket } from 'socket.io-client';
import { useRoomSocket } from './useRoomSocket';

afterEach(() => {
  jest.restoreAllMocks();
});

function createFakeSocket() {
  const callbacks: Record<string, (...args: unknown[]) => void> = {};
  return {
    on: jest.fn((event: string, cb: (...args: unknown[]) => void) => {
      callbacks[event] = cb;
    }),
    off: jest.fn(),
    emit: jest.fn(),
    callbacks,
  };
}

const assignment = { breakoutId: 'breakout-1', label: 'Mini sala 1', leavePolicy: 'locked' as const };

describe('useRoomSocket', () => {
  it('no explota si todavía no hay socket', () => {
    const { result } = renderHook(() => useRoomSocket(null));
    expect(result.current.breakoutAssignment).toBeNull();
    expect(result.current.breakoutReturnSignal).toBe(0);
  });

  it('breakout:assigned expone el payload {breakoutId, label, leavePolicy}', () => {
    const socket = createFakeSocket();
    const { result } = renderHook(() => useRoomSocket(socket as unknown as Socket));

    act(() => socket.callbacks['breakout:assigned'](assignment));

    expect(result.current.breakoutAssignment).toEqual(assignment);
  });

  it('breakout:closed para la mini sala asignada limpia la asignación y dispara el retorno', () => {
    const socket = createFakeSocket();
    const { result } = renderHook(() => useRoomSocket(socket as unknown as Socket));
    act(() => socket.callbacks['breakout:assigned'](assignment));

    act(() => socket.callbacks['breakout:closed']({ breakoutId: 'breakout-1' }));

    expect(result.current.breakoutAssignment).toBeNull();
    expect(result.current.breakoutReturnSignal).toBe(1);
  });

  it('breakout:closed de OTRA mini sala no afecta la asignación actual ni dispara el retorno', () => {
    const socket = createFakeSocket();
    const { result } = renderHook(() => useRoomSocket(socket as unknown as Socket));
    act(() => socket.callbacks['breakout:assigned'](assignment));

    act(() => socket.callbacks['breakout:closed']({ breakoutId: 'breakout-otra' }));

    expect(result.current.breakoutAssignment).toEqual(assignment);
    expect(result.current.breakoutReturnSignal).toBe(0);
  });

  it('breakout:closed sin ninguna asignación previa no dispara el retorno', () => {
    const socket = createFakeSocket();
    const { result } = renderHook(() => useRoomSocket(socket as unknown as Socket));

    act(() => socket.callbacks['breakout:closed']({ breakoutId: 'breakout-1' }));

    expect(result.current.breakoutReturnSignal).toBe(0);
  });

  it('se desuscribe de ambos eventos al desmontar', () => {
    const socket = createFakeSocket();
    const { unmount } = renderHook(() => useRoomSocket(socket as unknown as Socket));

    unmount();

    expect(socket.off).toHaveBeenCalledWith('breakout:assigned', expect.any(Function));
    expect(socket.off).toHaveBeenCalledWith('breakout:closed', expect.any(Function));
  });

  // Decisión 2 (design.md "Señal de motivo de remoción", tasks.md 2.7):
  // consumeRemovalNotice() respaldado por un ref (no por estado), lectura
  // destructiva, ventana de frescura de 10s. Justificación: onDisconnected
  // dispara a milisegundos del evento de socket; un setState puede no haber
  // flusheado todavía.
  describe('[2.7] consumeRemovalNotice()', () => {
    it('sin ningún aviso recibido, devuelve null', () => {
      const socket = createFakeSocket();
      const { result } = renderHook(() => useRoomSocket(socket as unknown as Socket));

      expect(result.current.consumeRemovalNotice()).toBeNull();
    });

    it('breakout:removal recibido: consumeRemovalNotice devuelve { reason, at } dentro de la ventana de 10s', () => {
      const socket = createFakeSocket();
      const { result } = renderHook(() => useRoomSocket(socket as unknown as Socket));
      const now = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(now);

      act(() => socket.callbacks['breakout:removal']({ reason: 'BREAKOUT_MOVE_IN' }));

      expect(result.current.consumeRemovalNotice()).toEqual({
        reason: 'BREAKOUT_MOVE_IN',
        at: now,
      });
    });

    it('lectura destructiva: una segunda llamada inmediatamente después devuelve null', () => {
      const socket = createFakeSocket();
      const { result } = renderHook(() => useRoomSocket(socket as unknown as Socket));
      act(() => socket.callbacks['breakout:removal']({ reason: 'BREAKOUT_FORCED_RETURN' }));

      result.current.consumeRemovalNotice();

      expect(result.current.consumeRemovalNotice()).toBeNull();
    });

    it('aviso vencido (más de 10s de antigüedad): consumeRemovalNotice devuelve null igual (consumido, no reutilizable)', () => {
      const socket = createFakeSocket();
      const { result } = renderHook(() => useRoomSocket(socket as unknown as Socket));
      const start = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(start);
      act(() => socket.callbacks['breakout:removal']({ reason: 'BREAKOUT_RETURN_LOCKED' }));

      jest.spyOn(Date, 'now').mockReturnValue(start + 10_001);

      expect(result.current.consumeRemovalNotice()).toBeNull();
    });

    it('se desuscribe de breakout:removal al desmontar', () => {
      const socket = createFakeSocket();
      const { unmount } = renderHook(() => useRoomSocket(socket as unknown as Socket));

      unmount();

      expect(socket.off).toHaveBeenCalledWith('breakout:removal', expect.any(Function));
    });
  });
});

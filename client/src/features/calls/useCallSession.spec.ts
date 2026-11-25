import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react';
jest.mock('../../lib/calls', () => ({ startCall: jest.fn() }));
const credentials = {
  url: 'wss://media.example.com',
  token: 'signed-token',
  roomName: 'abc',
  participantLimit: 6,
};
async function setup() {
  const { startCall } = await import('../../lib/calls');
  (startCall as jest.Mock<typeof startCall>).mockResolvedValue(credentials);
  const { useCallSession } = await import('./useCallSession');
  return { startCall, ...renderHook(() => useCallSession()) };
}
describe('useCallSession: LiveKit', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  it('espera la confirmación de LiveKit antes de mostrar que está conectado', async () => {
    const fake = await setup();
    await act(() => fake.result.current.joinCall('abc', 'room-token'));
    expect(fake.startCall).toHaveBeenCalledWith('abc', 'room-token', expect.any(AbortSignal));
    expect(fake.result.current.session).toEqual(credentials);
    expect(fake.result.current.status).toBe('connecting');
    act(() => fake.result.current.connected());
    expect(fake.result.current.status).toBe('in-call');
  });
  it('no genera dos solicitudes al pulsar Llamar repetidamente', async () => {
    const fake = await setup();
    await act(async () => {
      await Promise.all([
        fake.result.current.joinCall('abc', 'token'),
        fake.result.current.joinCall('abc', 'token'),
      ]);
    });
    expect(fake.startCall).toHaveBeenCalledTimes(1);
  });
  it('salir de la llamada mientras todavía se está conectando cancela el pedido en curso, y si la conexión se confirma después de todas formas, la pantalla se queda como si nunca hubiera entrado', async () => {
    const fake = await setup();
    let resolve!: (session: typeof credentials) => void;
    (fake.startCall as jest.Mock<typeof fake.startCall>).mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    let joining!: Promise<void>;
    act(() => {
      joining = fake.result.current.joinCall('abc', 'token');
    });
    act(() => fake.result.current.leaveCall());
    await act(async () => {
      resolve(credentials);
      await joining;
    });
    expect(fake.result.current.session).toBeNull();
    expect(fake.result.current.status).toBe('idle');
    const signal = (fake.startCall as jest.Mock<typeof fake.startCall>).mock.calls[0][2];
    expect(signal?.aborted).toBe(true);
  });
  it('muestra rechazos del backend sin montar una conexión', async () => {
    const fake = await setup();
    (fake.startCall as jest.Mock<typeof fake.startCall>).mockRejectedValueOnce(
      new Error('Las llamadas todavía no están configuradas'),
    );
    await act(() => fake.result.current.joinCall('abc', 'token'));
    expect(fake.result.current.status).toBe('error');
    expect(fake.result.current.error).toBe('Las llamadas todavía no están configuradas');
    expect(fake.result.current.session).toBeNull();
  });
  it('un fallo de conexión desmonta LiveKit y permite reintentar', async () => {
    const fake = await setup();
    await act(() => fake.result.current.joinCall('abc', 'token'));
    act(() => fake.result.current.failed(new Error('private details')));
    expect(fake.result.current.session).toBeNull();
    expect(fake.result.current.error).not.toContain('private details');
    await act(() => fake.result.current.joinCall('abc', 'token'));
    expect(fake.startCall).toHaveBeenCalledTimes(2);
  });
  it('cerrar la pantalla mientras la llamada todavía se está conectando cancela el pedido en curso', async () => {
    const fake = await setup();
    (fake.startCall as jest.Mock<typeof fake.startCall>).mockReturnValueOnce(new Promise(() => {}));
    act(() => {
      void fake.result.current.joinCall('abc', 'token');
    });
    fake.unmount();
    expect((fake.startCall as jest.Mock<typeof fake.startCall>).mock.calls[0][2]?.aborted).toBe(
      true,
    );
  });
  it('endedByHost() produce el estado terminal "ended" con endReason "host-left" (D5, design.md)', async () => {
    const fake = await setup();
    await act(() => fake.result.current.joinCall('abc', 'room-token'));
    act(() => fake.result.current.endedByHost());
    expect(fake.result.current.status).toBe('ended');
    expect(fake.result.current.endReason).toBe('host-left');
    expect(fake.result.current.session).toBeNull();
  });
  it('un nuevo joinCall después de un cierre forzado limpia endReason', async () => {
    const fake = await setup();
    await act(() => fake.result.current.joinCall('abc', 'room-token'));
    act(() => fake.result.current.endedByHost());
    await act(() => fake.result.current.joinCall('abc', 'room-token'));
    expect(fake.result.current.endReason).toBeNull();
  });

  // Decisión 2 (design.md "Señal de motivo de remoción", tasks.md 2.8):
  // dos productores nuevos + un literal nuevo. Ninguno pasa por 'error':
  // una remoción esperada (traslado/vuelta) o una expulsión por política no
  // son fallos de red, son fines de sesión por regla.
  describe('[2.8] endedForBreakout() / removedByPolicy() (Decisión 2, design.md)', () => {
    it('endedForBreakout() produce el estado terminal "ended" con endReason "breakout-closed", sin pasar por "error"', async () => {
      const fake = await setup();
      await act(() => fake.result.current.joinCall('abc', 'room-token'));

      act(() => fake.result.current.endedForBreakout());

      expect(fake.result.current.status).toBe('ended');
      expect(fake.result.current.endReason).toBe('breakout-closed');
      expect(fake.result.current.session).toBeNull();
      expect(fake.result.current.error).toBeNull();
    });

    it('removedByPolicy(code) produce el estado terminal "ended" con endReason "breakout-locked", nunca "error"', async () => {
      const fake = await setup();
      await act(() => fake.result.current.joinCall('abc', 'room-token'));

      act(() => fake.result.current.removedByPolicy('BREAKOUT_RETURN_LOCKED'));

      expect(fake.result.current.status).toBe('ended');
      expect(fake.result.current.endReason).toBe('breakout-locked');
      expect(fake.result.current.session).toBeNull();
    });

    it('removedByPolicy(code) deja disponible el código recibido para que el renderizador resuelva la copia visible', async () => {
      const fake = await setup();
      await act(() => fake.result.current.joinCall('abc', 'room-token'));

      act(() => fake.result.current.removedByPolicy('BREAKOUT_RETURN_LOCKED'));

      expect(fake.result.current.error).toBe('BREAKOUT_RETURN_LOCKED');
    });

    it('un nuevo joinCall después de endedForBreakout()/removedByPolicy() limpia endReason', async () => {
      const fake = await setup();
      await act(() => fake.result.current.joinCall('abc', 'room-token'));
      act(() => fake.result.current.removedByPolicy('BREAKOUT_RETURN_LOCKED'));

      await act(() => fake.result.current.joinCall('abc', 'room-token'));

      expect(fake.result.current.endReason).toBeNull();
    });
  });

  describe('switchRoom (breakout-rooms, Flujo 1 de su design.md)', () => {
    const breakoutSession = {
      url: 'wss://media.example.com',
      token: 'breakout-token',
      roomName: 'abc::breakout-1',
      participantLimit: 6,
    };

    it('reemplaza session de forma atómica y deja status en "switching", sin pasar por "error"', async () => {
      const fake = await setup();
      await act(() => fake.result.current.joinCall('abc', 'room-token'));
      act(() => fake.result.current.connected());

      act(() => fake.result.current.switchRoom(breakoutSession));

      expect(fake.result.current.session).toEqual(breakoutSession);
      expect(fake.result.current.status).toBe('switching');
      expect(fake.result.current.error).toBeNull();
    });

    it('connected() tras el remonte de LiveKit confirma la mini sala como "in-call"', async () => {
      const fake = await setup();
      await act(() => fake.result.current.joinCall('abc', 'room-token'));
      act(() => fake.result.current.connected());
      act(() => fake.result.current.switchRoom(breakoutSession));

      act(() => fake.result.current.connected());

      expect(fake.result.current.status).toBe('in-call');
    });

    it('cancela un joinCall en curso en vez de dejarlo pisar la sesión nueva', async () => {
      const fake = await setup();
      let resolve!: (session: typeof credentials) => void;
      (fake.startCall as jest.Mock<typeof fake.startCall>).mockReturnValueOnce(
        new Promise((done) => {
          resolve = done;
        }),
      );
      let joining!: Promise<void>;
      act(() => {
        joining = fake.result.current.joinCall('abc', 'token');
      });

      act(() => fake.result.current.switchRoom(breakoutSession));

      await act(async () => {
        resolve(credentials);
        await joining;
      });
      expect(fake.result.current.session).toEqual(breakoutSession);
      const signal = (fake.startCall as jest.Mock<typeof fake.startCall>).mock.calls[0][2];
      expect(signal?.aborted).toBe(true);
    });

    it('limpia un endReason previo (no deja "host-left" pegado tras un traslado)', async () => {
      const fake = await setup();
      await act(() => fake.result.current.joinCall('abc', 'room-token'));
      act(() => fake.result.current.endedByHost());

      act(() => fake.result.current.switchRoom(breakoutSession));

      expect(fake.result.current.endReason).toBeNull();
    });
  });
});

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
});

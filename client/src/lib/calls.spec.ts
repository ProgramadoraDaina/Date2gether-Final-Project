import { beforeEach, describe, expect, it, jest } from '@jest/globals';

describe('startCall', () => {
  beforeEach(() => {
    global.fetch = jest.fn() as unknown as typeof fetch;
  });
  it('usa el pase de sala de un invitado sin depender de una cuenta', async () => {
    const session = {
      url: 'wss://media.example.com',
      token: 'signed-token',
      roomName: 'abc-defg-hij',
      participantLimit: 6,
    };
    const fetchMock = global.fetch as jest.Mock<typeof fetch>;
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(session), { status: 201 }));
    const { startCall } = await import('./calls');
    await expect(startCall('abc-defg-hij', 'guest-room-token')).resolves.toEqual(session);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3001/calls/abc-defg-hij', {
      method: 'POST',
      headers: { Authorization: 'Bearer guest-room-token' },
    });
  });
  it('muestra el rechazo del backend sin presentar la llamada como iniciada', async () => {
    (global.fetch as jest.Mock<typeof fetch>).mockResolvedValueOnce(
      new Response(null, { status: 401 }),
    );
    const { startCall } = await import('./calls');
    await expect(startCall('abc-defg-hij', 'expired')).rejects.toThrow(
      'No se pudo iniciar la llamada',
    );
  });

  it('mapea el código NO_HOST_CONNECTED a un mensaje propio del cliente, no al texto crudo del backend', async () => {
    (global.fetch as jest.Mock<typeof fetch>).mockResolvedValueOnce(
      new Response(
        JSON.stringify({ message: 'texto interno que no debe mostrarse', code: 'NO_HOST_CONNECTED' }),
        { status: 403 },
      ),
    );
    const { startCall } = await import('./calls');
    await expect(startCall('abc-defg-hij', 'guest-room-token')).rejects.toThrow(
      'Esperá a que se conecte un anfitrión para unirte a la llamada.',
    );
  });

  it('si el rechazo no trae código, cae al mensaje crudo del backend', async () => {
    (global.fetch as jest.Mock<typeof fetch>).mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'La sala está cerrada' }), { status: 403 }),
    );
    const { startCall } = await import('./calls');
    await expect(startCall('abc-defg-hij', 'guest-room-token')).rejects.toThrow(
      'La sala está cerrada',
    );
  });
});

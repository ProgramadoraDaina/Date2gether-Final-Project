import { beforeEach, describe, expect, it, jest } from '@jest/globals';

describe('startCall', () => {
  beforeEach(() => {
    global.fetch = jest.fn() as unknown as typeof fetch;
  });
  it('usa el pase de sala de un invitado sin depender de una cuenta', async () => {
    const session = {
      meeting: { MeetingId: 'meeting-123' },
      attendee: { AttendeeId: 'attendee-456' },
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
});

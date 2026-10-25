import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const ACCESS_TOKEN_KEY = 'date2gether:accessToken';

describe('startCall', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(ACCESS_TOKEN_KEY, 'fake-access-token');
    global.fetch = jest.fn() as unknown as typeof fetch;
  });

  it('crea la reunión y el asistente de Chime, en ese orden, autenticado con el access token', async () => {
    const fakeMeeting = { MeetingId: 'meeting-123' };
    const fakeAttendee = { AttendeeId: 'attendee-456', ExternalUserId: 'user-789' };

    const fetchMock = global.fetch as jest.Mock<typeof fetch>;
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify(fakeMeeting), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(fakeAttendee), { status: 201 }));

    const { startCall } = await import('./calls');
    const session = await startCall('ABC123');

    expect(session).toEqual({ meeting: fakeMeeting, attendee: fakeAttendee });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [firstUrl, firstInit] = fetchMock.mock.calls[0];
    expect(firstUrl).toBe('http://localhost:3001/calls/ABC123');
    expect(firstInit).toMatchObject({
      method: 'POST',
      headers: { Authorization: 'Bearer fake-access-token' },
    });

    const [secondUrl, secondInit] = fetchMock.mock.calls[1];
    expect(secondUrl).toBe('http://localhost:3001/calls/meetings/meeting-123/attendees');
    expect(secondInit).toMatchObject({
      method: 'POST',
      headers: { Authorization: 'Bearer fake-access-token' },
    });
  });

  it('lanza un error legible si el backend rechaza la creación de la reunión', async () => {
    const fetchMock = global.fetch as jest.Mock<typeof fetch>;
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));

    const { startCall } = await import('./calls');

    await expect(startCall('ABC123')).rejects.toThrow('No se pudo iniciar la llamada');
  });
});

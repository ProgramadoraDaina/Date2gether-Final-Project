import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const ACCESS_TOKEN_KEY = 'date2gether:accessToken';

describe('createRoom', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(ACCESS_TOKEN_KEY, 'fake-access-token');
    global.fetch = jest.fn() as unknown as typeof fetch;
  });

  it('crea la sala autenticada con el access token', async () => {
    const fakeRoom = { id: 'room-1', code: 'abc-defg-hij', name: 'Reunión de Daina' };
    const fetchMock = global.fetch as jest.Mock<typeof fetch>;
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(fakeRoom), { status: 201 }));

    const { createRoom } = await import('./api');
    const room = await createRoom('Reunión de Daina');

    expect(room).toEqual(fakeRoom);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:3001/rooms');
    expect(init).toMatchObject({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer fake-access-token',
      },
    });
  });
});

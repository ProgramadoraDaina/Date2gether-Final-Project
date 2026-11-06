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

describe('notas compartidas', () => {
  beforeEach(() => {
    global.fetch = jest.fn() as unknown as typeof fetch;
  });

  it('envía la revisión y permite terminar el guardado al salir de la página', async () => {
    const fetchMock = jest.mocked(global.fetch);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ content: 'Nota', revision: 4 }), { status: 200 }),
    );
    const { saveRoomNotes } = await import('./api');
    await saveRoomNotes('abc-defg-hij', 'room-token', 'Nota', 3, true);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'PATCH',
      headers: { Authorization: 'Bearer room-token' },
      body: JSON.stringify({ content: 'Nota', revision: 3 }),
      keepalive: true,
    });
  });

  it('distingue un conflicto de revisión de los errores de red para conservar el borrador', async () => {
    jest.mocked(global.fetch).mockResolvedValue(new Response('{}', { status: 409 }));
    const { RoomNotesConflictError, saveRoomNotes } = await import('./api');
    await expect(saveRoomNotes('abc-defg-hij', 'room-token', 'Nota', 3)).rejects.toBeInstanceOf(
      RoomNotesConflictError,
    );
  });
});

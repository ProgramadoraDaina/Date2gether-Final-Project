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

  it('envía isPermanent y slots cuando se pasan', async () => {
    const fakeRoom = { id: 'room-1', code: 'abc-defg-hij', name: 'Sala permanente' };
    const fetchMock = global.fetch as jest.Mock<typeof fetch>;
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(fakeRoom), { status: 201 }));

    const { createRoom } = await import('./api');
    const slots = [{ dayOfWeek: 2, timeOfDay: '07:00', timezone: 'UTC' }];
    await createRoom('Sala permanente', { isPermanent: true, slots });

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init!.body as string)).toEqual({
      name: 'Sala permanente',
      isPermanent: true,
      slots,
    });
  });
});

describe('renameRoom', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(ACCESS_TOKEN_KEY, 'fake-access-token');
    global.fetch = jest.fn() as unknown as typeof fetch;
  });

  it('envía PATCH autenticado con el nuevo nombre', async () => {
    const fetchMock = global.fetch as jest.Mock<typeof fetch>;
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));

    const { renameRoom } = await import('./api');
    await renameRoom('abc-defg-hij', 'Grupo de los jueves');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:3001/rooms/abc-defg-hij/name');
    expect(init).toMatchObject({
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer fake-access-token',
      },
    });
    expect(JSON.parse(init!.body as string)).toEqual({ name: 'Grupo de los jueves' });
  });

  it('lanza ApiError si el backend rechaza el renombre', async () => {
    const fetchMock = global.fetch as jest.Mock<typeof fetch>;
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'Solo las salas permanentes se pueden renombrar' }), {
        status: 403,
      }),
    );

    const { renameRoom, ApiError } = await import('./api');

    await expect(renameRoom('abc-defg-hij', 'x')).rejects.toThrow(ApiError);
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

describe('getCallSessions', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(ACCESS_TOKEN_KEY, 'fake-access-token');
    global.fetch = jest.fn() as unknown as typeof fetch;
  });

  it('pide las sesiones de llamada del solicitante autenticado', async () => {
    const fakeSessions = [
      {
        id: 'session-1',
        roomCode: 'abc-defg-hij',
        roomName: 'Reunión de Daina',
        startedAt: '2026-01-05T10:00:00.000Z',
        endedAt: '2026-01-05T10:30:00.000Z',
        participantCount: 2,
      },
    ];
    const fetchMock = global.fetch as jest.Mock<typeof fetch>;
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(fakeSessions), { status: 200 }));

    const { getCallSessions } = await import('./api');
    const sessions = await getCallSessions();

    expect(sessions).toEqual(fakeSessions);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:3001/calls/sessions');
    expect(init).toMatchObject({ headers: { Authorization: 'Bearer fake-access-token' } });
  });

  it('propaga el mensaje del backend si falla', async () => {
    const fetchMock = global.fetch as jest.Mock<typeof fetch>;
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: 'Error inesperado del servidor' }), { status: 500 }),
    );

    const { getCallSessions, ApiError } = await import('./api');
    await expect(getCallSessions()).rejects.toThrow('Error inesperado del servidor');
    await expect(getCallSessions()).rejects.toBeInstanceOf(ApiError);
  });
});

describe('getCallSessionTimeline', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(ACCESS_TOKEN_KEY, 'fake-access-token');
    global.fetch = jest.fn() as unknown as typeof fetch;
  });

  it('pide la línea de tiempo de una sesión puntual', async () => {
    const fakeTimeline = {
      id: 'session-1',
      roomCode: 'abc-defg-hij',
      roomName: 'Reunión de Daina',
      startedAt: '2026-01-05T10:00:00.000Z',
      endedAt: '2026-01-05T10:30:00.000Z',
      participants: [
        {
          participantKey: 'user-1',
          userId: 'user-1',
          displayName: 'Daina',
          isGuest: false,
          firstJoinedAt: '2026-01-05T10:00:00.000Z',
          lastLeftAt: '2026-01-05T10:30:00.000Z',
          totalSeconds: 1800,
          spoke: true,
          screenShared: false,
          rejoinCount: 0,
          nameColor: 'pink',
        },
      ],
    };
    const fetchMock = global.fetch as jest.Mock<typeof fetch>;
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(fakeTimeline), { status: 200 }));

    const { getCallSessionTimeline } = await import('./api');
    const timeline = await getCallSessionTimeline('session-1');

    expect(timeline).toEqual(fakeTimeline);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:3001/calls/sessions/session-1/timeline');
  });

  it('expone el status 404 del backend para distinguir "sesión inexistente o ajena" de otros errores', async () => {
    const fetchMock = global.fetch as jest.Mock<typeof fetch>;
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'Sesión no encontrada' }), { status: 404 }),
    );

    const { getCallSessionTimeline } = await import('./api');
    await expect(getCallSessionTimeline('session-1')).rejects.toMatchObject({
      message: 'Sesión no encontrada',
      status: 404,
    });
  });
});

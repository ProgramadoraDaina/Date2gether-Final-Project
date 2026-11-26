import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const roomCode = 'abc-defg-hij';
const roomToken = 'room-token';

function mockFetchOnce(body: unknown, status = 200) {
  (global.fetch as jest.Mock<typeof fetch>).mockResolvedValueOnce(
    new Response(body === undefined ? null : JSON.stringify(body), { status }),
  );
}

describe('lib/breakouts', () => {
  beforeEach(() => {
    global.fetch = jest.fn() as unknown as typeof fetch;
  });

  it('createBreakoutRoom hace POST a /calls/:roomCode/breakouts con el body dado', async () => {
    const room = {
      id: 'breakout-1',
      livekitRoomName: `${roomCode}::breakout-1`,
      label: 'Mini sala 1',
      leavePolicy: 'locked',
      autoCloseAt: null,
      occupants: [],
    };
    mockFetchOnce(room, 201);
    const { createBreakoutRoom } = await import('./breakouts');

    const result = await createBreakoutRoom(roomCode, roomToken, { autoCloseInMinutes: 10 });

    expect(result).toEqual(room);
    expect(global.fetch).toHaveBeenCalledWith(
      `http://localhost:3001/calls/${roomCode}/breakouts`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${roomToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoCloseInMinutes: 10 }),
      },
    );
  });

  it('createBreakoutRoom en el tope rechaza con el mensaje del backend (409)', async () => {
    mockFetchOnce({ message: 'Alcanzaste el máximo de mini salas simultáneas' }, 409);
    const { createBreakoutRoom } = await import('./breakouts');

    await expect(createBreakoutRoom(roomCode, roomToken)).rejects.toThrow(
      'Alcanzaste el máximo de mini salas simultáneas',
    );
  });

  it('listBreakoutRooms hace GET y devuelve la lista', async () => {
    mockFetchOnce([]);
    const { listBreakoutRooms } = await import('./breakouts');

    const result = await listBreakoutRooms(roomCode, roomToken);

    expect(result).toEqual([]);
    expect(global.fetch).toHaveBeenCalledWith(
      `http://localhost:3001/calls/${roomCode}/breakouts`,
      { headers: { Authorization: `Bearer ${roomToken}` } },
    );
  });

  it('updateBreakoutRoomPolicy hace PATCH sobre la mini sala indicada', async () => {
    const room = {
      id: 'breakout-1',
      livekitRoomName: `${roomCode}::breakout-1`,
      label: 'Mini sala 1',
      leavePolicy: 'free_return',
      autoCloseAt: null,
      occupants: [],
    };
    mockFetchOnce(room);
    const { updateBreakoutRoomPolicy } = await import('./breakouts');

    const result = await updateBreakoutRoomPolicy(roomCode, roomToken, 'breakout-1', {
      leavePolicy: 'free_return',
    });

    expect(result).toEqual(room);
    expect(global.fetch).toHaveBeenCalledWith(
      `http://localhost:3001/calls/${roomCode}/breakouts/breakout-1`,
      {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${roomToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ leavePolicy: 'free_return' }),
      },
    );
  });

  it('moveToBreakoutRoom hace POST a .../participants con el livekitIdentity', async () => {
    mockFetchOnce({ targetIdentity: 'new-identity' });
    const { moveToBreakoutRoom } = await import('./breakouts');

    const result = await moveToBreakoutRoom(roomCode, roomToken, 'breakout-1', 'guest-sub');

    expect(result).toEqual({ targetIdentity: 'new-identity' });
    expect(global.fetch).toHaveBeenCalledWith(
      `http://localhost:3001/calls/${roomCode}/breakouts/breakout-1/participants`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${roomToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ livekitIdentity: 'guest-sub' }),
      },
    );
  });

  it('issueBreakoutToken hace POST a .../token y devuelve las credenciales', async () => {
    const token = {
      url: 'wss://media.example.com',
      token: 'signed-token',
      roomName: `${roomCode}::breakout-1`,
      participantLimit: 6,
    };
    mockFetchOnce(token);
    const { issueBreakoutToken } = await import('./breakouts');

    const result = await issueBreakoutToken(roomCode, roomToken, 'breakout-1');

    expect(result).toEqual(token);
    expect(global.fetch).toHaveBeenCalledWith(
      `http://localhost:3001/calls/${roomCode}/breakouts/breakout-1/token`,
      { method: 'POST', headers: { Authorization: `Bearer ${roomToken}` } },
    );
  });

  describe('returnFromBreakoutRoom', () => {
    it('manda el body vacío cuando vuelve el propio ocupante', async () => {
      mockFetchOnce(undefined, 204);
      const { returnFromBreakoutRoom } = await import('./breakouts');

      await returnFromBreakoutRoom(roomCode, roomToken, 'breakout-1');

      expect(global.fetch).toHaveBeenCalledWith(
        `http://localhost:3001/calls/${roomCode}/breakouts/breakout-1/return`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${roomToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        },
      );
    });

    it('manda livekitIdentity cuando un administrador devuelve a otro ocupante', async () => {
      mockFetchOnce(undefined, 204);
      const { returnFromBreakoutRoom } = await import('./breakouts');

      await returnFromBreakoutRoom(roomCode, roomToken, 'breakout-1', 'other-identity');

      expect(global.fetch).toHaveBeenCalledWith(
        `http://localhost:3001/calls/${roomCode}/breakouts/breakout-1/return`,
        expect.objectContaining({ body: JSON.stringify({ livekitIdentity: 'other-identity' }) }),
      );
    });

    it('mapea el código BREAKOUT_RETURN_LOCKED a un mensaje propio del cliente, no al texto crudo del backend', async () => {
      mockFetchOnce(
        { message: 'texto interno que no debe mostrarse', code: 'BREAKOUT_RETURN_LOCKED' },
        403,
      );
      const { returnFromBreakoutRoom } = await import('./breakouts');

      await expect(returnFromBreakoutRoom(roomCode, roomToken, 'breakout-1')).rejects.toThrow(
        'El host te va a devolver a la sala principal.',
      );
    });

    it('si el rechazo no trae código, cae al mensaje crudo del backend', async () => {
      mockFetchOnce({ message: 'La mini sala ya no existe' }, 404);
      const { returnFromBreakoutRoom } = await import('./breakouts');

      await expect(returnFromBreakoutRoom(roomCode, roomToken, 'breakout-1')).rejects.toThrow(
        'La mini sala ya no existe',
      );
    });
  });

  it('closeBreakoutRoom hace DELETE sobre la mini sala indicada', async () => {
    mockFetchOnce(undefined, 204);
    const { closeBreakoutRoom } = await import('./breakouts');

    await closeBreakoutRoom(roomCode, roomToken, 'breakout-1');

    expect(global.fetch).toHaveBeenCalledWith(
      `http://localhost:3001/calls/${roomCode}/breakouts/breakout-1`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${roomToken}` } },
    );
  });

  it('closeAllBreakoutRooms hace DELETE sobre la colección de mini salas', async () => {
    mockFetchOnce(undefined, 204);
    const { closeAllBreakoutRooms } = await import('./breakouts');

    await closeAllBreakoutRooms(roomCode, roomToken);

    expect(global.fetch).toHaveBeenCalledWith(
      `http://localhost:3001/calls/${roomCode}/breakouts`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${roomToken}` } },
    );
  });

  // Decisión 3 (design.md "joinPolicy: esquema, migración y autorización",
  // tasks.md 5.5): joinPolicy viaja igual que leavePolicy, sin mezclarse.
  it('[5.5] createBreakoutRoom envía joinPolicy cuando se indica', async () => {
    mockFetchOnce(
      {
        id: 'breakout-1',
        livekitRoomName: `${roomCode}::breakout-1`,
        label: 'Mini sala 1',
        leavePolicy: 'locked',
        joinPolicy: 'open',
        autoCloseAt: null,
        occupants: [],
      },
      201,
    );
    const { createBreakoutRoom } = await import('./breakouts');

    await createBreakoutRoom(roomCode, roomToken, { joinPolicy: 'open' });

    expect(global.fetch).toHaveBeenCalledWith(
      `http://localhost:3001/calls/${roomCode}/breakouts`,
      expect.objectContaining({ body: JSON.stringify({ joinPolicy: 'open' }) }),
    );
  });

  it('[5.5] updateBreakoutRoomPolicy envía joinPolicy sin incluir leavePolicy cuando solo se cambia uno', async () => {
    mockFetchOnce({
      id: 'breakout-1',
      livekitRoomName: `${roomCode}::breakout-1`,
      label: 'Mini sala 1',
      leavePolicy: 'locked',
      joinPolicy: 'open',
      autoCloseAt: null,
      occupants: [],
    });
    const { updateBreakoutRoomPolicy } = await import('./breakouts');

    await updateBreakoutRoomPolicy(roomCode, roomToken, 'breakout-1', { joinPolicy: 'open' });

    expect(global.fetch).toHaveBeenCalledWith(
      `http://localhost:3001/calls/${roomCode}/breakouts/breakout-1`,
      expect.objectContaining({ body: JSON.stringify({ joinPolicy: 'open' }) }),
    );
  });

  // Decisión 2 (design.md "Señal de motivo de remoción", tasks.md 5.5):
  // mapeo código->copia para que useCallSession.removedByPolicy(code) y
  // endedForBreakout() tengan un mensaje propio y específico que
  // renderizar, en vez de dejar un código crudo visible.
  describe('[5.5] resolveBreakoutEndCopy', () => {
    it('breakout-locked resuelve al mensaje de política de BREAKOUT_RETURN_LOCKED', async () => {
      const { resolveBreakoutEndCopy } = await import('./breakouts');

      expect(resolveBreakoutEndCopy('breakout-locked')).toBe(
        'El host te va a devolver a la sala principal.',
      );
    });

    it('breakout-closed resuelve a un mensaje propio, distinto del de breakout-locked', async () => {
      const { resolveBreakoutEndCopy } = await import('./breakouts');

      const closedCopy = resolveBreakoutEndCopy('breakout-closed');

      expect(closedCopy).toBeTruthy();
      expect(closedCopy).not.toBe('El host te va a devolver a la sala principal.');
    });
  });
});

import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const ACCESS_TOKEN_KEY = 'date2gether:accessToken';

// Mismo motivo que en chime.spec.ts: next/jest no hoistea jest.mock() por
// encima de imports estáticos, así que el mock y el import de './socket' se
// cargan dinámicamente dentro del test.
jest.mock('socket.io-client', () => ({
  io: jest.fn(),
}));

describe('createRoomSocket', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('conecta al namespace /rooms mandando el access token en el handshake', async () => {
    const { io } = await import('socket.io-client');
    const { createRoomSocket } = await import('./socket');
    localStorage.setItem(ACCESS_TOKEN_KEY, 'fake-access-token');

    createRoomSocket();

    expect(io).toHaveBeenCalledWith(
      'http://localhost:3001/rooms',
      expect.objectContaining({ auth: { token: 'fake-access-token' } }),
    );
  });
});

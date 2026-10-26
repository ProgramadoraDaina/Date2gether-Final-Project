import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react';

// Mismo motivo que en useCallSession.spec.ts: next/jest no hoistea
// jest.mock() por encima de imports estáticos, así que los mocks y el import
// de './page' se cargan dinámicamente dentro de cada test, después del mock.
// useCallSession se mockea porque arrastra ./chime -> amazon-chime-sdk-js,
// que no se puede cargar en este test (ver chime.spec.ts).
const push = jest.fn();
jest.mock('next/navigation', () => ({
  useParams: () => ({ code: 'abc-defg-hij' }),
  useRouter: () => ({ push }),
}));
jest.mock('@/features/translation/useTranslation', () => {
  const t = (key: string) => key;
  return { useTranslation: () => ({ t }) };
});
jest.mock('@/features/rooms/useRoomMembers', () => {
  const state = {
    members: [],
    isCurrentUserAdmin: false,
    error: null,
    changeRole: jest.fn(),
    refetchMembers: jest.fn(),
  };
  return { useRoomMembers: () => state };
});
jest.mock('@/lib/auth', () => ({ isLoggedIn: jest.fn() }));
jest.mock('@/lib/socket', () => ({ createRoomSocket: jest.fn() }));
jest.mock('@/features/calls/useCallSession', () => ({
  useCallSession: () => ({
    status: 'idle',
    error: null,
    meetingSession: null,
    joinCall: jest.fn(),
    leaveCall: jest.fn(),
  }),
}));

describe('RoomPage', () => {
  beforeEach(() => {
    push.mockClear();
  });

  it('redirige a /login sin conectar el socket si no hay sesión', async () => {
    const { isLoggedIn } = await import('@/lib/auth');
    const { createRoomSocket } = await import('@/lib/socket');
    (isLoggedIn as jest.Mock<typeof isLoggedIn>).mockReturnValue(false);

    const RoomPage = (await import('./page')).default;
    render(<RoomPage />);

    expect(push).toHaveBeenCalledWith('/login');
    expect(createRoomSocket).not.toHaveBeenCalled();
  });

  it('conecta el socket normalmente si hay sesión', async () => {
    const { isLoggedIn } = await import('@/lib/auth');
    const { createRoomSocket } = await import('@/lib/socket');
    (isLoggedIn as jest.Mock<typeof isLoggedIn>).mockReturnValue(true);
    const fakeSocket = {
      on: jest.fn(),
      emit: jest.fn(),
      connect: jest.fn(),
      disconnect: jest.fn(),
      removeAllListeners: jest.fn(),
    };
    (createRoomSocket as jest.Mock<typeof createRoomSocket>).mockReturnValue(fakeSocket as never);

    const RoomPage = (await import('./page')).default;
    render(<RoomPage />);

    await screen.findByText('abc-defg-hij');
    expect(createRoomSocket).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalledWith('/login');
  });
});

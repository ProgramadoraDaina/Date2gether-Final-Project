import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react';

jest.mock('next/navigation', () => ({
  useParams: () => ({ sessionId: 'session-1' }),
  usePathname: () => '/history/session-1',
}));
jest.mock('@/features/translation/useTranslation', () => {
  const t = (key: string) => key;
  return { useTranslation: () => ({ t, language: 'es' }) };
});
jest.mock('@/lib/auth', () => ({ isLoggedIn: jest.fn() }));
jest.mock('@/lib/api', () => ({
  getCallSessionTimeline: jest.fn(),
  ApiError: class extends Error {
    status?: number;
    constructor(message: string, status?: number) {
      super(message);
      this.status = status;
    }
  },
}));

describe('CallSessionTimelinePage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('muestra el mensaje de inicio de sesión si no hay sesión', async () => {
    const { isLoggedIn } = await import('@/lib/auth');
    (isLoggedIn as jest.Mock<typeof isLoggedIn>).mockReturnValue(false);
    const Page = (await import('./page')).default;
    render(<Page />);
    await screen.findByText('Necesitás iniciar sesión para ver esta línea de tiempo.');
  });

  it('muestra la línea de tiempo cuando la sesión existe y el solicitante participó', async () => {
    const { isLoggedIn } = await import('@/lib/auth');
    const { getCallSessionTimeline } = await import('@/lib/api');
    (isLoggedIn as jest.Mock<typeof isLoggedIn>).mockReturnValue(true);
    (getCallSessionTimeline as jest.Mock<typeof getCallSessionTimeline>).mockResolvedValue({
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
          trackIntervals: [],
          nameColor: 'pink',
        },
      ],
    });
    const Page = (await import('./page')).default;
    render(<Page />);
    await screen.findByText('Daina');
    expect(screen.getByText('Reunión de Daina')).toBeInTheDocument();
    expect(getCallSessionTimeline).toHaveBeenCalledWith('session-1');
  });

  it('muestra un mensaje claro (no un error genérico) cuando el backend responde 404', async () => {
    const { isLoggedIn } = await import('@/lib/auth');
    const { getCallSessionTimeline, ApiError } = await import('@/lib/api');
    (isLoggedIn as jest.Mock<typeof isLoggedIn>).mockReturnValue(true);
    (getCallSessionTimeline as jest.Mock<typeof getCallSessionTimeline>).mockRejectedValue(
      new ApiError('Sesión no encontrada', 404),
    );
    const Page = (await import('./page')).default;
    render(<Page />);
    await screen.findByText('No encontramos esta sesión, o no participaste de ella.');
  });

  it('muestra el mensaje de error del backend ante una falla inesperada (no 404)', async () => {
    const { isLoggedIn } = await import('@/lib/auth');
    const { getCallSessionTimeline, ApiError } = await import('@/lib/api');
    (isLoggedIn as jest.Mock<typeof isLoggedIn>).mockReturnValue(true);
    (getCallSessionTimeline as jest.Mock<typeof getCallSessionTimeline>).mockRejectedValue(
      new ApiError('Error de servidor', 500),
    );
    const Page = (await import('./page')).default;
    render(<Page />);
    await screen.findByText('Error de servidor');
  });
});

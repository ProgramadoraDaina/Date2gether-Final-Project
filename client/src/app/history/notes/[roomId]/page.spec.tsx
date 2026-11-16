import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react';

jest.mock('next/navigation', () => ({
  useParams: () => ({ roomId: 'room-1' }),
  useSearchParams: () => new URLSearchParams('code=abc-defg-hij'),
  usePathname: () => '/history/notes/room-1',
}));
jest.mock('@/features/translation/useTranslation', () => {
  const t = (key: string) => key;
  return { useTranslation: () => ({ t, language: 'es' }) };
});
jest.mock('@/lib/auth', () => ({ isLoggedIn: jest.fn(), getCurrentUser: jest.fn() }));
jest.mock('@/lib/api', () => ({
  getRoomNotesFromHistory: jest.fn(),
  ApiError: class extends Error {
    status?: number;
    constructor(message: string, status?: number) {
      super(message);
      this.status = status;
    }
  },
}));

describe('RoomNotesFromHistoryPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
  });

  it('muestra el mensaje de inicio de sesión si no hay sesión', async () => {
    const { isLoggedIn } = await import('@/lib/auth');
    (isLoggedIn as jest.Mock<typeof isLoggedIn>).mockReturnValue(false);
    const Page = (await import('./page')).default;
    render(<Page />);
    await screen.findByText('Necesitás iniciar sesión para ver estas notas.');
  });

  it('muestra las notas personales (de este dispositivo) y las de la sala', async () => {
    const { isLoggedIn, getCurrentUser } = await import('@/lib/auth');
    const { getRoomNotesFromHistory } = await import('@/lib/api');
    (isLoggedIn as jest.Mock<typeof isLoggedIn>).mockReturnValue(true);
    (getCurrentUser as jest.Mock<typeof getCurrentUser>).mockResolvedValue({
      id: 'user-1',
      email: 'a@a.com',
      name: 'Daina',
      createdAt: '2026-01-01',
      nameColor: null,
    });
    localStorage.setItem('date2gether:notes:abc-defg-hij:user-1', 'Mi nota personal');
    (getRoomNotesFromHistory as jest.Mock<typeof getRoomNotesFromHistory>).mockResolvedValue({
      roomId: 'room-1',
      content: 'Nota compartida de la sala',
      revision: 2,
      updatedAt: '2026-01-05T10:00:00.000Z',
    });

    const Page = (await import('./page')).default;
    render(<Page />);

    await screen.findByText('Mi nota personal');
    expect(screen.getByText('Nota compartida de la sala')).toBeInTheDocument();
    expect(getRoomNotesFromHistory).toHaveBeenCalledWith('room-1');
  });

  it('muestra los estados vacíos cuando no hay notas de ningún lado', async () => {
    const { isLoggedIn, getCurrentUser } = await import('@/lib/auth');
    const { getRoomNotesFromHistory } = await import('@/lib/api');
    (isLoggedIn as jest.Mock<typeof isLoggedIn>).mockReturnValue(true);
    (getCurrentUser as jest.Mock<typeof getCurrentUser>).mockResolvedValue({
      id: 'user-1',
      email: 'a@a.com',
      name: 'Daina',
      createdAt: '2026-01-01',
      nameColor: null,
    });
    (getRoomNotesFromHistory as jest.Mock<typeof getRoomNotesFromHistory>).mockResolvedValue({
      roomId: 'room-1',
      content: '',
      revision: 0,
      updatedAt: '2026-01-05T10:00:00.000Z',
    });

    const Page = (await import('./page')).default;
    render(<Page />);

    await screen.findByText('No escribiste notas personales en este dispositivo para esta sala.');
    expect(screen.getByText('Esta sala no tiene notas compartidas.')).toBeInTheDocument();
  });

  it('muestra un mensaje claro cuando el usuario no tiene historial en esa sala', async () => {
    const { isLoggedIn, getCurrentUser } = await import('@/lib/auth');
    const { getRoomNotesFromHistory, ApiError } = await import('@/lib/api');
    (isLoggedIn as jest.Mock<typeof isLoggedIn>).mockReturnValue(true);
    (getCurrentUser as jest.Mock<typeof getCurrentUser>).mockResolvedValue({
      id: 'user-1',
      email: 'a@a.com',
      name: 'Daina',
      createdAt: '2026-01-01',
      nameColor: null,
    });
    (getRoomNotesFromHistory as jest.Mock<typeof getRoomNotesFromHistory>).mockRejectedValue(
      new ApiError('No tenés historial en esta sala', 403),
    );

    const Page = (await import('./page')).default;
    render(<Page />);

    await screen.findByText('No encontramos historial en esta sala, o no participaste de ella.');
  });
});

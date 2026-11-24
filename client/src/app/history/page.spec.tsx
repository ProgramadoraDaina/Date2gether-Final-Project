import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen, within } from '@testing-library/react';

import type { CallHistoryEntry, CallHistoryPage } from '@/lib/api';

function page(entries: CallHistoryEntry[] = []): CallHistoryPage {
  return { entries, nextCursor: null, hasArchived: false };
}

let searchParams = new URLSearchParams();
jest.mock('next/navigation', () => ({
  usePathname: () => '/history',
  useSearchParams: () => searchParams,
}));
jest.mock('@/features/translation/useTranslation', () => {
  const t = (key: string) => key;
  return { useTranslation: () => ({ t, language: 'es' }) };
});
jest.mock('@/features/auth/RequireAuth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/lib/auth', () => ({ isLoggedIn: jest.fn() }));
// El riel de navegación pide el rol global; estas pruebas no ejercitan el link de admin.
jest.mock('@/features/auth/useGlobalRole', () => ({ useGlobalRole: () => 'user' }));
jest.mock('@/lib/api', () => ({
  getCallHistory: jest.fn(),
  getOwnedRooms: jest.fn(),
  ApiError: class extends Error {},
}));

describe('HistoryPage', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    searchParams = new URLSearchParams();
    const { getOwnedRooms } = await import('@/lib/api');
    (getOwnedRooms as jest.Mock<typeof getOwnedRooms>).mockResolvedValue([]);
  });

  it('muestra las entradas del historial cuando hay sesión, sin botón al gráfico si no hay sesión materializada', async () => {
    const { isLoggedIn } = await import('@/lib/auth');
    const { getCallHistory } = await import('@/lib/api');
    (isLoggedIn as jest.Mock<typeof isLoggedIn>).mockReturnValue(true);
    (getCallHistory as jest.Mock<typeof getCallHistory>).mockResolvedValue(
      page([
        {
          id: 'entry-1',
          roomId: 'room-1',
          roomCode: 'abc-defg-hij',
          roomName: 'Reunión de Daina',
          startedAt: '2026-01-05T10:00:00.000Z',
          sessionId: null,
        },
      ]),
    );
    const HistoryPage = (await import('./page')).default;
    render(<HistoryPage />);
    await screen.findByText('Reunión de Daina');
    expect(screen.getByText('abc-defg-hij')).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Ver gráfico de interacción' }),
    ).not.toBeInTheDocument();
  });

  it('muestra el estado vacío cuando no hay llamadas', async () => {
    const { isLoggedIn } = await import('@/lib/auth');
    const { getCallHistory } = await import('@/lib/api');
    (isLoggedIn as jest.Mock<typeof isLoggedIn>).mockReturnValue(true);
    (getCallHistory as jest.Mock<typeof getCallHistory>).mockResolvedValue(page());
    const HistoryPage = (await import('./page')).default;
    render(<HistoryPage />);
    await screen.findByText('No hay llamadas en los últimos 90 días.');
  });

  it('muestra una sala heredada como admin sin llamadas y permite entrar desde el historial', async () => {
    const { isLoggedIn } = await import('@/lib/auth');
    const { getCallHistory, getOwnedRooms } = await import('@/lib/api');
    (isLoggedIn as jest.Mock<typeof isLoggedIn>).mockReturnValue(true);
    (getCallHistory as jest.Mock<typeof getCallHistory>).mockResolvedValue(page());
    (getOwnedRooms as jest.Mock<typeof getOwnedRooms>).mockResolvedValue([
      {
        id: 'room-inherited',
        code: 'xyz-abcd-efg',
        name: 'Sala heredada',
        isJoinable: true,
      } as never,
      {
        id: 'room-expired',
        code: 'old-abcd-efg',
        name: 'Sala vencida',
        isJoinable: false,
      } as never,
    ]);
    const HistoryPage = (await import('./page')).default;
    render(<HistoryPage />);

    const rooms = within(screen.getByRole('region', { name: 'Salas que administrás' }));
    await rooms.findByText('Sala heredada');
    expect(rooms.getByRole('link', { name: 'Entrar' })).toHaveAttribute(
      'href',
      '/room/xyz-abcd-efg',
    );
    expect(rooms.getAllByRole('link', { name: 'Entrar' })).toHaveLength(1);
    expect(rooms.getByText('Vencida')).toBeInTheDocument();
    expect(await screen.findByText('No hay llamadas en los últimos 90 días.')).toBeInTheDocument();
  });

  it('un fallo al cargar salas no oculta el historial de llamadas', async () => {
    const { isLoggedIn } = await import('@/lib/auth');
    const { getCallHistory, getOwnedRooms } = await import('@/lib/api');
    (isLoggedIn as jest.Mock<typeof isLoggedIn>).mockReturnValue(true);
    (getCallHistory as jest.Mock<typeof getCallHistory>).mockResolvedValue(page());
    (getOwnedRooms as jest.Mock<typeof getOwnedRooms>).mockRejectedValue(new Error('offline'));
    const HistoryPage = (await import('./page')).default;
    render(<HistoryPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudieron cargar tus salas');
    expect(await screen.findByText('No hay llamadas en los últimos 90 días.')).toBeInTheDocument();
  });

  it('muestra el botón "Ver gráfico de interacción" en la fila de un intento que sí se materializó en una sesión', async () => {
    const { isLoggedIn } = await import('@/lib/auth');
    const { getCallHistory } = await import('@/lib/api');
    (isLoggedIn as jest.Mock<typeof isLoggedIn>).mockReturnValue(true);
    (getCallHistory as jest.Mock<typeof getCallHistory>).mockResolvedValue(
      page([
        {
          id: 'entry-1',
          roomId: 'room-1',
          roomCode: 'abc-defg-hij',
          roomName: 'Reunión de Daina',
          startedAt: '2026-01-05T10:00:00.000Z',
          sessionId: 'session-1',
        },
      ]),
    );
    const HistoryPage = (await import('./page')).default;
    render(<HistoryPage />);
    expect(await screen.findByRole('link', { name: 'Ver gráfico de interacción' })).toHaveAttribute(
      'href',
      '/history/session-1',
    );
  });

  it('[5.9] el botón "Obtener notas" enlaza por roomId, con roomCode como query param', async () => {
    const { isLoggedIn } = await import('@/lib/auth');
    const { getCallHistory } = await import('@/lib/api');
    (isLoggedIn as jest.Mock<typeof isLoggedIn>).mockReturnValue(true);
    (getCallHistory as jest.Mock<typeof getCallHistory>).mockResolvedValue(
      page([
        {
          id: 'entry-1',
          roomId: 'room-1',
          roomCode: 'abc-defg-hij',
          roomName: 'Reunión de Daina',
          startedAt: '2026-01-05T10:00:00.000Z',
          sessionId: null,
        },
      ]),
    );
    const HistoryPage = (await import('./page')).default;
    render(<HistoryPage />);
    expect(await screen.findByRole('link', { name: 'Obtener notas' })).toHaveAttribute(
      'href',
      '/history/notes/room-1?code=abc-defg-hij',
    );
  });

  it('con ?roomId= muestra solo las llamadas de esa sala y ofrece volver a todo el historial', async () => {
    searchParams = new URLSearchParams({ roomId: 'room-2' });
    const { isLoggedIn } = await import('@/lib/auth');
    const { getCallHistory } = await import('@/lib/api');
    (isLoggedIn as jest.Mock<typeof isLoggedIn>).mockReturnValue(true);
    (getCallHistory as jest.Mock<typeof getCallHistory>).mockResolvedValue(
      page([
        {
          id: 'entry-2',
          roomId: 'room-2',
          roomCode: 'xyz-abcd-efg',
          roomName: 'Cita de los lunes',
          startedAt: '2026-01-06T10:00:00.000Z',
          sessionId: 'session-2',
        },
      ]),
    );
    const HistoryPage = (await import('./page')).default;
    render(<HistoryPage />);

    await screen.findByText('Mostrando solo las llamadas de Cita de los lunes.');
    expect(getCallHistory).toHaveBeenCalledWith('recent', 'room-2', null, expect.any(AbortSignal));
    expect(screen.queryByText('Reunión de Daina')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver todo el historial' })).toHaveAttribute(
      'href',
      '/history',
    );
    expect(screen.getByRole('link', { name: 'Ver transcripción' })).toHaveAttribute(
      'href',
      '/history/session-2#transcript',
    );
  });

  it('con ?roomId= de una sala sin llamadas, lo dice en vez del estado vacío general', async () => {
    searchParams = new URLSearchParams({ roomId: 'room-9' });
    const { isLoggedIn } = await import('@/lib/auth');
    const { getCallHistory } = await import('@/lib/api');
    (isLoggedIn as jest.Mock<typeof isLoggedIn>).mockReturnValue(true);
    (getCallHistory as jest.Mock<typeof getCallHistory>).mockResolvedValue(page());
    const HistoryPage = (await import('./page')).default;
    render(<HistoryPage />);

    await screen.findByText('Esta sala no tiene llamadas recientes.');
    expect(screen.queryByText('Reunión de Daina')).not.toBeInTheDocument();
  });
});

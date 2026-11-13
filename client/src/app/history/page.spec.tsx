import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react';

let mockLanguage: 'es' | 'en' = 'es';

jest.mock('next/navigation', () => ({ usePathname: () => '/history' }));
jest.mock('@/features/translation/useTranslation', () => {
  const es = (key: string) => key;
  const en = (key: string) =>
    ({
      'No se pudo obtener el historial': 'Could not load call history',
      'No se pudieron obtener las sesiones de llamada': 'Could not load call sessions',
    })[key] ?? key;
  return { useTranslation: () => ({ t: mockLanguage === 'en' ? en : es, language: mockLanguage }) };
});
jest.mock('@/lib/auth', () => ({ isLoggedIn: jest.fn(), onAuthChange: () => () => {} }));
jest.mock('@/lib/api', () => ({
  getCallHistory: jest.fn(),
  getCallSessions: jest.fn(),
  ApiError: class extends Error {},
}));

describe('HistoryPage', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockLanguage = 'es';
    const { getCallHistory, getCallSessions } = await import('@/lib/api');
    jest.mocked(getCallHistory).mockResolvedValue([]);
    jest.mocked(getCallSessions).mockResolvedValue([]);
  });

  it('muestra el mensaje de inicio de sesión si no hay sesión', async () => {
    const { isLoggedIn } = await import('@/lib/auth');
    (isLoggedIn as jest.Mock<typeof isLoggedIn>).mockReturnValue(false);
    const HistoryPage = (await import('./page')).default;
    render(<HistoryPage />);
    await screen.findByText('Necesitás iniciar sesión para ver tu historial de llamadas.');
    expect(screen.getByRole('link', { name: 'Iniciar sesión' })).toHaveAttribute('href', '/login');
  });

  it('muestra las entradas del historial cuando hay sesión', async () => {
    const { isLoggedIn } = await import('@/lib/auth');
    const { getCallHistory, getCallSessions } = await import('@/lib/api');
    (isLoggedIn as jest.Mock<typeof isLoggedIn>).mockReturnValue(true);
    (getCallHistory as jest.Mock<typeof getCallHistory>).mockResolvedValue([
      {
        roomCode: 'abc-defg-hij',
        roomName: 'Reunión de Daina',
        startedAt: '2026-01-05T10:00:00.000Z',
      },
    ]);
    (getCallSessions as jest.Mock<typeof getCallSessions>).mockResolvedValue([]);
    const HistoryPage = (await import('./page')).default;
    render(<HistoryPage />);
    await screen.findByText('Reunión de Daina');
    expect(screen.getByText('abc-defg-hij')).toBeInTheDocument();
  });

  it('muestra el estado vacío cuando no hay llamadas', async () => {
    const { isLoggedIn } = await import('@/lib/auth');
    const { getCallHistory, getCallSessions } = await import('@/lib/api');
    (isLoggedIn as jest.Mock<typeof isLoggedIn>).mockReturnValue(true);
    (getCallHistory as jest.Mock<typeof getCallHistory>).mockResolvedValue([]);
    (getCallSessions as jest.Mock<typeof getCallSessions>).mockResolvedValue([]);
    const HistoryPage = (await import('./page')).default;
    render(<HistoryPage />);
    await screen.findByText('Todavía no hiciste ninguna llamada.');
  });

  it('muestra la sección de sesiones de llamada con un link a la línea de tiempo de cada una', async () => {
    const { isLoggedIn } = await import('@/lib/auth');
    const { getCallHistory, getCallSessions } = await import('@/lib/api');
    (isLoggedIn as jest.Mock<typeof isLoggedIn>).mockReturnValue(true);
    (getCallHistory as jest.Mock<typeof getCallHistory>).mockResolvedValue([]);
    (getCallSessions as jest.Mock<typeof getCallSessions>).mockResolvedValue([
      {
        id: 'session-1',
        roomCode: 'abc-defg-hij',
        roomName: 'Reunión de Daina',
        startedAt: '2026-01-05T10:00:00.000Z',
        endedAt: '2026-01-05T10:30:00.000Z',
        participantCount: 3,
      },
    ]);
    const HistoryPage = (await import('./page')).default;
    render(<HistoryPage />);
    await screen.findByText('Sesiones de llamada');
    expect(screen.getAllByText('Reunión de Daina')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Ver línea de tiempo' })).toHaveAttribute(
      'href',
      '/history/session-1',
    );
  });

  it('muestra el estado vacío de sesiones de llamada cuando no hay ninguna', async () => {
    const { isLoggedIn } = await import('@/lib/auth');
    const { getCallHistory, getCallSessions } = await import('@/lib/api');
    (isLoggedIn as jest.Mock<typeof isLoggedIn>).mockReturnValue(true);
    (getCallHistory as jest.Mock<typeof getCallHistory>).mockResolvedValue([]);
    (getCallSessions as jest.Mock<typeof getCallSessions>).mockResolvedValue([]);
    const HistoryPage = (await import('./page')).default;
    render(<HistoryPage />);
    await screen.findByText('Todavía no participaste de ninguna sesión de llamada.');
  });

  it.each(['history', 'sessions'])(
    'traduce errores de %s sin repetir consultas al cambiar el idioma',
    async (source) => {
      const { isLoggedIn } = await import('@/lib/auth');
      const { getCallHistory, getCallSessions } = await import('@/lib/api');
      jest.mocked(isLoggedIn).mockReturnValue(true);
      if (source === 'history') jest.mocked(getCallHistory).mockRejectedValue(new Error('offline'));
      else jest.mocked(getCallSessions).mockRejectedValue(new Error('offline'));
      const spanish =
        source === 'history'
          ? 'No se pudo obtener el historial'
          : 'No se pudieron obtener las sesiones de llamada';
      const english =
        source === 'history' ? 'Could not load call history' : 'Could not load call sessions';
      const HistoryPage = (await import('./page')).default;
      const view = render(<HistoryPage />);
      await screen.findByText(spanish);
      mockLanguage = 'en';
      view.rerender(<HistoryPage />);
      expect(screen.getByRole('alert')).toHaveTextContent(english);
      expect(getCallHistory).toHaveBeenCalledTimes(1);
      expect(getCallSessions).toHaveBeenCalledTimes(1);
    },
  );
});

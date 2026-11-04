import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react';

jest.mock('next/navigation', () => ({ usePathname: () => '/history' }));
jest.mock('@/features/translation/useTranslation', () => {
  const t = (key: string) => key;
  return { useTranslation: () => ({ t, language: 'es' }) };
});
jest.mock('@/lib/auth', () => ({ isLoggedIn: jest.fn() }));
jest.mock('@/lib/api', () => ({
  getCallHistory: jest.fn(),
  ApiError: class extends Error {},
}));

describe('HistoryPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('muestra el mensaje de inicio de sesión si no hay sesión', async () => {
    const { isLoggedIn } = await import('@/lib/auth');
    (isLoggedIn as jest.Mock<typeof isLoggedIn>).mockReturnValue(false);
    const HistoryPage = (await import('./page')).default;
    render(<HistoryPage />);
    await screen.findByText('Necesitás iniciar sesión para ver tu historial de llamadas.');
    expect(screen.getByRole('link', { name: 'Iniciar sesión' })).toHaveAttribute(
      'href',
      '/login',
    );
  });

  it('muestra las entradas del historial cuando hay sesión', async () => {
    const { isLoggedIn } = await import('@/lib/auth');
    const { getCallHistory } = await import('@/lib/api');
    (isLoggedIn as jest.Mock<typeof isLoggedIn>).mockReturnValue(true);
    (getCallHistory as jest.Mock<typeof getCallHistory>).mockResolvedValue([
      { roomCode: 'abc-defg-hij', roomName: 'Reunión de Daina', startedAt: '2026-01-05T10:00:00.000Z' },
    ]);
    const HistoryPage = (await import('./page')).default;
    render(<HistoryPage />);
    await screen.findByText('Reunión de Daina');
    expect(screen.getByText('abc-defg-hij')).toBeInTheDocument();
  });

  it('muestra el estado vacío cuando no hay llamadas', async () => {
    const { isLoggedIn } = await import('@/lib/auth');
    const { getCallHistory } = await import('@/lib/api');
    (isLoggedIn as jest.Mock<typeof isLoggedIn>).mockReturnValue(true);
    (getCallHistory as jest.Mock<typeof getCallHistory>).mockResolvedValue([]);
    const HistoryPage = (await import('./page')).default;
    render(<HistoryPage />);
    await screen.findByText('Todavía no hiciste ninguna llamada.');
  });
});

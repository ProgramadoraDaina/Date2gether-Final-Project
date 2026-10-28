import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react';

jest.mock('next/navigation', () => ({ usePathname: () => '/settings' }));
jest.mock('@/features/translation/useTranslation', () => {
  const t = (key: string) => key;
  return { useTranslation: () => ({ t }) };
});
jest.mock('@/lib/auth', () => ({ isLoggedIn: jest.fn(), getCurrentUser: jest.fn() }));
jest.mock('@/lib/api', () => ({
  updateNameColor: jest.fn(),
  ApiError: class extends Error {},
}));

describe('SettingsPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('muestra el mensaje de inicio de sesión si no hay sesión', async () => {
    const { isLoggedIn } = await import('@/lib/auth');
    (isLoggedIn as jest.Mock<typeof isLoggedIn>).mockReturnValue(false);
    const SettingsPage = (await import('./page')).default;
    render(<SettingsPage />);
    await screen.findByText('Necesitás iniciar sesión para elegir el color de tu nombre.');
  });

  it('renderiza los 8 colores de la paleta cuando hay sesión', async () => {
    const { isLoggedIn, getCurrentUser } = await import('@/lib/auth');
    (isLoggedIn as jest.Mock<typeof isLoggedIn>).mockReturnValue(true);
    (getCurrentUser as jest.Mock<typeof getCurrentUser>).mockResolvedValue({
      id: '1',
      email: 'a@a.com',
      name: 'Daina',
      createdAt: '2026-01-01',
      nameColor: null,
    });
    const SettingsPage = (await import('./page')).default;
    render(<SettingsPage />);
    await screen.findByText('Elegí el color de tu nombre');
    expect(screen.getByRole('button', { name: 'Púrpura' })).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(8);
  });

  it('elegir un color llama a updateNameColor y lo marca como seleccionado', async () => {
    const { isLoggedIn, getCurrentUser } = await import('@/lib/auth');
    const { updateNameColor } = await import('@/lib/api');
    (isLoggedIn as jest.Mock<typeof isLoggedIn>).mockReturnValue(true);
    (getCurrentUser as jest.Mock<typeof getCurrentUser>).mockResolvedValue({
      id: '1',
      email: 'a@a.com',
      name: 'Daina',
      createdAt: '2026-01-01',
      nameColor: null,
    });
    (updateNameColor as jest.Mock<typeof updateNameColor>).mockResolvedValue({
      id: '1',
      email: 'a@a.com',
      name: 'Daina',
      createdAt: '2026-01-01',
      nameColor: 'teal',
    });
    const SettingsPage = (await import('./page')).default;
    render(<SettingsPage />);
    const tealButton = await screen.findByRole('button', { name: 'Verde azulado' });
    fireEvent.click(tealButton);
    await screen.findByText('Guardado');
    expect(updateNameColor).toHaveBeenCalledWith('teal');
    expect(tealButton).toHaveAttribute('aria-pressed', 'true');
  });
});

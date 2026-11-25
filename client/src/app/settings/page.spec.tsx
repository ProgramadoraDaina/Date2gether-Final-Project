import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

jest.mock('next/navigation', () => ({ usePathname: () => '/settings' }));
jest.mock('@/features/translation/useTranslation', () => {
  const t = (key: string) => key;
  return { useTranslation: () => ({ t }) };
});
jest.mock('@/lib/auth', () => ({ isLoggedIn: jest.fn(), getCurrentUser: jest.fn() }));
// El riel de navegación pide el rol global; estas pruebas no ejercitan el link de admin.
jest.mock('@/features/auth/useGlobalRole', () => ({ useGlobalRole: () => 'user' }));
jest.mock('@/lib/api', () => ({
  updateNameColor: jest.fn(),
  updateAvatar: jest.fn(),
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
    // Se escopea al grupo de la paleta, no a toda la página: el toggle de
    // tema (ThemeToggle) también es un <button> en esta pantalla.
    expect(
      within(screen.getByRole('group', { name: 'Elegí el color de tu nombre' })).getAllByRole(
        'button',
      ),
    ).toHaveLength(8);
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

  it('con sesión trae el avatar guardado y al guardarlo desde el modal lo manda al servidor', async () => {
    const { isLoggedIn, getCurrentUser } = await import('@/lib/auth');
    const { updateAvatar } = await import('@/lib/api');
    (isLoggedIn as jest.Mock<typeof isLoggedIn>).mockReturnValue(true);
    (getCurrentUser as jest.Mock<typeof getCurrentUser>).mockResolvedValue({
      id: '1',
      email: 'a@a.com',
      name: 'Daina',
      createdAt: '2026-01-01',
      nameColor: null,
      avatar: { head: ['crown'], sticker: true },
    });
    (updateAvatar as jest.Mock<typeof updateAvatar>).mockResolvedValue({} as never);
    const SettingsPage = (await import('./page')).default;
    render(<SettingsPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Personalizar avatar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar avatar' }));

    await waitFor(() =>
      expect(updateAvatar).toHaveBeenCalledWith({ head: ['crown'], sticker: true }),
    );
  });

  it('con sesión muestra el apartado para armar la distribución de la pantalla', async () => {
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

    await screen.findByText('Distribución de la pantalla en las llamadas');
    expect(screen.getByRole('button', { name: 'Agregar zona' })).toBeInTheDocument();
    expect(screen.getByLabelText('Usar mi distribución en las llamadas')).toBeInTheDocument();
  });

  it('el toggle de sonido de mención arranca prendido y persiste al apagarlo', async () => {
    const { isLoggedIn } = await import('@/lib/auth');
    (isLoggedIn as jest.Mock<typeof isLoggedIn>).mockReturnValue(false);
    const SettingsPage = (await import('./page')).default;
    render(<SettingsPage />);
    const toggle = await screen.findByTestId('mention-sound-toggle');
    expect(toggle).toBeChecked();

    fireEvent.click(toggle);

    expect(toggle).not.toBeChecked();
    expect(localStorage.getItem('date2gether:mentionSoundEnabled')).toBe('false');
  });
});

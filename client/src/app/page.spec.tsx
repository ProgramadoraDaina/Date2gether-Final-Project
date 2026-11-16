import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
const push = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  usePathname: () => '/',
}));
jest.mock('@/features/translation/useTranslation', () => {
  const t = (key: string) => key;
  return { useTranslation: () => ({ t }) };
});
jest.mock('@/lib/auth', () => ({
  getCurrentUser: jest.fn<() => Promise<null>>().mockResolvedValue(null),
  isLoggedIn: () => false,
  onAuthChange: () => () => {},
  logout: jest.fn(),
}));
jest.mock('@/lib/api', () => ({ createRoom: jest.fn() }));

describe('HomePage', () => {
  beforeEach(() => {
    localStorage.clear();
    push.mockClear();
  });
  it('reserva la creación de reuniones para cuentas autenticadas', async () => {
    const { createRoom } = await import('@/lib/api');
    const HomePage = (await import('./page')).default;
    render(<HomePage />);
    await screen.findByText('Iniciar sesión');
    expect(screen.getByRole('button', { name: 'Crear reunión' })).toBeDisabled();
    expect(createRoom).not.toHaveBeenCalled();
  });
  it('permite navegar a una sala con nombre y código sin iniciar sesión', async () => {
    const HomePage = (await import('./page')).default;
    render(<HomePage />);
    await screen.findByText('Iniciar sesión');
    fireEvent.change(screen.getByLabelText('Tu nombre'), { target: { value: 'Daina' } });
    fireEvent.change(screen.getByPlaceholderText('abc-defg-hij'), {
      target: { value: 'abc-defg-hij' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Unirse' }));
    expect(push).toHaveBeenCalledWith('/room/abc-defg-hij');
    expect(push).not.toHaveBeenCalledWith('/login');
  });

  it('[5.2] el editor de horarios solo aparece cuando se activa el toggle de sala permanente', async () => {
    const HomePage = (await import('./page')).default;
    render(<HomePage />);
    await screen.findByText('Iniciar sesión');

    expect(screen.queryByText('Horario semanal')).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByLabelText('Sala permanente (enlace fijo, con sala de espera siempre activa)'),
    );
    expect(screen.getByText('Horario semanal')).toBeInTheDocument();
  });

  it('[5.2] crea la sala con isPermanent:true cuando el toggle está activo', async () => {
    const { getCurrentUser } = await import('@/lib/auth');
    (getCurrentUser as jest.Mock<typeof getCurrentUser>).mockResolvedValue({
      id: 'user-1',
      email: 'a@a.com',
      name: 'Daina',
      createdAt: '2026-01-01',
      nameColor: null,
    });
    const { createRoom } = await import('@/lib/api');
    (createRoom as jest.Mock<typeof createRoom>).mockResolvedValue({
      id: 'room-1',
      code: 'abc-defg-hij',
      name: 'Reunión de Daina',
      isActive: true,
      isPermanent: true,
      createdAt: '2026-01-01',
    });

    const HomePage = (await import('./page')).default;
    render(<HomePage />);
    await screen.findByText('Conectado como');
    fireEvent.click(
      screen.getByLabelText('Sala permanente (enlace fijo, con sala de espera siempre activa)'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Crear reunión' }));

    await waitFor(() =>
      expect(createRoom).toHaveBeenCalledWith(
        'Reunión de Daina',
        expect.objectContaining({ isPermanent: true }),
      ),
    );
  });
});

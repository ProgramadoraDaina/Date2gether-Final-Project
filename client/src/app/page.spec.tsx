import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react';
const push = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
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
});

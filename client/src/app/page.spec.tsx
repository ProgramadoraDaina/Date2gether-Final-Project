import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react';

// Mismo motivo que en useCallSession.spec.ts: next/jest no hoistea
// jest.mock() por encima de imports estáticos, así que los mocks y el import
// de './page' se cargan dinámicamente dentro de cada test, después del mock.
const push = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
jest.mock('@/lib/auth', () => ({
  getCurrentUser: jest.fn(),
  logout: jest.fn(),
}));
jest.mock('@/lib/api', () => ({ createRoom: jest.fn() }));

describe('HomePage', () => {
  beforeEach(() => {
    localStorage.clear();
    push.mockClear();
  });

  it('no crea la reunión sin estar logueado: redirige a /login', async () => {
    const { getCurrentUser } = await import('@/lib/auth');
    const { createRoom } = await import('@/lib/api');
    (getCurrentUser as jest.Mock<typeof getCurrentUser>).mockResolvedValue(null);

    const HomePage = (await import('./page')).default;
    render(<HomePage />);

    await screen.findByText('Iniciar sesión');
    fireEvent.change(screen.getByLabelText('Tu nombre'), { target: { value: 'Daina' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear reunión' }));

    expect(push).toHaveBeenCalledWith('/login');
    expect(createRoom).not.toHaveBeenCalled();
  });

  it('no permite unirse a una sala sin estar logueado: redirige a /login', async () => {
    const { getCurrentUser } = await import('@/lib/auth');
    (getCurrentUser as jest.Mock<typeof getCurrentUser>).mockResolvedValue(null);

    const HomePage = (await import('./page')).default;
    render(<HomePage />);

    await screen.findByText('Iniciar sesión');
    fireEvent.change(screen.getByLabelText('Tu nombre'), { target: { value: 'Daina' } });
    fireEvent.change(screen.getByPlaceholderText('abc-defg-hij'), {
      target: { value: 'abc-defg-hij' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Unirse' }));

    expect(push).toHaveBeenCalledWith('/login');
    expect(push).not.toHaveBeenCalledWith('/room/abc-defg-hij');
  });
});

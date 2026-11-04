import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react';

const push = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
jest.mock('@/features/translation/useTranslation', () => {
  const t = (key: string) => key;
  return { useTranslation: () => ({ t }) };
});
jest.mock('@/lib/auth', () => ({ login: jest.fn() }));

const NAME_KEY = 'date2gether:userName';

describe('LoginPage', () => {
  beforeEach(() => {
    localStorage.clear();
    push.mockClear();
  });

  it('un login exitoso guarda el nombre de la persona y navega al inicio', async () => {
    const { login } = await import('@/lib/auth');
    (login as jest.Mock<typeof login>).mockResolvedValue({
      id: 'user-1',
      email: 'a@example.test',
      name: 'Daina',
      createdAt: new Date().toISOString(),
      nameColor: null,
    });
    const LoginPage = (await import('./page')).default;
    render(<LoginPage />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@example.test' } });
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'password123' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    });
    expect(localStorage.getItem(NAME_KEY)).toBe('Daina');
    expect(push).toHaveBeenCalledWith('/');
  });

  it('un login rechazado por el backend muestra el error en pantalla y no navega', async () => {
    const { login } = await import('@/lib/auth');
    (login as jest.Mock<typeof login>).mockRejectedValue(
      new Error('Email o contraseña incorrectos'),
    );
    const LoginPage = (await import('./page')).default;
    render(<LoginPage />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@example.test' } });
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'mala' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    });
    expect(screen.getByText('Email o contraseña incorrectos')).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it('mientras se procesa el login, el botón queda deshabilitado y avisa que está entrando', async () => {
    const { login } = await import('@/lib/auth');
    let resolveLogin!: (user: {
      id: string;
      email: string;
      name: string;
      createdAt: string;
      nameColor: string | null;
    }) => void;
    (login as jest.Mock<typeof login>).mockReturnValue(
      new Promise((done) => {
        resolveLogin = done;
      }),
    );
    const LoginPage = (await import('./page')).default;
    render(<LoginPage />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@example.test' } });
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByRole('button', { name: 'Entrando…' })).toBeDisabled();
    await act(async () => {
      resolveLogin({
        id: 'user-1',
        email: 'a@example.test',
        name: 'Daina',
        createdAt: new Date().toISOString(),
        nameColor: null,
      });
    });
  });
});

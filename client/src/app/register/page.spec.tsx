import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react';

const push = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
jest.mock('@/features/translation/useTranslation', () => {
  const t = (key: string) => key;
  return { useTranslation: () => ({ t }) };
});
jest.mock('@/lib/auth', () => ({ register: jest.fn() }));

const NAME_KEY = 'date2gether:userName';

describe('RegisterPage', () => {
  beforeEach(() => {
    localStorage.clear();
    push.mockClear();
  });

  it('un registro exitoso guarda el nombre de la persona y navega al inicio', async () => {
    const { register } = await import('@/lib/auth');
    (register as jest.Mock<typeof register>).mockResolvedValue({
      id: 'user-1',
      email: 'a@example.test',
      name: 'Daina',
      createdAt: new Date().toISOString(),
      nameColor: null,
    });
    const RegisterPage = (await import('./page')).default;
    render(<RegisterPage />);
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Daina' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@example.test' } });
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'password123' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }));
    });
    expect(register).toHaveBeenCalledWith('a@example.test', 'password123', 'Daina');
    expect(localStorage.getItem(NAME_KEY)).toBe('Daina');
    expect(push).toHaveBeenCalledWith('/');
  });

  it('un registro rechazado por el backend (ej: email repetido) muestra el error en pantalla y no navega', async () => {
    const { register } = await import('@/lib/auth');
    (register as jest.Mock<typeof register>).mockRejectedValue(
      new Error('Ya existe una cuenta con ese email'),
    );
    const RegisterPage = (await import('./page')).default;
    render(<RegisterPage />);
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Daina' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@example.test' } });
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'password123' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }));
    });
    expect(screen.getByText('Ya existe una cuenta con ese email')).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it('mientras se procesa el registro, el botón queda deshabilitado y avisa que se está creando la cuenta', async () => {
    const { register } = await import('@/lib/auth');
    let resolveRegister!: (user: {
      id: string;
      email: string;
      name: string;
      createdAt: string;
      nameColor: string | null;
    }) => void;
    (register as jest.Mock<typeof register>).mockReturnValue(
      new Promise((done) => {
        resolveRegister = done;
      }),
    );
    const RegisterPage = (await import('./page')).default;
    render(<RegisterPage />);
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Daina' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@example.test' } });
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }));
    expect(await screen.findByRole('button', { name: 'Creando cuenta…' })).toBeDisabled();
    await act(async () => {
      resolveRegister({
        id: 'user-1',
        email: 'a@example.test',
        name: 'Daina',
        createdAt: new Date().toISOString(),
        nameColor: null,
      });
    });
  });
});

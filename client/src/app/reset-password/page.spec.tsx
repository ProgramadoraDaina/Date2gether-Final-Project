import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react';

let mockToken: string | null = 'token-del-email';
jest.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: (key: string) => (key === 'token' ? mockToken : null) }),
}));
jest.mock('@/features/translation/useTranslation', () => {
  const t = (key: string) => key;
  return { useTranslation: () => ({ t }) };
});
jest.mock('@/lib/auth', () => ({ resetPassword: jest.fn() }));

async function fill(password: string, confirm: string) {
  fireEvent.change(screen.getByLabelText('Contraseña nueva'), { target: { value: password } });
  fireEvent.change(screen.getByLabelText('Repetí la contraseña'), { target: { value: confirm } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar contraseña' }));
  });
}

describe('ResetPasswordPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockToken = 'token-del-email';
  });

  it('cambia la contraseña con el token del link y ofrece entrar', async () => {
    const { resetPassword } = await import('@/lib/auth');
    (resetPassword as jest.Mock<typeof resetPassword>).mockResolvedValue(
      'Listo, ya podés entrar con tu contraseña nueva.',
    );
    const Page = (await import('./page')).default;
    render(<Page />);

    await fill('NuevaClave123', 'NuevaClave123');

    expect(resetPassword).toHaveBeenCalledWith('token-del-email', 'NuevaClave123');
    expect(screen.getByRole('status')).toHaveTextContent(
      'Listo, ya podés entrar con tu contraseña nueva.',
    );
    expect(screen.getByRole('link', { name: 'Iniciar sesión' })).toHaveAttribute('href', '/login');
  });

  it('si las contraseñas no coinciden no llama al servidor', async () => {
    const { resetPassword } = await import('@/lib/auth');
    const Page = (await import('./page')).default;
    render(<Page />);

    await fill('NuevaClave123', 'OtraClave123');

    expect(resetPassword).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Las contraseñas no coinciden');
  });

  it('muestra el error del servidor cuando el link venció', async () => {
    const { resetPassword } = await import('@/lib/auth');
    (resetPassword as jest.Mock<typeof resetPassword>).mockRejectedValue(
      new Error('El link para cambiar la contraseña venció o ya se usó'),
    );
    const Page = (await import('./page')).default;
    render(<Page />);

    await fill('NuevaClave123', 'NuevaClave123');

    expect(screen.getByRole('alert')).toHaveTextContent(
      'El link para cambiar la contraseña venció o ya se usó',
    );
    expect(screen.getByRole('link', { name: 'Pedir un link nuevo' })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
  });

  it('sin token en la dirección explica cómo pedir uno', async () => {
    mockToken = null;
    const Page = (await import('./page')).default;
    render(<Page />);

    expect(screen.getByRole('alert')).toHaveTextContent('Este link no es válido.');
    expect(screen.queryByLabelText('Contraseña nueva')).not.toBeInTheDocument();
  });
});

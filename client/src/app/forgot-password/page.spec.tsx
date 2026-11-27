import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react';

jest.mock('@/features/translation/useTranslation', () => {
  const t = (key: string) => key;
  return { useTranslation: () => ({ t }) };
});
jest.mock('@/lib/auth', () => ({ requestPasswordReset: jest.fn() }));

describe('ForgotPasswordPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('pide el link con el email y muestra el aviso, sin decir si la cuenta existe', async () => {
    const { requestPasswordReset } = await import('@/lib/auth');
    (requestPasswordReset as jest.Mock<typeof requestPasswordReset>).mockResolvedValue(
      'Si existe una cuenta con ese email, te mandamos un link.',
    );
    const Page = (await import('./page')).default;
    render(<Page />);

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: ' ana@example.test ' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Mandarme el link' }));
    });

    expect(requestPasswordReset).toHaveBeenCalledWith('ana@example.test');
    expect(screen.getByRole('status')).toHaveTextContent(
      'Si existe una cuenta con ese email, te mandamos un link.',
    );
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
  });

  it('si el servidor no puede mandar emails, lo dice y deja reintentar', async () => {
    const { requestPasswordReset } = await import('@/lib/auth');
    (requestPasswordReset as jest.Mock<typeof requestPasswordReset>).mockRejectedValue(
      new Error('El envío de emails no está configurado'),
    );
    const Page = (await import('./page')).default;
    render(<Page />);

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ana@example.test' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Mandarme el link' }));
    });

    expect(screen.getByRole('alert')).toHaveTextContent('El envío de emails no está configurado');
    expect(screen.getByRole('button', { name: 'Mandarme el link' })).toBeEnabled();
  });

  it('tiene un link para volver a iniciar sesión', async () => {
    const Page = (await import('./page')).default;
    render(<Page />);
    expect(screen.getByRole('link', { name: 'Volver a iniciar sesión' })).toHaveAttribute(
      'href',
      '/login',
    );
  });
});

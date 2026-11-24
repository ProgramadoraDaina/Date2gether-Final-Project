import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react';

jest.mock('@/features/translation/useTranslation', () => {
  const t = (key: string) => key;
  return { useTranslation: () => ({ t }) };
});

const mockUsePathname = jest.fn<() => string>();
jest.mock('next/navigation', () => ({ usePathname: () => mockUsePathname() }));

const mockRole = jest.fn<() => string>().mockReturnValue('user');
jest.mock('@/features/auth/useGlobalRole', () => ({ useGlobalRole: () => mockRole() }));

describe('AppNav', () => {
  it('renderiza los 3 links de navegación', async () => {
    mockUsePathname.mockReturnValue('/');
    const { AppNav } = await import('./AppNav');
    render(<AppNav />);
    expect(screen.getByRole('link', { name: /Inicio/ })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: /Historial/ })).toHaveAttribute('href', '/history');
    expect(screen.getByRole('link', { name: /Configuración/ })).toHaveAttribute(
      'href',
      '/settings',
    );
  });

  it('muestra el link de Admin solo a las cuentas admin', async () => {
    mockUsePathname.mockReturnValue('/');
    const { AppNav } = await import('./AppNav');

    mockRole.mockReturnValue('user');
    const { unmount } = render(<AppNav />);
    expect(screen.queryByRole('link', { name: /Admin/ })).not.toBeInTheDocument();
    unmount();

    mockRole.mockReturnValue('admin');
    render(<AppNav />);
    expect(screen.getByRole('link', { name: /Admin/ })).toHaveAttribute('href', '/admin');
  });

  it('marca como activo el link que coincide con la ruta actual', async () => {
    mockUsePathname.mockReturnValue('/history');
    const { AppNav } = await import('./AppNav');
    render(<AppNav />);
    expect(screen.getByRole('link', { name: /Historial/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: /Inicio/ })).not.toHaveAttribute('aria-current');
  });
});

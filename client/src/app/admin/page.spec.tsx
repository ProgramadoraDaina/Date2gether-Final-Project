import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AdminUser } from '@/lib/api';
import type { GlobalAccount, GlobalRoleState } from '@/features/auth/useGlobalRole';

jest.mock('next/navigation', () => ({ usePathname: () => '/admin' }));
jest.mock('@/features/translation/useTranslation', () => {
  const t = (key: string) => key;
  return { useTranslation: () => ({ t, language: 'es' }) };
});
jest.mock('@/features/auth/RequireAuth', () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => children,
}));
const mockRole = jest.fn<() => GlobalRoleState>();
const mockReload = jest.fn<() => void>();
let mockUserId: string | null = 'user-1';
jest.mock('@/features/auth/useGlobalRole', () => ({
  useGlobalRole: () => mockRole(),
  useGlobalAccount: (): GlobalAccount => ({
    role: mockRole(),
    userId: mockUserId,
    reload: mockReload,
  }),
}));
jest.mock('@/lib/api', () => ({
  getAdminUsers: jest.fn(),
  updateAdminUserRole: jest.fn(),
  ApiError: class extends Error {},
}));

function adminUser(overrides: Partial<AdminUser> = {}): AdminUser {
  return {
    id: 'user-1',
    email: 'ana@example.test',
    name: 'Ana',
    role: 'admin',
    createdAt: '2026-11-01T10:00:00.000Z',
    ...overrides,
  };
}

describe('AdminPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUserId = 'user-1';
  });

  it('muestra "sin acceso" y no pide la lista si la cuenta no es admin', async () => {
    mockRole.mockReturnValue('user');
    const { getAdminUsers } = await import('@/lib/api');
    const AdminPage = (await import('./page')).default;

    render(<AdminPage />);

    expect(screen.getByRole('heading', { name: 'Sin acceso' })).toBeInTheDocument();
    expect(getAdminUsers).not.toHaveBeenCalled();
  });

  it('lista los usuarios con su rol para una cuenta admin', async () => {
    mockRole.mockReturnValue('admin');
    const { getAdminUsers } = await import('@/lib/api');
    (getAdminUsers as jest.Mock<typeof getAdminUsers>).mockResolvedValue([
      adminUser(),
      adminUser({ id: 'user-2', email: 'beto@example.test', name: 'Beto', role: 'user' }),
    ]);
    const AdminPage = (await import('./page')).default;

    render(<AdminPage />);

    await screen.findByText('beto@example.test');
    expect(screen.getByLabelText('Rol de Ana')).toHaveValue('admin');
    expect(screen.getByLabelText('Rol de Beto')).toHaveValue('user');
  });

  it('cambia el rol de una cuenta y refleja el valor devuelto por el backend', async () => {
    mockRole.mockReturnValue('admin');
    const { getAdminUsers, updateAdminUserRole } = await import('@/lib/api');
    (getAdminUsers as jest.Mock<typeof getAdminUsers>).mockResolvedValue([
      adminUser({ id: 'user-2', email: 'beto@example.test', name: 'Beto', role: 'user' }),
    ]);
    (updateAdminUserRole as jest.Mock<typeof updateAdminUserRole>).mockResolvedValue(
      adminUser({ id: 'user-2', email: 'beto@example.test', name: 'Beto', role: 'admin' }),
    );
    const AdminPage = (await import('./page')).default;
    render(<AdminPage />);

    fireEvent.change(await screen.findByLabelText('Rol de Beto'), { target: { value: 'admin' } });

    await waitFor(() => expect(screen.getByLabelText('Rol de Beto')).toHaveValue('admin'));
    expect(updateAdminUserRole).toHaveBeenCalledWith('user-2', 'admin');
  });

  it('muestra el error del backend si no se puede cambiar el rol', async () => {
    mockRole.mockReturnValue('admin');
    const { getAdminUsers, updateAdminUserRole, ApiError } = await import('@/lib/api');
    (getAdminUsers as jest.Mock<typeof getAdminUsers>).mockResolvedValue([
      adminUser(),
      adminUser({ id: 'user-2', email: 'beto@example.test', name: 'Beto', role: 'admin' }),
    ]);
    (updateAdminUserRole as jest.Mock<typeof updateAdminUserRole>).mockRejectedValue(
      new ApiError('No se puede quitar el rol al último administrador'),
    );
    const AdminPage = (await import('./page')).default;
    render(<AdminPage />);

    fireEvent.change(await screen.findByLabelText('Rol de Beto'), { target: { value: 'user' } });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No se puede quitar el rol al último administrador',
    );
    expect(screen.getByLabelText('Rol de Beto')).toHaveValue('admin');
  });

  it('usa un mensaje genérico si el cambio de rol falla sin respuesta del backend', async () => {
    mockRole.mockReturnValue('admin');
    const { getAdminUsers, updateAdminUserRole } = await import('@/lib/api');
    (getAdminUsers as jest.Mock<typeof getAdminUsers>).mockResolvedValue([
      adminUser({ id: 'user-2', email: 'beto@example.test', name: 'Beto', role: 'user' }),
    ]);
    (updateAdminUserRole as jest.Mock<typeof updateAdminUserRole>).mockRejectedValue(
      new Error('network'),
    );
    const AdminPage = (await import('./page')).default;
    render(<AdminPage />);

    fireEvent.change(await screen.findByLabelText('Rol de Beto'), { target: { value: 'admin' } });

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cambiar el rol');
  });

  it('muestra un error si no se puede cargar la lista de usuarios', async () => {
    mockRole.mockReturnValue('admin');
    const { getAdminUsers, ApiError } = await import('@/lib/api');
    (getAdminUsers as jest.Mock<typeof getAdminUsers>).mockRejectedValue(
      new ApiError('Servicio no disponible'),
    );
    const AdminPage = (await import('./page')).default;

    render(<AdminPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Servicio no disponible');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('deshabilita el selector de rol de la propia cuenta', async () => {
    mockRole.mockReturnValue('admin');
    const { getAdminUsers } = await import('@/lib/api');
    (getAdminUsers as jest.Mock<typeof getAdminUsers>).mockResolvedValue([
      adminUser(),
      adminUser({ id: 'user-2', email: 'beto@example.test', name: 'Beto', role: 'user' }),
    ]);
    const AdminPage = (await import('./page')).default;
    render(<AdminPage />);

    expect(await screen.findByLabelText('Rol de Ana')).toBeDisabled();
    expect(screen.getByLabelText('Rol de Beto')).toBeEnabled();
  });

  it('muestra un error con "Reintentar" (y no "Sin acceso") si no se pudo cargar el rol', async () => {
    mockRole.mockReturnValue('error');
    const { getAdminUsers } = await import('@/lib/api');
    const AdminPage = (await import('./page')).default;

    render(<AdminPage />);

    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo verificar tu cuenta');
    expect(screen.queryByRole('heading', { name: 'Sin acceso' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(mockReload).toHaveBeenCalledTimes(1);
    expect(getAdminUsers).not.toHaveBeenCalled();
  });
});

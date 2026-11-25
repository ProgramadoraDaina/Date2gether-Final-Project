import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { AuthUser } from '@/lib/auth';

jest.mock('@/lib/auth', () => ({
  isLoggedIn: jest.fn(),
  getCurrentUserOrThrow: jest.fn(),
  onAuthChange: jest.fn(() => () => {}),
}));

function user(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 'user-1',
    email: 'ana@example.test',
    name: 'Ana',
    createdAt: '2026-11-01T10:00:00.000Z',
    nameColor: null,
    ...overrides,
  };
}

async function setup() {
  const auth = await import('@/lib/auth');
  const { useGlobalAccount } = await import('./useGlobalRole');
  (auth.isLoggedIn as jest.Mock<typeof auth.isLoggedIn>).mockReturnValue(true);
  return {
    getCurrentUserOrThrow: auth.getCurrentUserOrThrow as jest.Mock<
      typeof auth.getCurrentUserOrThrow
    >,
    useGlobalAccount,
  };
}

describe('useGlobalAccount', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('expone el rol y el id de la cuenta', async () => {
    const { getCurrentUserOrThrow, useGlobalAccount } = await setup();
    getCurrentUserOrThrow.mockResolvedValue(user({ role: 'admin' }));

    const { result } = renderHook(() => useGlobalAccount());

    await waitFor(() => expect(result.current.role).toBe('admin'));
    expect(result.current.userId).toBe('user-1');
  });

  it('trata como "anonymous" a una sesión que ya no es válida (null)', async () => {
    const { getCurrentUserOrThrow, useGlobalAccount } = await setup();
    getCurrentUserOrThrow.mockResolvedValue(null);

    const { result } = renderHook(() => useGlobalAccount());

    await waitFor(() => expect(result.current.role).toBe('anonymous'));
  });

  it('pasa a "error" (no a "user") si /auth/me falla, y reintenta con reload', async () => {
    const { getCurrentUserOrThrow, useGlobalAccount } = await setup();
    getCurrentUserOrThrow.mockRejectedValueOnce(new Error('boom'));

    const { result } = renderHook(() => useGlobalAccount());
    await waitFor(() => expect(result.current.role).toBe('error'));

    getCurrentUserOrThrow.mockResolvedValueOnce(user({ role: 'admin' }));
    act(() => result.current.reload());

    await waitFor(() => expect(result.current.role).toBe('admin'));
    expect(getCurrentUserOrThrow).toHaveBeenCalledTimes(2);
  });
});

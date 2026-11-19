import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react';

jest.mock('@/lib/auth', () => ({
  isLoggedIn: jest.fn(() => false),
  getCurrentUser: jest.fn(),
}));
jest.mock('@/lib/api', () => ({
  ApiError: class extends Error {},
  joinRoom: jest.fn(),
  getRoomMembers: jest.fn(),
  updateMemberRole: jest.fn(),
}));

describe('useRoomMembers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sin código de sala, no pide nada al backend', async () => {
    const { isLoggedIn, getCurrentUser } = await import('@/lib/auth');
    (isLoggedIn as jest.Mock<typeof isLoggedIn>).mockReturnValue(true);
    const { joinRoom, getRoomMembers } = await import('@/lib/api');
    const { useRoomMembers } = await import('./useRoomMembers');
    renderHook(() => useRoomMembers(undefined));
    expect(getCurrentUser).not.toHaveBeenCalled();
    expect(joinRoom).not.toHaveBeenCalled();
    expect(getRoomMembers).not.toHaveBeenCalled();
  });

  it('sin sesión iniciada, no pide nada al backend aunque haya un código de sala', async () => {
    const { isLoggedIn, getCurrentUser } = await import('@/lib/auth');
    (isLoggedIn as jest.Mock<typeof isLoggedIn>).mockReturnValue(false);
    const { joinRoom } = await import('@/lib/api');
    const { useRoomMembers } = await import('./useRoomMembers');
    renderHook(() => useRoomMembers('abc-defg-hij'));
    expect(getCurrentUser).not.toHaveBeenCalled();
    expect(joinRoom).not.toHaveBeenCalled();
  });

  it('con sesión iniciada: se une a la sala y recién después carga la lista de miembros', async () => {
    const { isLoggedIn, getCurrentUser } = await import('@/lib/auth');
    (isLoggedIn as jest.Mock<typeof isLoggedIn>).mockReturnValue(true);
    (getCurrentUser as jest.Mock<typeof getCurrentUser>).mockResolvedValue({
      id: 'user-1',
    } as never);
    const { joinRoom, getRoomMembers } = await import('@/lib/api');
    (joinRoom as jest.Mock<typeof joinRoom>).mockResolvedValue(undefined);
    const members = [{ userId: 'user-1', name: 'Daina', role: 'administrador' as const }];
    (getRoomMembers as jest.Mock<typeof getRoomMembers>).mockResolvedValue(members);
    const { useRoomMembers } = await import('./useRoomMembers');
    const { result } = renderHook(() => useRoomMembers('abc-defg-hij'));
    await waitFor(() => expect(result.current.members).toEqual(members));
    expect(joinRoom).toHaveBeenCalledWith('abc-defg-hij');
    expect(result.current.isCurrentUserAdmin).toBe(true);
  });

  it('si no se puede unir a la sala, muestra el error y nunca llega a pedir la lista de miembros', async () => {
    const { isLoggedIn, getCurrentUser } = await import('@/lib/auth');
    (isLoggedIn as jest.Mock<typeof isLoggedIn>).mockReturnValue(true);
    (getCurrentUser as jest.Mock<typeof getCurrentUser>).mockResolvedValue({
      id: 'user-1',
    } as never);
    const { joinRoom, getRoomMembers, ApiError } = await import('@/lib/api');
    (joinRoom as jest.Mock<typeof joinRoom>).mockRejectedValue(
      new ApiError('No sos parte de esta sala'),
    );
    const { useRoomMembers } = await import('./useRoomMembers');
    const { result } = renderHook(() => useRoomMembers('abc-defg-hij'));
    await waitFor(() => expect(result.current.error).toBe('No sos parte de esta sala'));
    expect(getRoomMembers).not.toHaveBeenCalled();
  });

  it('cambiar el rol de alguien actualiza la lista de miembros cuando el backend lo acepta', async () => {
    const { isLoggedIn, getCurrentUser } = await import('@/lib/auth');
    (isLoggedIn as jest.Mock<typeof isLoggedIn>).mockReturnValue(true);
    (getCurrentUser as jest.Mock<typeof getCurrentUser>).mockResolvedValue({
      id: 'user-1',
    } as never);
    const { joinRoom, getRoomMembers, updateMemberRole } = await import('@/lib/api');
    (joinRoom as jest.Mock<typeof joinRoom>).mockResolvedValue(undefined);
    (getRoomMembers as jest.Mock<typeof getRoomMembers>)
      .mockResolvedValueOnce([{ userId: 'user-2', name: 'Otro', role: 'participante' as const }])
      .mockResolvedValueOnce([{ userId: 'user-2', name: 'Otro', role: 'colaborador' as const }]);
    (updateMemberRole as jest.Mock<typeof updateMemberRole>).mockResolvedValue(undefined);
    const { useRoomMembers } = await import('./useRoomMembers');
    const { result } = renderHook(() => useRoomMembers('abc-defg-hij'));
    await waitFor(() => expect(result.current.members).toHaveLength(1));
    await act(async () => {
      await result.current.changeRole('user-2', 'colaborador');
    });
    expect(updateMemberRole).toHaveBeenCalledWith('abc-defg-hij', 'user-2', 'colaborador');
    expect(result.current.members[0].role).toBe('colaborador');
  });

  it('cambiar el rol de alguien muestra el error y deja la lista como estaba si el backend lo rechaza', async () => {
    const { isLoggedIn, getCurrentUser } = await import('@/lib/auth');
    (isLoggedIn as jest.Mock<typeof isLoggedIn>).mockReturnValue(true);
    (getCurrentUser as jest.Mock<typeof getCurrentUser>).mockResolvedValue({
      id: 'user-1',
    } as never);
    const { joinRoom, getRoomMembers, updateMemberRole, ApiError } = await import('@/lib/api');
    (joinRoom as jest.Mock<typeof joinRoom>).mockResolvedValue(undefined);
    const original = [{ userId: 'user-2', name: 'Otro', role: 'administrador' as const }];
    (getRoomMembers as jest.Mock<typeof getRoomMembers>).mockResolvedValue(original);
    (updateMemberRole as jest.Mock<typeof updateMemberRole>).mockRejectedValue(
      new ApiError('No se puede cambiar el rol del administrador de la sala'),
    );
    const { useRoomMembers } = await import('./useRoomMembers');
    const { result } = renderHook(() => useRoomMembers('abc-defg-hij'));
    await waitFor(() => expect(result.current.members).toEqual(original));
    await act(async () => {
      await result.current.changeRole('user-2', 'colaborador');
    });
    expect(result.current.error).toBe('No se puede cambiar el rol del administrador de la sala');
    expect(result.current.members).toEqual(original);
  });

  it('si el hook se desmonta antes de terminar de cargar, no sigue uniéndose a la sala ni pidiendo la lista de miembros', async () => {
    const { isLoggedIn, getCurrentUser } = await import('@/lib/auth');
    (isLoggedIn as jest.Mock<typeof isLoggedIn>).mockReturnValue(true);
    let resolveUser!: (user: { id: string }) => void;
    (getCurrentUser as jest.Mock<typeof getCurrentUser>).mockReturnValue(
      new Promise((done) => {
        resolveUser = done as never;
      }),
    );
    const { joinRoom, getRoomMembers } = await import('@/lib/api');
    const { useRoomMembers } = await import('./useRoomMembers');
    const { unmount } = renderHook(() => useRoomMembers('abc-defg-hij'));
    unmount();
    await act(async () => {
      resolveUser({ id: 'user-1' });
    });
    expect(joinRoom).not.toHaveBeenCalled();
    expect(getRoomMembers).not.toHaveBeenCalled();
  });
});

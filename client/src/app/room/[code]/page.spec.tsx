import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
jest.mock('next/navigation', () => ({ useParams: () => ({ code: 'abc-defg-hij' }) }));
jest.mock('@/features/translation/useTranslation', () => {
  const t = (key: string) => key;
  return { useTranslation: () => ({ t }) };
});
jest.mock('@/features/rooms/useRoomMembers', () => {
  const state = {
    members: [],
    isCurrentUserAdmin: false,
    error: null,
    changeRole: jest.fn(),
    refetchMembers: jest.fn(),
  };
  return { useRoomMembers: () => state };
});
jest.mock('@/lib/api', () => ({ requestRoomAccess: jest.fn(), ApiError: class extends Error {} }));
jest.mock('@/lib/socket', () => ({ createRoomSocket: jest.fn() }));
jest.mock('@/features/calls/useCallSession', () => ({
  useCallSession: () => ({
    status: 'idle',
    error: null,
    session: null,
    joinCall: jest.fn(),
    leaveCall: jest.fn(),
  }),
}));

describe('RoomPage: enlace de invitado', () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
  });
  it('solicita el nombre y no conecta automáticamente al abrir el enlace', async () => {
    const { createRoomSocket } = await import('@/lib/socket');
    const Page = (await import('./page')).default;
    render(<Page />);
    expect(screen.getByLabelText('Tu nombre en la reunión')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Entrar a la reunión' })).toBeDisabled();
    expect(createRoomSocket).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Tu nombre en la reunión'), {
      target: { value: '   ' },
    });
    expect(screen.getByRole('button', { name: 'Entrar a la reunión' })).toBeDisabled();
  });
  it('conecta con el pase de sala después de confirmar un nombre sin cuenta', async () => {
    const { requestRoomAccess } = await import('@/lib/api');
    const { createRoomSocket } = await import('@/lib/socket');
    (requestRoomAccess as jest.Mock<typeof requestRoomAccess>).mockResolvedValue({
      token: 'guest-token',
      participant: { sub: 'guest-1', name: 'Alex', roomCode: 'abc-defg-hij' },
    });
    const callbacks: Record<string, (...args: unknown[]) => void> = {};
    const fake = {
      on: jest.fn((event: string, cb: (...args: unknown[]) => void) => {
        callbacks[event] = cb;
      }),
      connect: jest.fn(() => callbacks.connect?.()),
      emit: jest.fn(),
      disconnect: jest.fn(),
      removeAllListeners: jest.fn(),
    };
    (createRoomSocket as jest.Mock<typeof createRoomSocket>).mockReturnValue(fake as never);
    const Page = (await import('./page')).default;
    render(<Page />);
    fireEvent.change(screen.getByLabelText('Tu nombre en la reunión'), {
      target: { value: ' Alex ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar a la reunión' }));
    await waitFor(() => expect(createRoomSocket).toHaveBeenCalledWith('guest-token'));
    expect(requestRoomAccess).toHaveBeenCalledWith('abc-defg-hij', 'Alex');
    expect(fake.emit).toHaveBeenCalledWith('joinRoom', { code: 'abc-defg-hij' });
    expect(screen.getByRole('button', { name: 'Llamar' })).toBeVisible();
  });
});

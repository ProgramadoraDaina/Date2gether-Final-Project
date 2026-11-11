import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

jest.mock('next/navigation', () => ({
  useParams: () => ({ code: 'abc-defg-hij' }),
  usePathname: () => '/room/abc-defg-hij',
}));
jest.mock('@/features/translation/useTranslation', () => {
  const t = (key: string) => key;
  return { useTranslation: () => ({ t }) };
});
jest.mock('@/features/navigation/AppShell', () => ({
  AppShell: ({ children }: { children: import('react').ReactNode }) => <>{children}</>,
}));
jest.mock('@/features/rooms/useRoomMembers', () => {
  const state = {
    members: [],
    currentUserRole: undefined,
    isCurrentUserAdmin: false,
    error: null,
    refetchMembers: jest.fn(),
    changeRole: jest.fn(),
  };
  return { useRoomMembers: () => state };
});
jest.mock('@/features/room-emojis/useRoomEmojis', () => {
  const state = { emojis: [], refetchEmojis: jest.fn() };
  return { useRoomEmojis: () => state };
});
jest.mock('@/features/chat/ExpressionPicker', () => ({ ExpressionPicker: () => null }));
jest.mock('@/lib/api', () => ({ requestRoomAccess: jest.fn(), ApiError: class extends Error {} }));
jest.mock('@/lib/socket', () => ({ createRoomSocket: jest.fn() }));
const mockJoinCall = jest.fn();
jest.mock('@/features/calls/useCallSession', () => ({
  useCallSession: () => ({
    status: 'in-call',
    session: { token: 'call-token' },
    joinCall: mockJoinCall,
  }),
}));
jest.mock('@/features/calls/MeetingRoom', () => ({
  __esModule: true,
  default: jest.fn(() => <div>Connected call</div>),
}));

describe('RoomPage: elección de dispositivos en el lobby', () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
  });
  it('conserva la elección al pasar del lobby a la llamada y libera la captura local', async () => {
    const camera = new EventTarget() as MediaStreamTrack;
    camera.stop = jest.fn();
    camera.getSettings = () => ({ deviceId: 'camera-selected' });
    const stream = {
      getTracks: () => [camera],
      getVideoTracks: () => [camera],
    } as unknown as MediaStream;
    const getUserMedia = jest.fn<() => Promise<MediaStream>>().mockResolvedValue(stream);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    });
    jest.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    const { requestRoomAccess } = await import('@/lib/api');
    jest.mocked(requestRoomAccess).mockResolvedValue({
      token: 'room-token',
      participant: { sub: 'guest', name: 'Ana', roomCode: 'abc-defg-hij' },
    });
    const { createRoomSocket } = await import('@/lib/socket');
    jest.mocked(createRoomSocket).mockReturnValue({
      on: jest.fn(),
      connect: jest.fn(),
      removeAllListeners: jest.fn(),
      disconnect: jest.fn(),
    } as never);
    const Page = (await import('./page')).default;
    render(<Page />);
    fireEvent.change(screen.getByLabelText('Tu nombre en la reunión'), {
      target: { value: 'Ana' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Activar cámara' }));
    await waitFor(() =>
      expect(screen.getByLabelText('Vista previa de tu cámara')).toHaveProperty(
        'srcObject',
        stream,
      ),
    );
    expect(requestRoomAccess).not.toHaveBeenCalled();
    expect(createRoomSocket).not.toHaveBeenCalled();
    expect(mockJoinCall).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Entrar a la reunión' }));
    await screen.findByText('Connected call');
    const MeetingRoom = (await import('@/features/calls/MeetingRoom')).default;
    expect(jest.mocked(MeetingRoom).mock.calls.at(-1)?.[0]).toMatchObject({
      initialDevices: {
        cameraEnabled: true,
        cameraId: 'camera-selected',
        microphoneEnabled: false,
        microphoneId: '',
      },
    });
    expect(camera.stop).toHaveBeenCalled();
    expect(mockJoinCall).toHaveBeenCalledTimes(1);
    expect(mockJoinCall).toHaveBeenCalledWith('abc-defg-hij', 'room-token');
  });
});

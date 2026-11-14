import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AdmissionStatus, RoomAccess } from '@/lib/api';

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
jest.mock('@/lib/api', () => ({
  requestRoomAccess: jest.fn(),
  getAdmissionStatus: jest.fn(),
  cancelAdmissionRequest: jest.fn(),
  getRoomEmojis: jest.fn<() => Promise<never[]>>().mockResolvedValue([]),
  getRoomNotes: jest.fn<() => Promise<unknown>>().mockResolvedValue({
    roomId: 'room-1',
    content: '',
    revision: 0,
    updatedAt: '2026-11-04T00:00:00Z',
  }),
  saveRoomNotes: jest.fn(),
  RoomNotesConflictError: class extends Error {},
  ApiError: class extends Error {},
}));
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
    sessionStorage.clear();
    jest.clearAllMocks();
  });
  it.each([false, true])(
    'conserva los dispositivos y libera la captura local (con espera: %s)',
    async (waiting) => {
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
      const { requestRoomAccess, getAdmissionStatus } = await import('@/lib/api');
      const access: RoomAccess = {
        token: 'room-token',
        participant: { sub: 'guest', name: 'Ana', roomCode: 'abc-defg-hij' },
      };
      const receipt = { status: 'pending' as const, requestId: 'request-1', ticket: 'wait-ticket' };
      let admit!: (result: AdmissionStatus) => void;
      if (waiting) {
        jest.mocked(getAdmissionStatus).mockImplementationOnce(
          () =>
            new Promise<AdmissionStatus>((resolve) => {
              admit = resolve;
            }),
        );
      }
      jest.mocked(requestRoomAccess).mockResolvedValue(waiting ? receipt : access);
      const { createRoomSocket } = await import('@/lib/socket');
      jest.mocked(createRoomSocket).mockReturnValue({
        on: jest.fn(),
        off: jest.fn(),
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
      if (waiting) {
        await screen.findByRole('heading', { name: 'Sala de espera' });
        expect(camera.stop).toHaveBeenCalled();
        expect(screen.queryByText('Connected call')).not.toBeInTheDocument();
        expect(screen.queryByPlaceholderText('Escribí un mensaje...')).not.toBeInTheDocument();
        expect(createRoomSocket).not.toHaveBeenCalled();
        expect(mockJoinCall).not.toHaveBeenCalled();
        expect(getAdmissionStatus).toHaveBeenCalledWith(
          'abc-defg-hij',
          receipt,
          expect.any(AbortSignal),
        );
        await act(async () => {
          admit({ status: 'admitted', access });
        });
      }
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
    },
  );

  it('cancelar la espera vuelve al lobby sin conectar chat ni llamada', async () => {
    const { requestRoomAccess, getAdmissionStatus, cancelAdmissionRequest } =
      await import('@/lib/api');
    const receipt = { status: 'pending' as const, requestId: 'request-1', ticket: 'wait-ticket' };
    jest.mocked(requestRoomAccess).mockResolvedValue(receipt);
    jest.mocked(getAdmissionStatus).mockResolvedValue({ status: 'pending' });
    jest.mocked(cancelAdmissionRequest).mockResolvedValue();
    const { createRoomSocket } = await import('@/lib/socket');
    const Page = (await import('./page')).default;
    render(<Page />);
    fireEvent.change(screen.getByLabelText('Tu nombre en la reunión'), {
      target: { value: 'Ana' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar a la reunión' }));
    await screen.findByRole('heading', { name: 'Sala de espera' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar solicitud' }));
    await screen.findByRole('heading', { name: 'Entrar a la reunión' });
    expect(cancelAdmissionRequest).toHaveBeenCalledWith('abc-defg-hij', receipt);
    expect(sessionStorage.getItem('date2gether:waiting:abc-defg-hij')).toBeNull();
    expect(createRoomSocket).not.toHaveBeenCalled();
    expect(mockJoinCall).not.toHaveBeenCalled();
  });
});

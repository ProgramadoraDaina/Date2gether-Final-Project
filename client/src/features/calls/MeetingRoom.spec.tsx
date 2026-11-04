import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { CallSessionState } from './useCallSession';
import { useLanguageStore } from '../translation/store';

const mockPush = jest.fn();

jest.mock('@livekit/components-react', () => ({
  LiveKitRoom: jest.fn(({ children }: { children: ReactNode }) => <div>{children}</div>),
  GridLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ParticipantTile: () => <div>Video participante</div>,
  RoomAudioRenderer: () => <div>Audio remoto</div>,
  ConnectionStateToast: () => null,
  StartAudio: () => null,
  MediaDeviceMenu: () => null,
  useDisconnectButton: jest.fn(() => ({ buttonProps: { onClick: jest.fn() } })),
  useTrackToggle: jest.fn(),
  useTracks: jest.fn(() => []),
  useDataChannel: jest.fn(() => ({ send: jest.fn(), isSending: false, message: undefined })),
  useLocalParticipant: jest.fn(() => ({ localParticipant: { identity: 'local', name: 'Ana' } })),
  useMaybeTrackRefContext: jest.fn(() => undefined),
}));
jest.mock('livekit-client', () => ({
  DisconnectReason: { CLIENT_INITIATED: 1 },
  Track: { Source: { Camera: 'camera', Microphone: 'microphone' } },
  VideoPresets: { h360: { resolution: { width: 640, height: 360 } }, h90: {}, h180: {} },
}));
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));
function state(): CallSessionState {
  return {
    status: 'connecting',
    error: null,
    session: {
      url: 'wss://media.example.com',
      token: 'signed-token',
      roomName: 'abc',
      participantLimit: 6,
    },
    joinCall: jest.fn<CallSessionState['joinCall']>(),
    leaveCall: jest.fn(),
    connected: jest.fn(),
    failed: jest.fn(),
  };
}
function defaultUseTrackToggle({
  onDeviceError,
}: { onDeviceError?: (error: Error) => void } = {}) {
  return {
    toggle: jest.fn(),
    enabled: true,
    pending: false,
    track: undefined,
    buttonProps: {
      onClick: () => onDeviceError?.(new Error('denied')),
    },
  };
}
describe('MeetingRoom', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    useLanguageStore.setState({ language: 'es' });
    const { useTrackToggle } = await import('@livekit/components-react');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    jest.mocked(useTrackToggle).mockImplementation(defaultUseTrackToggle as any);
  });
  it('conecta con el pase de sala, sin encender cámara ni micrófono automáticamente', async () => {
    const { LiveKitRoom, useTracks } = await import('@livekit/components-react');
    const { Track } = await import('livekit-client');
    const MeetingRoom = (await import('./MeetingRoom')).default;
    const call = state();
    render(<MeetingRoom call={call} />);
    const props = jest.mocked(LiveKitRoom).mock.calls[0][0];
    expect(props).toMatchObject({
      serverUrl: call.session!.url,
      token: call.session!.token,
      audio: false,
      video: false,
    });
    expect(useTracks).toHaveBeenCalledWith(
      [{ source: Track.Source.Camera, withPlaceholder: true }],
      {
        onlySubscribed: false,
      },
    );
    act(() => props.onConnected?.());
    expect(call.connected).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Audio remoto')).toBeInTheDocument();
  });
  it('los botones de micrófono y cámara son íconos accesibles por aria-label/title', async () => {
    const MeetingRoom = (await import('./MeetingRoom')).default;
    const call = state();
    render(<MeetingRoom call={call} />);
    const micButton = screen.getByRole('button', { name: 'Desactivar micrófono' });
    const cameraButton = screen.getByRole('button', { name: 'Desactivar cámara' });
    expect(micButton).toHaveAttribute('title', 'Desactivar micrófono');
    expect(cameraButton).toHaveAttribute('title', 'Desactivar cámara');
  });
  it('cuando el dispositivo está apagado, la etiqueta ofrece activarlo', async () => {
    const { useTrackToggle } = await import('@livekit/components-react');
    const { Track } = await import('livekit-client');
    jest.mocked(useTrackToggle).mockImplementation(
      ({ source }: { source: unknown }) =>
        ({
          toggle: jest.fn(),
          enabled: source !== Track.Source.Microphone,
          pending: false,
          track: undefined,
          buttonProps: {},
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        }) as any,
    );
    const MeetingRoom = (await import('./MeetingRoom')).default;
    const call = state();
    render(<MeetingRoom call={call} />);
    const micButton = screen.getByRole('button', { name: 'Activar micrófono' });
    const cameraButton = screen.getByRole('button', { name: 'Desactivar cámara' });
    expect(micButton).toHaveAttribute('title', 'Activar micrófono');
    expect(cameraButton).toHaveAttribute('title', 'Desactivar cámara');
  });
  it('un permiso rechazado muestra instrucciones y conserva los controles de la llamada', async () => {
    const MeetingRoom = (await import('./MeetingRoom')).default;
    const call = state();
    render(<MeetingRoom call={call} />);
    fireEvent.click(screen.getByRole('button', { name: 'Desactivar cámara' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Revisá los permisos');
    expect(screen.getByRole('button', { name: 'Colgar' })).toBeInTheDocument();
    expect(call.failed).not.toHaveBeenCalled();
  });
  it('distingue salida voluntaria y desconexión por error', async () => {
    const { LiveKitRoom } = await import('@livekit/components-react');
    const MeetingRoom = (await import('./MeetingRoom')).default;
    const call = state();
    render(<MeetingRoom call={call} />);
    const props = jest.mocked(LiveKitRoom).mock.calls[0][0];
    act(() => props.onDisconnected?.(1));
    expect(call.leaveCall).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith('/');
    act(() => props.onError?.(new Error('network')));
    expect(call.failed).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledTimes(1);
  });
});

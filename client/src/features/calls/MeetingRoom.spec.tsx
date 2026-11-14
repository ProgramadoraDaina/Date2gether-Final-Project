import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { CallSessionState } from './useCallSession';
import { useLanguageStore } from '../translation/store';

const mockPush = jest.fn();
const mockEvents: Record<string, () => void> = {};
const mockRoom = {
  state: 'disconnected',
  on: jest.fn(),
  off: jest.fn(),
  localParticipant: {
    setMicrophoneEnabled: jest.fn<(enabled: boolean) => Promise<void>>(),
    setCameraEnabled: jest.fn<(enabled: boolean) => Promise<void>>(),
  },
};

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
  useRoomContext: () => mockRoom,
  useDataChannel: jest.fn(() => ({ send: jest.fn(), isSending: false, message: undefined })),
  useLocalParticipant: jest.fn(() => ({ localParticipant: { identity: 'local', name: 'Ana' } })),
  useMaybeTrackRefContext: jest.fn(() => undefined),
}));
jest.mock('livekit-client', () => ({
  DefaultReconnectPolicy: jest.fn(),
  ConnectionState: { Connected: 'connected' },
  RoomEvent: { Connected: 'connected' },
  // Valores reales verificados en @livekit/protocol (design.md D5):
  // ROOM_DELETED = 5 ("RoomService.DeleteRoom was called"), ROOM_CLOSED = 10.
  DisconnectReason: { CLIENT_INITIATED: 1, ROOM_DELETED: 5, ROOM_CLOSED: 10 },
  Track: {
    Source: { Camera: 'camera', Microphone: 'microphone', ScreenShare: 'screen_share' },
  },
  VideoPresets: { h360: { resolution: { width: 640, height: 360 } }, h90: {}, h180: {} },
}));
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));
jest.mock('@/lib/calls', () => ({ reportTrackState: jest.fn() }));
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
    endReason: null,
    joinCall: jest.fn<CallSessionState['joinCall']>(),
    leaveCall: jest.fn(),
    connected: jest.fn(),
    failed: jest.fn(),
    endedByHost: jest.fn(),
  };
}
function defaultUseTrackToggle({ onDeviceError }: { onDeviceError?: (error: Error) => void } = {}) {
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
    mockRoom.state = 'disconnected';
    mockRoom.on.mockImplementation((event, callback) => {
      mockEvents[event as string] = callback as () => void;
    });
    mockRoom.localParticipant.setMicrophoneEnabled.mockResolvedValue();
    mockRoom.localParticipant.setCameraEnabled.mockResolvedValue();
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
    render(<MeetingRoom call={call} roomCode="abc-defg-hij" roomToken="test-room-token" roomEmojis={[]} />);
    const props = jest.mocked(LiveKitRoom).mock.calls[0][0];
    expect(props).toMatchObject({
      serverUrl: call.session!.url,
      token: call.session!.token,
      audio: false,
      video: false,
    });
    expect(useTracks).toHaveBeenCalledWith(
      [
        { source: Track.Source.Camera, withPlaceholder: true },
        { source: Track.Source.ScreenShare, withPlaceholder: false },
      ],
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
    render(<MeetingRoom call={call} roomCode="abc-defg-hij" roomToken="test-room-token" roomEmojis={[]} />);
    const micButton = screen.getByRole('button', { name: 'Desactivar micrófono' });
    const cameraButton = screen.getByRole('button', { name: 'Desactivar cámara' });
    expect(micButton).toHaveAttribute('title', 'Desactivar micrófono');
    expect(cameraButton).toHaveAttribute('title', 'Desactivar cámara');
  });
  it('la referencia de onChange que recibe useTrackToggle es estable entre renders (si no, reengancha el useEffect interno de la librería en cada render y reporta mute/unmute repetido sin que nadie haya tocado nada)', async () => {
    const { useTrackToggle } = await import('@livekit/components-react');
    const { Track } = await import('livekit-client');
    const MeetingRoom = (await import('./MeetingRoom')).default;
    const call = state();
    const { rerender } = render(
      <MeetingRoom call={call} roomCode="abc-defg-hij" roomToken="test-room-token" roomEmojis={[]} />,
    );
    const firstMicOnChange = jest
      .mocked(useTrackToggle)
      .mock.calls.find((args) => args[0].source === Track.Source.Microphone)?.[0].onChange;

    // Forzar un segundo render con las mismas props (algo que pasa todo el
    // tiempo en una llamada real: estado de conexión, nivel de audio, etc.).
    rerender(
      <MeetingRoom call={{ ...call }} roomCode="abc-defg-hij" roomToken="test-room-token" roomEmojis={[]} />,
    );
    const secondMicOnChange = jest
      .mocked(useTrackToggle)
      .mock.calls.findLast((args) => args[0].source === Track.Source.Microphone)?.[0].onChange;

    expect(secondMicOnChange).toBe(firstMicOnChange);
  });
  it('mutear/desmutear el micrófono o la cámara le avisa al backend propio (no a LiveKit, que no manda webhook de eso)', async () => {
    const { useTrackToggle } = await import('@livekit/components-react');
    const { reportTrackState } = await import('@/lib/calls');
    const { Track } = await import('livekit-client');
    const MeetingRoom = (await import('./MeetingRoom')).default;
    const call = state();
    render(<MeetingRoom call={call} roomCode="abc-defg-hij" roomToken="test-room-token" roomEmojis={[]} />);

    const micCall = jest
      .mocked(useTrackToggle)
      .mock.calls.find((args) => args[0].source === Track.Source.Microphone);
    const cameraCall = jest
      .mocked(useTrackToggle)
      .mock.calls.find((args) => args[0].source === Track.Source.Camera);

    act(() => micCall?.[0].onChange?.(false, true));
    expect(reportTrackState).toHaveBeenCalledWith(
      'abc-defg-hij',
      'test-room-token',
      'microphone',
      false,
    );

    act(() => cameraCall?.[0].onChange?.(true, true));
    expect(reportTrackState).toHaveBeenCalledWith(
      'abc-defg-hij',
      'test-room-token',
      'camera',
      true,
    );
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
    render(<MeetingRoom call={call} roomCode="abc-defg-hij" roomToken="test-room-token" roomEmojis={[]} />);
    const micButton = screen.getByRole('button', { name: 'Activar micrófono' });
    const cameraButton = screen.getByRole('button', { name: 'Desactivar cámara' });
    expect(micButton).toHaveAttribute('title', 'Activar micrófono');
    expect(cameraButton).toHaveAttribute('title', 'Desactivar cámara');
  });
  it('un permiso rechazado muestra instrucciones y conserva los controles de la llamada', async () => {
    const MeetingRoom = (await import('./MeetingRoom')).default;
    const call = state();
    render(<MeetingRoom call={call} roomCode="abc-defg-hij" roomToken="test-room-token" roomEmojis={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Desactivar cámara' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Revisá los permisos');
    expect(screen.getByRole('button', { name: 'Colgar' })).toBeInTheDocument();
    expect(call.failed).not.toHaveBeenCalled();
  });
  it('el botón de compartir pantalla es un ícono accesible y pide audio del sistema al activarse', async () => {
    const { useTrackToggle } = await import('@livekit/components-react');
    const { Track } = await import('livekit-client');
    const MeetingRoom = (await import('./MeetingRoom')).default;
    const call = state();
    render(<MeetingRoom call={call} roomCode="abc-defg-hij" roomToken="test-room-token" roomEmojis={[]} />);
    const screenShareButton = screen.getByRole('button', { name: 'Dejar de compartir pantalla' });
    expect(screenShareButton).toHaveAttribute('title', 'Dejar de compartir pantalla');
    expect(jest.mocked(useTrackToggle)).toHaveBeenCalledWith(
      expect.objectContaining({
        source: Track.Source.ScreenShare,
        captureOptions: { audio: true },
      }),
    );
  });
  it('cuando LiveKit avisa que la conexión se cerró: si fue porque el usuario se fue, llama a leaveCall; si fue por un error de red, llama a failed', async () => {
    const { LiveKitRoom } = await import('@livekit/components-react');
    const MeetingRoom = (await import('./MeetingRoom')).default;
    const call = state();
    render(<MeetingRoom call={call} roomCode="abc-defg-hij" roomToken="test-room-token" roomEmojis={[]} />);
    const props = jest.mocked(LiveKitRoom).mock.calls[0][0];
    act(() => props.onDisconnected?.(1));
    expect(call.leaveCall).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith('/');
    act(() => props.onError?.(new Error('network')));
    expect(call.failed).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledTimes(1);
  });
  it('aplica los dispositivos elegidos solo en la primera conexión, sin reactivarlos al reconectar', async () => {
    const { LiveKitRoom } = await import('@livekit/components-react');
    const MeetingRoom = (await import('./MeetingRoom')).default;
    render(
      <MeetingRoom
        call={state()}
        roomCode="abc"
        roomToken="test-room-token"
        roomEmojis={[]}
        initialDevices={{
          cameraEnabled: true,
          microphoneEnabled: true,
          cameraId: 'usb-camera',
          microphoneId: 'usb-mic',
        }}
      />,
    );
    const props = jest.mocked(LiveKitRoom).mock.calls[0][0];
    expect(props.options).toMatchObject({
      audioCaptureDefaults: { deviceId: 'usb-mic' },
      videoCaptureDefaults: { deviceId: 'usb-camera' },
    });
    expect(mockRoom.localParticipant.setCameraEnabled).not.toHaveBeenCalled();
    await act(async () => {
      mockEvents.connected();
    });
    expect(mockRoom.localParticipant.setCameraEnabled).toHaveBeenCalledTimes(1);
    expect(mockRoom.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(true);
    await act(async () => {
      mockEvents.connected();
    });
    expect(mockRoom.localParticipant.setCameraEnabled).toHaveBeenCalledTimes(1);
  });
  it('si se revoca el permiso de cámara después del lobby, conserva la llamada y publica el micrófono', async () => {
    mockRoom.state = 'connected';
    mockRoom.localParticipant.setCameraEnabled.mockRejectedValueOnce(
      new Error('permission revoked'),
    );
    const MeetingRoom = (await import('./MeetingRoom')).default;
    const call = state();
    render(
      <MeetingRoom
        call={call}
        roomCode="abc"
        roomToken="test-room-token"
        roomEmojis={[]}
        initialDevices={{
          cameraEnabled: true,
          microphoneEnabled: true,
          cameraId: '',
          microphoneId: '',
        }}
      />,
    );
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Revisá los permisos'));
    expect(mockRoom.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(true);
    expect(call.failed).not.toHaveBeenCalled();
    expect(screen.getByText('Audio remoto')).toBeVisible();
  });
  it('cuando LiveKit cierra la sesión porque el anfitrión se desconectó (ROOM_DELETED), llama a endedByHost, no a failed (D5, design.md)', async () => {
    const { LiveKitRoom } = await import('@livekit/components-react');
    const { DisconnectReason } = await import('livekit-client');
    const MeetingRoom = (await import('./MeetingRoom')).default;
    const call = state();
    render(<MeetingRoom call={call} roomCode="abc-defg-hij" roomToken="test-room-token" roomEmojis={[]} />);
    const props = jest.mocked(LiveKitRoom).mock.calls[0][0];
    act(() => props.onDisconnected?.(DisconnectReason.ROOM_DELETED));
    expect(call.endedByHost).toHaveBeenCalledTimes(1);
    expect(call.failed).not.toHaveBeenCalled();
    expect(call.leaveCall).not.toHaveBeenCalled();
  });
  it('cuando LiveKit cierra la sesión por su cuenta (ROOM_CLOSED), también llama a endedByHost', async () => {
    const { LiveKitRoom } = await import('@livekit/components-react');
    const { DisconnectReason } = await import('livekit-client');
    const MeetingRoom = (await import('./MeetingRoom')).default;
    const call = state();
    render(<MeetingRoom call={call} roomCode="abc-defg-hij" roomToken="test-room-token" roomEmojis={[]} />);
    const props = jest.mocked(LiveKitRoom).mock.calls[0][0];
    act(() => props.onDisconnected?.(DisconnectReason.ROOM_CLOSED));
    expect(call.endedByHost).toHaveBeenCalledTimes(1);
    expect(call.failed).not.toHaveBeenCalled();
  });
});

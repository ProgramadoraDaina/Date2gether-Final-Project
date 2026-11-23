import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useRef, type ReactNode } from 'react';
import type { Socket } from 'socket.io-client';
import type { CallSessionState } from './useCallSession';
import { useLanguageStore } from '../translation/store';

const mockPush = jest.fn();
const mockEvents: Record<string, () => void> = {};
const mockRoom = {
  state: 'disconnected',
  getSid: () => Promise.resolve('RM_test'),
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
  useMaybeLayoutContext: jest.fn(() => undefined),
  // [] (sin nada pineado) para que el branch por defecto siga siendo
  // GridLayout en estos tests, igual que antes de la vista de foco.
  useCreateLayoutContext: jest.fn(() => ({ pin: { dispatch: jest.fn() }, widget: {} })),
  usePinnedTracks: jest.fn(() => []),
  LayoutContextProvider: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  FocusLayoutContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CarouselLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TrackRefContext: { Provider: ({ children }: { children: ReactNode }) => <div>{children}</div> },
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
jest.mock('@/lib/breakouts', () => ({
  createBreakoutRoom: jest.fn(),
  listBreakoutRooms: jest.fn(),
  updateBreakoutRoomPolicy: jest.fn(),
  moveToBreakoutRoom: jest.fn(),
  issueBreakoutToken: jest.fn(),
  closeBreakoutRoom: jest.fn(),
  closeAllBreakoutRooms: jest.fn(),
  returnFromBreakoutRoom: jest.fn(),
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
    endReason: null,
    joinCall: jest.fn<CallSessionState['joinCall']>(),
    leaveCall: jest.fn(),
    connected: jest.fn(),
    failed: jest.fn(),
    endedByHost: jest.fn(),
    switchRoom: jest.fn(),
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
// Mismo helper que useRoomSocket.spec.ts: un fake de socket.io-client que
// guarda los callbacks registrados por evento para poder dispararlos a mano.
function createFakeSocket() {
  const callbacks: Record<string, (...args: unknown[]) => void> = {};
  return {
    on: jest.fn((event: string, cb: (...args: unknown[]) => void) => {
      callbacks[event] = cb;
    }),
    off: jest.fn(),
    emit: jest.fn(),
    callbacks,
  };
}
describe('MeetingRoom', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockRoom.state = 'disconnected';
    // Como un EventEmitter real: varios componentes pueden escuchar el mismo evento.
    for (const key of Object.keys(mockEvents)) delete mockEvents[key];
    mockRoom.on.mockImplementation((event, callback) => {
      const previous = mockEvents[event as string];
      mockEvents[event as string] = () => {
        previous?.();
        (callback as () => void)();
      };
    });
    mockRoom.localParticipant.setMicrophoneEnabled.mockResolvedValue();
    mockRoom.localParticipant.setCameraEnabled.mockResolvedValue();
    useLanguageStore.setState({ language: 'es' });
    const { useTrackToggle } = await import('@livekit/components-react');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    jest.mocked(useTrackToggle).mockImplementation(defaultUseTrackToggle as any);
    const { listBreakoutRooms, issueBreakoutToken } = await import('@/lib/breakouts');
    (listBreakoutRooms as jest.Mock<typeof listBreakoutRooms>).mockResolvedValue([]);
    // Default para los tests que no son sobre el traslado real de medios
    // (Fase 6.13): cualquier breakout:assigned que emitan ahora también
    // dispara el pedido de token (ver MeetingRoom.tsx), así que necesita una
    // resolución válida para no tirar un TypeError sobre una promesa undefined.
    (issueBreakoutToken as jest.Mock<typeof issueBreakoutToken>).mockResolvedValue({
      url: 'wss://media.example.com',
      token: 'breakout-token',
      roomName: 'abc-defg-hij::breakout-1',
      participantLimit: 6,
    });
  });
  it('al tocar micrófono o cámara en la llamada recuerda la elección para la próxima vez', async () => {
    const { useCallSettingsStore } = await import('./settings/store');
    useCallSettingsStore.setState({ cameraEnabled: true, microphoneEnabled: true });
    const MeetingRoom = (await import('./MeetingRoom')).default;
    render(
      <MeetingRoom
        call={state()}
        roomCode="abc"
        roomToken="test-room-token"
        roomEmojis={[]}
        isCurrentUserAdmin={false}
        audioLocked={false}
        videoLocked={false}
        onSetAudioLock={jest.fn()}
        onSetVideoLock={jest.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Desactivar micrófono' }));
    expect(useCallSettingsStore.getState()).toMatchObject({
      microphoneEnabled: false,
      cameraEnabled: true,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Desactivar cámara' }));
    expect(useCallSettingsStore.getState().cameraEnabled).toBe(false);
  });

  it('conecta con el pase de sala, sin encender cámara ni micrófono automáticamente', async () => {
    const { LiveKitRoom, useTracks } = await import('@livekit/components-react');
    const { Track } = await import('livekit-client');
    const MeetingRoom = (await import('./MeetingRoom')).default;
    const call = state();
    render(
      <MeetingRoom
        call={call}
        roomCode="abc-defg-hij"
        roomToken="test-room-token"
        roomEmojis={[]}
        isCurrentUserAdmin={false}
        audioLocked={false}
        videoLocked={false}
        onSetAudioLock={jest.fn()}
        onSetVideoLock={jest.fn()}
      />,
    );
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
    render(
      <MeetingRoom
        call={call}
        roomCode="abc-defg-hij"
        roomToken="test-room-token"
        roomEmojis={[]}
        isCurrentUserAdmin={false}
        audioLocked={false}
        videoLocked={false}
        onSetAudioLock={jest.fn()}
        onSetVideoLock={jest.fn()}
      />,
    );
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
      <MeetingRoom
        call={call}
        roomCode="abc-defg-hij"
        roomToken="test-room-token"
        roomEmojis={[]}
        isCurrentUserAdmin={false}
        audioLocked={false}
        videoLocked={false}
        onSetAudioLock={jest.fn()}
        onSetVideoLock={jest.fn()}
      />,
    );
    const firstMicOnChange = jest
      .mocked(useTrackToggle)
      .mock.calls.find((args) => args[0].source === Track.Source.Microphone)?.[0].onChange;

    // Forzar un segundo render con las mismas props (algo que pasa todo el
    // tiempo en una llamada real: estado de conexión, nivel de audio, etc.).
    rerender(
      <MeetingRoom
        call={{ ...call }}
        roomCode="abc-defg-hij"
        roomToken="test-room-token"
        roomEmojis={[]}
        isCurrentUserAdmin={false}
        audioLocked={false}
        videoLocked={false}
        onSetAudioLock={jest.fn()}
        onSetVideoLock={jest.fn()}
      />,
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
    render(
      <MeetingRoom
        call={call}
        roomCode="abc-defg-hij"
        roomToken="test-room-token"
        roomEmojis={[]}
        isCurrentUserAdmin={false}
        audioLocked={false}
        videoLocked={false}
        onSetAudioLock={jest.fn()}
        onSetVideoLock={jest.fn()}
      />,
    );

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
    render(
      <MeetingRoom
        call={call}
        roomCode="abc-defg-hij"
        roomToken="test-room-token"
        roomEmojis={[]}
        isCurrentUserAdmin={false}
        audioLocked={false}
        videoLocked={false}
        onSetAudioLock={jest.fn()}
        onSetVideoLock={jest.fn()}
      />,
    );
    const micButton = screen.getByRole('button', { name: 'Activar micrófono' });
    const cameraButton = screen.getByRole('button', { name: 'Desactivar cámara' });
    expect(micButton).toHaveAttribute('title', 'Activar micrófono');
    expect(cameraButton).toHaveAttribute('title', 'Desactivar cámara');
  });
  it('un permiso rechazado muestra instrucciones y conserva los controles de la llamada', async () => {
    const MeetingRoom = (await import('./MeetingRoom')).default;
    const call = state();
    render(
      <MeetingRoom
        call={call}
        roomCode="abc-defg-hij"
        roomToken="test-room-token"
        roomEmojis={[]}
        isCurrentUserAdmin={false}
        audioLocked={false}
        videoLocked={false}
        onSetAudioLock={jest.fn()}
        onSetVideoLock={jest.fn()}
      />,
    );
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
    render(
      <MeetingRoom
        call={call}
        roomCode="abc-defg-hij"
        roomToken="test-room-token"
        roomEmojis={[]}
        isCurrentUserAdmin={false}
        audioLocked={false}
        videoLocked={false}
        onSetAudioLock={jest.fn()}
        onSetVideoLock={jest.fn()}
      />,
    );
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
    render(
      <MeetingRoom
        call={call}
        roomCode="abc-defg-hij"
        roomToken="test-room-token"
        roomEmojis={[]}
        isCurrentUserAdmin={false}
        audioLocked={false}
        videoLocked={false}
        onSetAudioLock={jest.fn()}
        onSetVideoLock={jest.fn()}
      />,
    );
    const props = jest.mocked(LiveKitRoom).mock.calls[0][0];
    act(() => props.onDisconnected?.(1));
    expect(call.leaveCall).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith('/');
    act(() => props.onError?.(new Error('network')));
    expect(call.failed).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledTimes(1);
  });
  it('si la sala pasa onHangUp, al colgar lo llama en vez de volver al inicio', async () => {
    const { LiveKitRoom } = await import('@livekit/components-react');
    const MeetingRoom = (await import('./MeetingRoom')).default;
    const call = state();
    const onHangUp = jest.fn();
    render(
      <MeetingRoom
        call={call}
        roomCode="abc-defg-hij"
        roomToken="test-room-token"
        roomEmojis={[]}
        isCurrentUserAdmin={false}
        audioLocked={false}
        videoLocked={false}
        onSetAudioLock={jest.fn()}
        onSetVideoLock={jest.fn()}
        onHangUp={onHangUp}
      />,
    );
    const props = jest.mocked(LiveKitRoom).mock.calls[0][0];
    act(() => props.onDisconnected?.(1));
    expect(call.leaveCall).toHaveBeenCalledTimes(1);
    expect(onHangUp).toHaveBeenCalledTimes(1);
    expect(mockPush).not.toHaveBeenCalled();
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
        isCurrentUserAdmin={false}
        audioLocked={false}
        videoLocked={false}
        onSetAudioLock={jest.fn()}
        onSetVideoLock={jest.fn()}
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
        isCurrentUserAdmin={false}
        audioLocked={false}
        videoLocked={false}
        onSetAudioLock={jest.fn()}
        onSetVideoLock={jest.fn()}
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
    render(
      <MeetingRoom
        call={call}
        roomCode="abc-defg-hij"
        roomToken="test-room-token"
        roomEmojis={[]}
        isCurrentUserAdmin={false}
        audioLocked={false}
        videoLocked={false}
        onSetAudioLock={jest.fn()}
        onSetVideoLock={jest.fn()}
      />,
    );
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
    render(
      <MeetingRoom
        call={call}
        roomCode="abc-defg-hij"
        roomToken="test-room-token"
        roomEmojis={[]}
        isCurrentUserAdmin={false}
        audioLocked={false}
        videoLocked={false}
        onSetAudioLock={jest.fn()}
        onSetVideoLock={jest.fn()}
      />,
    );
    const props = jest.mocked(LiveKitRoom).mock.calls[0][0];
    act(() => props.onDisconnected?.(DisconnectReason.ROOM_CLOSED));
    expect(call.endedByHost).toHaveBeenCalledTimes(1);
    expect(call.failed).not.toHaveBeenCalled();
  });

  it('ignora onDisconnected mientras la llamada está en medio de un traslado de sala (status "switching", breakout-rooms)', async () => {
    const { LiveKitRoom } = await import('@livekit/components-react');
    const MeetingRoom = (await import('./MeetingRoom')).default;
    const call = { ...state(), status: 'switching' as const };
    render(
      <MeetingRoom
        call={call}
        roomCode="abc-defg-hij"
        roomToken="test-room-token"
        roomEmojis={[]}
        isCurrentUserAdmin={false}
        audioLocked={false}
        videoLocked={false}
        onSetAudioLock={jest.fn()}
        onSetVideoLock={jest.fn()}
      />,
    );
    const props = jest.mocked(LiveKitRoom).mock.calls[0][0];
    act(() => props.onDisconnected?.(1));
    act(() => props.onDisconnected?.(undefined));
    expect(call.leaveCall).not.toHaveBeenCalled();
    expect(call.failed).not.toHaveBeenCalled();
    expect(call.endedByHost).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('cambia la key de LiveKitRoom con roomName para forzar un remount completo en un traslado a mini sala', async () => {
    const { LiveKitRoom } = await import('@livekit/components-react');
    const original = jest.mocked(LiveKitRoom).getMockImplementation();
    jest.mocked(LiveKitRoom).mockImplementation(({ children }: { children?: ReactNode }) => {
      const idRef = useRef(Math.random());
      return (
        <div data-testid="mount-id" data-mount-id={idRef.current}>
          {children}
        </div>
      );
    });
    try {
      const MeetingRoom = (await import('./MeetingRoom')).default;
      const mainCall = {
        ...state(),
        session: {
          url: 'wss://media.example.com',
          token: 'main-token',
          roomName: 'abc-defg-hij',
          participantLimit: 6,
        },
      };
      const { rerender } = render(
        <MeetingRoom
          call={mainCall}
          roomCode="abc-defg-hij"
          roomToken="test-room-token"
          roomEmojis={[]}
          isCurrentUserAdmin={false}
          audioLocked={false}
          videoLocked={false}
          onSetAudioLock={jest.fn()}
          onSetVideoLock={jest.fn()}
        />,
      );
      const firstMountId = screen.getByTestId('mount-id').getAttribute('data-mount-id');

      const breakoutCall = {
        ...mainCall,
        status: 'switching' as const,
        session: {
          url: 'wss://media.example.com',
          token: 'breakout-token',
          roomName: 'abc-defg-hij::breakout-1',
          participantLimit: 6,
        },
      };
      rerender(
        <MeetingRoom
          call={breakoutCall}
          roomCode="abc-defg-hij"
          roomToken="test-room-token"
          roomEmojis={[]}
          isCurrentUserAdmin={false}
          audioLocked={false}
          videoLocked={false}
          onSetAudioLock={jest.fn()}
          onSetVideoLock={jest.fn()}
        />,
      );
      const secondMountId = screen.getByTestId('mount-id').getAttribute('data-mount-id');

      expect(secondMountId).not.toBe(firstMountId);

      // Un segundo render con el MISMO roomName no debe forzar otro remount.
      rerender(
        <MeetingRoom
          call={{ ...breakoutCall }}
          roomCode="abc-defg-hij"
          roomToken="test-room-token"
          roomEmojis={[]}
          isCurrentUserAdmin={false}
          audioLocked={false}
          videoLocked={false}
          onSetAudioLock={jest.fn()}
          onSetVideoLock={jest.fn()}
        />,
      );
      const thirdMountId = screen.getByTestId('mount-id').getAttribute('data-mount-id');
      expect(thirdMountId).toBe(secondMountId);
    } finally {
      jest.mocked(LiveKitRoom).mockImplementation(
        original ?? (({ children }: { children?: ReactNode }) => <div>{children}</div>),
      );
    }
  });

  describe('mini salas (breakout-rooms, Fase 6.12 — montaje en la UI real)', () => {
    it('el botón de "Mini salas" solo aparece para el admin, mismo gate que mute-all/cámara-off', async () => {
      const MeetingRoom = (await import('./MeetingRoom')).default;
      render(
        <MeetingRoom
          call={state()}
          roomCode="abc-defg-hij"
          roomToken="test-room-token"
          roomEmojis={[]}
          isCurrentUserAdmin={false}
          audioLocked={false}
          videoLocked={false}
          onSetAudioLock={jest.fn()}
          onSetVideoLock={jest.fn()}
          participants={[]}
        />,
      );
      expect(screen.queryByRole('button', { name: 'Mini salas' })).toBeNull();
    });

    it('para el admin, clickear "Mini salas" abre el panel alimentado con los participantes recibidos', async () => {
      const { moveToBreakoutRoom, listBreakoutRooms } = await import('@/lib/breakouts');
      (listBreakoutRooms as jest.Mock<typeof listBreakoutRooms>).mockResolvedValue([
        {
          id: 'breakout-1',
          livekitRoomName: 'abc-defg-hij::breakout-1',
          label: 'Mini sala 1',
          leavePolicy: 'locked',
          autoCloseAt: null,
          occupants: [],
        },
      ]);
      const MeetingRoom = (await import('./MeetingRoom')).default;
      render(
        <MeetingRoom
          call={state()}
          roomCode="abc-defg-hij"
          roomToken="test-room-token"
          roomEmojis={[]}
          isCurrentUserAdmin
          audioLocked={false}
          videoLocked={false}
          onSetAudioLock={jest.fn()}
          onSetVideoLock={jest.fn()}
          participants={[{ livekitIdentity: 'guest-sub', displayName: 'Invitado' }]}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: 'Mini salas' }));

      expect(listBreakoutRooms).toHaveBeenCalledWith('abc-defg-hij', 'test-room-token');
      await waitFor(() =>
        expect(screen.getByRole('option', { name: 'Invitado' })).toBeInTheDocument(),
      );
      expect(moveToBreakoutRoom).not.toHaveBeenCalled();
    });

    it('breakout:assigned muestra el banner; breakout:closed de esa mini sala lo oculta', async () => {
      const MeetingRoom = (await import('./MeetingRoom')).default;
      const socket = createFakeSocket();
      render(
        <MeetingRoom
          call={state()}
          roomCode="abc-defg-hij"
          roomToken="test-room-token"
          roomEmojis={[]}
          isCurrentUserAdmin={false}
          audioLocked={false}
          videoLocked={false}
          onSetAudioLock={jest.fn()}
          onSetVideoLock={jest.fn()}
          participants={[]}
          roomSocket={socket as unknown as Socket}
        />,
      );
      expect(screen.queryByText('Mini sala 1')).toBeNull();

      act(() =>
        socket.callbacks['breakout:assigned']({
          breakoutId: 'breakout-1',
          label: 'Mini sala 1',
          leavePolicy: 'locked',
        }),
      );
      expect(screen.getByText('Mini sala 1')).toBeInTheDocument();

      act(() => socket.callbacks['breakout:closed']({ breakoutId: 'breakout-1' }));
      expect(screen.queryByText('Mini sala 1')).toBeNull();
    });

    it('clickear "Volver" en el banner (free_return) llama returnFromBreakoutRoom y oculta el banner sin esperar otra señal', async () => {
      const { returnFromBreakoutRoom } = await import('@/lib/breakouts');
      (returnFromBreakoutRoom as jest.Mock<typeof returnFromBreakoutRoom>).mockResolvedValue(
        undefined,
      );
      const MeetingRoom = (await import('./MeetingRoom')).default;
      const socket = createFakeSocket();
      render(
        <MeetingRoom
          call={state()}
          roomCode="abc-defg-hij"
          roomToken="test-room-token"
          roomEmojis={[]}
          isCurrentUserAdmin={false}
          audioLocked={false}
          videoLocked={false}
          onSetAudioLock={jest.fn()}
          onSetVideoLock={jest.fn()}
          participants={[]}
          roomSocket={socket as unknown as Socket}
        />,
      );
      act(() =>
        socket.callbacks['breakout:assigned']({
          breakoutId: 'breakout-1',
          label: 'Mini sala 1',
          leavePolicy: 'free_return',
        }),
      );

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Volver' }));
      });

      expect(returnFromBreakoutRoom).toHaveBeenCalledWith(
        'abc-defg-hij',
        'test-room-token',
        'breakout-1',
      );
      expect(screen.queryByText('Mini sala 1')).toBeNull();
    });

    it('si returnFromBreakoutRoom falla, muestra el error y conserva el banner visible', async () => {
      const { returnFromBreakoutRoom } = await import('@/lib/breakouts');
      (returnFromBreakoutRoom as jest.Mock<typeof returnFromBreakoutRoom>).mockRejectedValue(
        new Error('No se pudo volver a la sala principal'),
      );
      const MeetingRoom = (await import('./MeetingRoom')).default;
      const socket = createFakeSocket();
      render(
        <MeetingRoom
          call={state()}
          roomCode="abc-defg-hij"
          roomToken="test-room-token"
          roomEmojis={[]}
          isCurrentUserAdmin={false}
          audioLocked={false}
          videoLocked={false}
          onSetAudioLock={jest.fn()}
          onSetVideoLock={jest.fn()}
          participants={[]}
          roomSocket={socket as unknown as Socket}
        />,
      );
      act(() =>
        socket.callbacks['breakout:assigned']({
          breakoutId: 'breakout-1',
          label: 'Mini sala 1',
          leavePolicy: 'free_return',
        }),
      );

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Volver' }));
      });

      expect(screen.getByRole('alert')).toHaveTextContent('No se pudo volver a la sala principal');
      expect(screen.getByText('Mini sala 1')).toBeInTheDocument();
    });
  });

  describe('traslado real de medios al recibir breakout:assigned (Fase 6.13)', () => {
    it('[6.13.1] pide el token de la mini sala vía issueBreakoutToken y traslada los medios reales con switchRoom, sin pasar por joinCall', async () => {
      const { issueBreakoutToken } = await import('@/lib/breakouts');
      (issueBreakoutToken as jest.Mock<typeof issueBreakoutToken>).mockResolvedValue({
        url: 'wss://media.example.com',
        token: 'breakout-token-1',
        roomName: 'abc-defg-hij::breakout-1',
        participantLimit: 6,
      });
      const MeetingRoom = (await import('./MeetingRoom')).default;
      const socket = createFakeSocket();
      const call = state();
      render(
        <MeetingRoom
          call={call}
          roomCode="abc-defg-hij"
          roomToken="test-room-token"
          roomEmojis={[]}
          isCurrentUserAdmin={false}
          audioLocked={false}
          videoLocked={false}
          onSetAudioLock={jest.fn()}
          onSetVideoLock={jest.fn()}
          participants={[]}
          roomSocket={socket as unknown as Socket}
        />,
      );

      await act(async () => {
        socket.callbacks['breakout:assigned']({
          breakoutId: 'breakout-1',
          label: 'Mini sala 1',
          leavePolicy: 'locked',
        });
      });

      expect(issueBreakoutToken).toHaveBeenCalledWith(
        'abc-defg-hij',
        'test-room-token',
        'breakout-1',
      );
      await waitFor(() =>
        expect(call.switchRoom).toHaveBeenCalledWith({
          url: 'wss://media.example.com',
          token: 'breakout-token-1',
          roomName: 'abc-defg-hij::breakout-1',
          participantLimit: 6,
        }),
      );
      expect(call.joinCall).not.toHaveBeenCalled();
    });

    it('[6.13.2] si issueBreakoutToken falla (403 sin asignación, red caída), no llama switchRoom y muestra un error visible sin traslado parcial', async () => {
      const { issueBreakoutToken } = await import('@/lib/breakouts');
      (issueBreakoutToken as jest.Mock<typeof issueBreakoutToken>).mockRejectedValue(
        new Error('No se pudo obtener el acceso a la mini sala'),
      );
      const MeetingRoom = (await import('./MeetingRoom')).default;
      const socket = createFakeSocket();
      const call = state();
      render(
        <MeetingRoom
          call={call}
          roomCode="abc-defg-hij"
          roomToken="test-room-token"
          roomEmojis={[]}
          isCurrentUserAdmin={false}
          audioLocked={false}
          videoLocked={false}
          onSetAudioLock={jest.fn()}
          onSetVideoLock={jest.fn()}
          participants={[]}
          roomSocket={socket as unknown as Socket}
        />,
      );

      await act(async () => {
        socket.callbacks['breakout:assigned']({
          breakoutId: 'breakout-1',
          label: 'Mini sala 1',
          leavePolicy: 'locked',
        });
      });

      await waitFor(() =>
        expect(screen.getByRole('alert')).toHaveTextContent(
          'No se pudo obtener el acceso a la mini sala',
        ),
      );
      expect(call.switchRoom).not.toHaveBeenCalled();
    });

    it('[6.13.3] dos breakout:assigned consecutivos (reasignación) para el mismo usuario: el segundo traslado reemplaza limpiamente al primero, sin un switchRoom intermedio hacia la mini sala vieja', async () => {
      const { issueBreakoutToken } = await import('@/lib/breakouts');
      const deferred: Array<(value: Awaited<ReturnType<typeof issueBreakoutToken>>) => void> = [];
      (issueBreakoutToken as jest.Mock<typeof issueBreakoutToken>).mockImplementation(
        () =>
          new Promise((resolve) => {
            deferred.push(resolve);
          }),
      );
      const MeetingRoom = (await import('./MeetingRoom')).default;
      const socket = createFakeSocket();
      const call = state();
      render(
        <MeetingRoom
          call={call}
          roomCode="abc-defg-hij"
          roomToken="test-room-token"
          roomEmojis={[]}
          isCurrentUserAdmin={false}
          audioLocked={false}
          videoLocked={false}
          onSetAudioLock={jest.fn()}
          onSetVideoLock={jest.fn()}
          participants={[]}
          roomSocket={socket as unknown as Socket}
        />,
      );

      act(() =>
        socket.callbacks['breakout:assigned']({
          breakoutId: 'breakout-1',
          label: 'Mini sala 1',
          leavePolicy: 'locked',
        }),
      );
      act(() =>
        socket.callbacks['breakout:assigned']({
          breakoutId: 'breakout-2',
          label: 'Mini sala 2',
          leavePolicy: 'locked',
        }),
      );

      expect(issueBreakoutToken).toHaveBeenCalledTimes(2);
      expect(issueBreakoutToken).toHaveBeenNthCalledWith(
        1,
        'abc-defg-hij',
        'test-room-token',
        'breakout-1',
      );
      expect(issueBreakoutToken).toHaveBeenNthCalledWith(
        2,
        'abc-defg-hij',
        'test-room-token',
        'breakout-2',
      );

      // La primera resuelve tarde, después de que ya se pidió la segunda: no
      // debe aplicar un switchRoom intermedio hacia la mini sala vieja.
      await act(async () => {
        deferred[0]({
          url: 'wss://media.example.com',
          token: 'breakout-token-1',
          roomName: 'abc-defg-hij::breakout-1',
          participantLimit: 6,
        });
      });
      expect(call.switchRoom).not.toHaveBeenCalled();

      await act(async () => {
        deferred[1]({
          url: 'wss://media.example.com',
          token: 'breakout-token-2',
          roomName: 'abc-defg-hij::breakout-2',
          participantLimit: 6,
        });
      });
      expect(call.switchRoom).toHaveBeenCalledTimes(1);
      expect(call.switchRoom).toHaveBeenCalledWith({
        url: 'wss://media.example.com',
        token: 'breakout-token-2',
        roomName: 'abc-defg-hij::breakout-2',
        participantLimit: 6,
      });
    });
  });
});

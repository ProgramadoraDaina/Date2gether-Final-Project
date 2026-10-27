import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { CallSessionState } from './useCallSession';
import { useLanguageStore } from '../translation/store';

jest.mock('@livekit/components-react', () => ({
  LiveKitRoom: jest.fn(({ children }: { children: ReactNode }) => <div>{children}</div>),
  GridLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ParticipantTile: () => <div>Video participante</div>,
  RoomAudioRenderer: () => <div>Audio remoto</div>,
  ConnectionStateToast: () => null,
  StartAudio: () => null,
  MediaDeviceMenu: () => null,
  DisconnectButton: ({ children }: { children: ReactNode }) => <button>{children}</button>,
  TrackToggle: ({
    children,
    onDeviceError,
  }: {
    children: ReactNode;
    onDeviceError: (error: Error) => void;
  }) => <button onClick={() => onDeviceError(new Error('denied'))}>{children}</button>,
  useTracks: jest.fn(() => []),
}));
jest.mock('livekit-client', () => ({
  DisconnectReason: { CLIENT_INITIATED: 1 },
  Track: { Source: { Camera: 'camera', Microphone: 'microphone' } },
  VideoPresets: { h360: { resolution: { width: 640, height: 360 } }, h90: {}, h180: {} },
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
describe('MeetingRoom', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useLanguageStore.setState({ language: 'es' });
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
  it('un permiso rechazado muestra instrucciones y conserva los controles de la llamada', async () => {
    const MeetingRoom = (await import('./MeetingRoom')).default;
    const call = state();
    render(<MeetingRoom call={call} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cámara' }));
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
    act(() => props.onError?.(new Error('network')));
    expect(call.failed).toHaveBeenCalledTimes(1);
  });
});

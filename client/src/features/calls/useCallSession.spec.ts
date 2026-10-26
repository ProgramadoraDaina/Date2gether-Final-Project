import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react';
import type { AudioVideoObserver, MeetingSession, MeetingSessionStatus } from 'amazon-chime-sdk-js';

jest.mock('../../lib/calls', () => ({ startCall: jest.fn() }));
jest.mock('../../lib/chime', () => ({ createMeetingSession: jest.fn() }));

function buildSession() {
  let observer: AudioVideoObserver | undefined;
  let muted = false;
  const audioVideo = {
    start: jest.fn(),
    stop: jest.fn(),
    addObserver: jest.fn((value: AudioVideoObserver) => {
      observer = value;
    }),
    removeObserver: jest.fn(),
    listAudioInputDevices: jest
      .fn<() => Promise<MediaDeviceInfo[]>>()
      .mockResolvedValue([{ deviceId: 'mic-1' } as MediaDeviceInfo]),
    startAudioInput: jest.fn<(deviceId: string) => Promise<void>>().mockResolvedValue(),
    realtimeIsLocalAudioMuted: jest.fn(() => muted),
    realtimeMuteLocalAudio: jest.fn(() => {
      muted = true;
      return true;
    }),
    realtimeUnmuteLocalAudio: jest.fn(() => {
      muted = false;
      return true;
    }),
  };
  const destroy = jest.fn<() => Promise<void>>().mockResolvedValue();
  const session = { audioVideo, deviceController: { destroy } } as unknown as MeetingSession;
  return { session, audioVideo, destroy, observer: () => observer! };
}

async function setup() {
  const { startCall } = await import('../../lib/calls');
  const { createMeetingSession } = await import('../../lib/chime');
  const fake = buildSession();
  (startCall as jest.Mock<typeof startCall>).mockResolvedValue({
    meeting: { MeetingId: 'meeting-123' },
    attendee: { AttendeeId: 'attendee-456', ExternalUserId: 'guest-789' },
  });
  (createMeetingSession as jest.Mock<typeof createMeetingSession>).mockReturnValue(fake.session);
  const { useCallSession } = await import('./useCallSession');
  return { ...fake, startCall, createMeetingSession, ...renderHook(() => useCallSession()) };
}

describe('useCallSession', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('espera la confirmación de Chime antes de mostrar que está en llamada', async () => {
    const fake = await setup();
    await act(() => fake.result.current.joinCall('ABC123', 'guest-token'));
    expect(fake.startCall).toHaveBeenCalledWith('ABC123', 'guest-token');
    expect(fake.audioVideo.startAudioInput).toHaveBeenCalledWith('mic-1');
    expect(fake.audioVideo.start).toHaveBeenCalledTimes(1);
    expect(fake.result.current.status).toBe('connecting');
    act(() => fake.observer().audioVideoDidStart?.());
    expect(fake.result.current.status).toBe('in-call');
    expect(fake.result.current.meetingSession).toBe(fake.session);
  });

  it('muestra el error del backend sin crear una sesión de medios', async () => {
    const fake = await setup();
    (fake.startCall as jest.Mock<typeof fake.startCall>).mockRejectedValueOnce(
      new Error('Las llamadas de audio todavía no están habilitadas'),
    );
    await act(() => fake.result.current.joinCall('ABC123', 'token'));
    expect(fake.result.current.status).toBe('error');
    expect(fake.result.current.error).toBe('Las llamadas de audio todavía no están habilitadas');
    expect(fake.createMeetingSession).not.toHaveBeenCalled();
  });

  it('colgar desconecta y libera el micrófono', async () => {
    const fake = await setup();
    await act(() => fake.result.current.joinCall('ABC123', 'token'));
    act(() => fake.result.current.leaveCall());
    expect(fake.audioVideo.removeObserver).toHaveBeenCalledWith(fake.observer());
    expect(fake.audioVideo.stop).toHaveBeenCalledTimes(1);
    expect(fake.destroy).toHaveBeenCalledTimes(1);
    expect(fake.result.current.status).toBe('idle');
    expect(fake.result.current.meetingSession).toBeNull();
  });

  it('salir de la página libera los dispositivos', async () => {
    const fake = await setup();
    await act(() => fake.result.current.joinCall('ABC123', 'token'));
    fake.unmount();
    expect(fake.audioVideo.stop).toHaveBeenCalledTimes(1);
    expect(fake.destroy).toHaveBeenCalledTimes(1);
  });

  it('cancelar durante la solicitud evita encender el micrófono después', async () => {
    const fake = await setup();
    let resolve!: (value: Awaited<ReturnType<typeof fake.startCall>>) => void;
    (fake.startCall as jest.Mock<typeof fake.startCall>).mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    let joining!: Promise<void>;
    act(() => {
      joining = fake.result.current.joinCall('ABC123', 'token');
    });
    act(() => fake.result.current.leaveCall());
    await act(async () => {
      resolve({
        meeting: { MeetingId: 'meeting' },
        attendee: { AttendeeId: 'attendee', ExternalUserId: 'guest' },
      });
      await joining;
    });
    expect(fake.createMeetingSession).not.toHaveBeenCalled();
    expect(fake.result.current.status).toBe('idle');
  });

  it('cancela mientras el navegador espera el permiso de micrófono', async () => {
    const fake = await setup();
    let allowMicrophone!: () => void;
    fake.audioVideo.startAudioInput.mockReturnValueOnce(
      new Promise<void>((done) => {
        allowMicrophone = done;
      }),
    );
    let joining!: Promise<void>;
    await act(async () => {
      joining = fake.result.current.joinCall('ABC123', 'token');
    });
    act(() => fake.result.current.leaveCall());
    await act(async () => {
      allowMicrophone();
      await joining;
    });
    expect(fake.audioVideo.start).not.toHaveBeenCalled();
    expect(fake.destroy).toHaveBeenCalledTimes(1);
    expect(fake.result.current.status).toBe('idle');
  });

  it('limpia una sesión incompleta si se rechaza el micrófono', async () => {
    const fake = await setup();
    fake.audioVideo.startAudioInput.mockRejectedValueOnce(
      Object.assign(new Error('denied'), { name: 'NotAllowedError' }),
    );
    await act(() => fake.result.current.joinCall('ABC123', 'token'));
    expect(fake.audioVideo.start).not.toHaveBeenCalled();
    expect(fake.destroy).toHaveBeenCalledTimes(1);
    expect(fake.result.current.meetingSession).toBeNull();
    expect(fake.result.current.error).toBe(
      'Permití el acceso al micrófono para iniciar la llamada',
    );
  });

  it('reporta una pérdida de conexión y libera los dispositivos', async () => {
    const fake = await setup();
    await act(() => fake.result.current.joinCall('ABC123', 'token'));
    act(() =>
      fake.observer().audioVideoDidStop?.({ isFailure: () => true } as MeetingSessionStatus),
    );
    expect(fake.result.current.status).toBe('error');
    expect(fake.result.current.error).toContain('Se perdió la conexión de audio');
    expect(fake.destroy).toHaveBeenCalledTimes(1);
    expect(fake.result.current.meetingSession).toBeNull();
  });

  it('no inicia dos llamadas ante clics repetidos', async () => {
    const fake = await setup();
    await act(async () => {
      await Promise.all([
        fake.result.current.joinCall('ABC123', 'token'),
        fake.result.current.joinCall('ABC123', 'token'),
      ]);
    });
    expect(fake.startCall).toHaveBeenCalledTimes(1);
    expect(fake.audioVideo.start).toHaveBeenCalledTimes(1);
  });

  it('silencia y vuelve a activar el micrófono sin salir de la llamada', async () => {
    const fake = await setup();
    await act(() => fake.result.current.joinCall('ABC123', 'token'));
    act(() => fake.result.current.toggleMute());
    expect(fake.result.current.isMuted).toBe(true);
    act(() => fake.result.current.toggleMute());
    expect(fake.result.current.isMuted).toBe(false);
    expect(fake.audioVideo.stop).not.toHaveBeenCalled();
  });
});

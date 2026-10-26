import { describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react';
import type { MeetingSession } from 'amazon-chime-sdk-js';

// Se mockean los módulos propios (no amazon-chime-sdk-js directamente) y se
// cargan con import() dinámico después del mock: next/jest no hace el hoist
// de jest.mock() por encima de imports estáticos, así que esto evita que se
// cargue la implementación real antes de que el mock quede registrado.
jest.mock('../../lib/calls', () => ({ startCall: jest.fn() }));
jest.mock('../../lib/chime', () => ({ createMeetingSession: jest.fn() }));

describe('useCallSession', () => {
  it('pasa a "connecting" y luego a "in-call" cuando la llamada arranca con éxito', async () => {
    const { startCall } = await import('../../lib/calls');
    const { createMeetingSession } = await import('../../lib/chime');
    const fakeSession = {
      meeting: { MeetingId: 'meeting-123' },
      attendee: { AttendeeId: 'attendee-456', ExternalUserId: 'user-789' },
    };
    const start = jest.fn();
    const stop = jest.fn();
    const startAudioInput = jest
      .fn<(deviceId: string) => Promise<undefined>>()
      .mockResolvedValue(undefined);
    const listAudioInputDevices = jest
      .fn<() => Promise<MediaDeviceInfo[]>>()
      .mockResolvedValue([{ deviceId: 'mic-1' } as MediaDeviceInfo]);
    const fakeMeetingSession = {
      audioVideo: { start, stop, startAudioInput, listAudioInputDevices },
    } as unknown as MeetingSession;

    (startCall as jest.Mock<typeof startCall>).mockResolvedValue(fakeSession);
    (createMeetingSession as jest.Mock<typeof createMeetingSession>).mockReturnValue(
      fakeMeetingSession,
    );

    const { useCallSession } = await import('./useCallSession');
    const { result } = renderHook(() => useCallSession());

    expect(result.current.status).toBe('idle');

    await act(async () => {
      await result.current.joinCall('ABC123', 'room-token');
    });

    expect(startCall).toHaveBeenCalledWith('ABC123', 'room-token');
    expect(createMeetingSession).toHaveBeenCalledWith(fakeSession);
    expect(listAudioInputDevices).toHaveBeenCalledTimes(1);
    expect(startAudioInput).toHaveBeenCalledWith('mic-1');
    expect(start).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('in-call');
    expect(result.current.meetingSession).toBe(fakeMeetingSession);
  });

  it('pasa a "error" con un mensaje legible si el backend rechaza la llamada', async () => {
    const { startCall } = await import('../../lib/calls');
    (startCall as jest.Mock<typeof startCall>).mockRejectedValue(
      new Error('No se pudo iniciar la llamada'),
    );

    const { useCallSession } = await import('./useCallSession');
    const { result } = renderHook(() => useCallSession());

    await act(async () => {
      await result.current.joinCall('ABC123', 'room-token');
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('No se pudo iniciar la llamada');
  });

  it('detiene audioVideo y vuelve a "idle" al salir de la llamada', async () => {
    const { startCall } = await import('../../lib/calls');
    const { createMeetingSession } = await import('../../lib/chime');
    const stop = jest.fn();
    const fakeMeetingSession = {
      audioVideo: {
        start: jest.fn(),
        stop,
        startAudioInput: jest.fn<() => Promise<undefined>>().mockResolvedValue(undefined),
        listAudioInputDevices: jest
          .fn<() => Promise<MediaDeviceInfo[]>>()
          .mockResolvedValue([{ deviceId: 'mic-1' } as MediaDeviceInfo]),
      },
    } as unknown as MeetingSession;

    (startCall as jest.Mock<typeof startCall>).mockResolvedValue({
      meeting: { MeetingId: 'meeting-123' },
      attendee: { AttendeeId: 'attendee-456', ExternalUserId: 'user-789' },
    });
    (createMeetingSession as jest.Mock<typeof createMeetingSession>).mockReturnValue(
      fakeMeetingSession,
    );

    const { useCallSession } = await import('./useCallSession');
    const { result } = renderHook(() => useCallSession());

    await act(async () => {
      await result.current.joinCall('ABC123', 'room-token');
    });

    act(() => {
      result.current.leaveCall();
    });

    expect(stop).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('idle');
    expect(result.current.meetingSession).toBeNull();
  });
});

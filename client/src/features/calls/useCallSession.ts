'use client';

import type { MeetingSession } from 'amazon-chime-sdk-js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { startCall } from '../../lib/calls';
import { createMeetingSession } from '../../lib/chime';

export type CallStatus = 'idle' | 'connecting' | 'in-call' | 'error';

export interface CallSessionState {
  status: CallStatus;
  error: string | null;
  meetingSession: MeetingSession | null;
  joinCall: (roomCode: string, roomToken: string) => Promise<void>;
  leaveCall: () => void;
}

export function useCallSession(): CallSessionState {
  const [status, setStatus] = useState<CallStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [meetingSession, setMeetingSession] = useState<MeetingSession | null>(null);
  const activeSession = useRef<MeetingSession | null>(null);
  useEffect(
    () => () => {
      activeSession.current?.audioVideo.stop();
    },
    [],
  );

  const joinCall = useCallback(async (roomCode: string, roomToken: string) => {
    setStatus('connecting');
    setError(null);
    try {
      const session = await startCall(roomCode, roomToken);
      const newMeetingSession = createMeetingSession(session);

      const audioInputDevices = await newMeetingSession.audioVideo.listAudioInputDevices();
      if (audioInputDevices[0]) {
        await newMeetingSession.audioVideo.startAudioInput(audioInputDevices[0].deviceId);
      }

      newMeetingSession.audioVideo.start();
      activeSession.current = newMeetingSession;
      setMeetingSession(newMeetingSession);
      setStatus('in-call');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo iniciar la llamada');
      setStatus('error');
    }
  }, []);

  const leaveCall = useCallback(() => {
    activeSession.current?.audioVideo.stop();
    activeSession.current = null;
    setMeetingSession(null);
    setStatus('idle');
  }, []);

  return { status, error, meetingSession, joinCall, leaveCall };
}

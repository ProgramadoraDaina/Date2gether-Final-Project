'use client';

import type { AudioVideoObserver, MeetingSession } from 'amazon-chime-sdk-js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { startCall } from '../../lib/calls';
import { createMeetingSession } from '../../lib/chime';

export type CallStatus = 'idle' | 'connecting' | 'in-call' | 'error';

export interface CallSessionState {
  status: CallStatus;
  error: string | null;
  meetingSession: MeetingSession | null;
  isMuted: boolean;
  toggleMute: () => void;
  joinCall: (roomCode: string, roomToken: string) => Promise<void>;
  leaveCall: () => void;
}

interface ActiveSession {
  session: MeetingSession;
  observer: AudioVideoObserver;
}

function disposeSession(session: MeetingSession, observer?: AudioVideoObserver): void {
  if (observer) session.audioVideo.removeObserver(observer);
  session.audioVideo.stop();
  // stop() desconecta la reunión; destroy() libera micrófono y listeners.
  void session.deviceController.destroy().catch(() => undefined);
}

export function useCallSession(): CallSessionState {
  const [status, setStatus] = useState<CallStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [meetingSession, setMeetingSession] = useState<MeetingSession | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const activeSession = useRef<ActiveSession | null>(null);
  const attempt = useRef(0);
  const joining = useRef(false);

  const release = useCallback(() => {
    attempt.current += 1;
    joining.current = false;
    const active = activeSession.current;
    activeSession.current = null;
    if (active) disposeSession(active.session, active.observer);
  }, []);

  useEffect(() => release, [release]);

  const joinCall = useCallback(async (roomCode: string, roomToken: string) => {
    if (joining.current || activeSession.current) return;
    joining.current = true;
    const currentAttempt = ++attempt.current;
    let newSession: MeetingSession | null = null;
    setStatus('connecting');
    setError(null);
    setIsMuted(false);

    try {
      const session = await startCall(roomCode, roomToken);
      if (currentAttempt !== attempt.current) return;
      newSession = createMeetingSession(session);
      const devices = await newSession.audioVideo.listAudioInputDevices();
      if (currentAttempt === attempt.current && devices[0]) {
        await newSession.audioVideo.startAudioInput(devices[0].deviceId);
      }
      if (currentAttempt !== attempt.current) {
        disposeSession(newSession);
        return;
      }

      const observer: AudioVideoObserver = {
        audioVideoDidStart: () => {
          if (currentAttempt === attempt.current) setStatus('in-call');
        },
        audioVideoDidStop: (sessionStatus) => {
          if (currentAttempt !== attempt.current) return;
          const active = activeSession.current;
          activeSession.current = null;
          attempt.current += 1;
          joining.current = false;
          if (active) disposeSession(active.session, active.observer);
          setMeetingSession(null);
          setIsMuted(false);
          setStatus(sessionStatus.isFailure() ? 'error' : 'idle');
          setError(
            sessionStatus.isFailure() ? 'Se perdió la conexión de audio. Volvé a llamar.' : null,
          );
        },
      };
      activeSession.current = { session: newSession, observer };
      newSession.audioVideo.addObserver(observer);
      setMeetingSession(newSession);
      newSession.audioVideo.start();
    } catch (err) {
      if (currentAttempt !== attempt.current) {
        if (newSession) disposeSession(newSession);
        return;
      }
      const active = activeSession.current;
      activeSession.current = null;
      if (newSession) disposeSession(newSession, active?.observer);
      setMeetingSession(null);
      setError(
        err instanceof Error && err.name === 'NotAllowedError'
          ? 'Permití el acceso al micrófono para iniciar la llamada'
          : err instanceof Error
            ? err.message
            : 'No se pudo iniciar la llamada',
      );
      setStatus('error');
    } finally {
      if (currentAttempt === attempt.current) joining.current = false;
    }
  }, []);

  const leaveCall = useCallback(() => {
    release();
    setMeetingSession(null);
    setStatus('idle');
    setError(null);
    setIsMuted(false);
  }, [release]);

  const toggleMute = useCallback(() => {
    const audio = activeSession.current?.session.audioVideo;
    if (!audio) return;
    if (audio.realtimeIsLocalAudioMuted()) audio.realtimeUnmuteLocalAudio();
    else audio.realtimeMuteLocalAudio();
    setIsMuted(audio.realtimeIsLocalAudioMuted());
  }, []);

  return { status, error, meetingSession, isMuted, toggleMute, joinCall, leaveCall };
}

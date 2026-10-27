'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { startCall, type CallSession } from '../../lib/calls';

export type CallStatus = 'idle' | 'connecting' | 'in-call' | 'error';

export interface CallSessionState {
  status: CallStatus;
  error: string | null;
  session: CallSession | null;
  joinCall: (roomCode: string, roomToken: string) => Promise<void>;
  leaveCall: () => void;
  connected: () => void;
  failed: (error: Error) => void;
}

export function useCallSession(): CallSessionState {
  const [status, setStatus] = useState<CallStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<CallSession | null>(null);
  const pending = useRef<AbortController | null>(null);
  const current = useRef<CallSession | null>(null);
  const clear = useCallback(() => {
    pending.current?.abort();
    pending.current = null;
    current.current = null;
  }, []);
  useEffect(() => clear, [clear]);

  const joinCall = useCallback(async (roomCode: string, roomToken: string) => {
    if (pending.current || current.current) return;
    const request = new AbortController();
    pending.current = request;
    setStatus('connecting');
    setError(null);
    try {
      const credentials = await startCall(roomCode, roomToken, request.signal);
      if (request.signal.aborted) return;
      current.current = credentials;
      setSession(credentials);
      // LiveKitRoom confirma la conexión mediante onConnected.
    } catch (cause) {
      if (request.signal.aborted) return;
      setError(cause instanceof Error ? cause.message : 'No se pudo iniciar la llamada');
      setStatus('error');
    } finally {
      if (pending.current === request) pending.current = null;
    }
  }, []);
  const leaveCall = useCallback(() => {
    clear();
    setSession(null);
    setStatus('idle');
    setError(null);
  }, [clear]);
  const connected = useCallback(() => {
    if (current.current) setStatus('in-call');
  }, []);
  const failed = useCallback(() => {
    clear();
    setSession(null);
    setStatus('error');
    setError('No se pudo conectar a la llamada. La sala puede estar llena o sin conexión.');
  }, [clear]);
  return { status, error, session, joinCall, leaveCall, connected, failed };
}

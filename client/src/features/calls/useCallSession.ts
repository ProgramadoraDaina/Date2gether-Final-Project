'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { startCall, type CallSession } from '../../lib/calls';

export type CallStatus = 'idle' | 'connecting' | 'in-call' | 'error' | 'ended';
// 'host-left': el anfitrión (último administrador conectado) se desconectó
// y LiveKit forzó el cierre de la sesión para todos (D5, design.md). Es un
// estado terminal distinto de 'error': la llamada no falló, terminó.
export type EndReason = 'host-left' | null;

export interface CallSessionState {
  status: CallStatus;
  error: string | null;
  endReason: EndReason;
  session: CallSession | null;
  joinCall: (roomCode: string, roomToken: string) => Promise<void>;
  leaveCall: () => void;
  connected: () => void;
  failed: (error: Error) => void;
  endedByHost: () => void;
}

export function useCallSession(): CallSessionState {
  const [status, setStatus] = useState<CallStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [endReason, setEndReason] = useState<EndReason>(null);
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
    setEndReason(null);
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
    setEndReason(null);
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
  // Cierre forzado por el anfitrión (D5, design.md): distinto de failed()
  // porque no es un fallo de red/LiveKit, es el fin normal de la sesión por
  // la regla de negocio "sin admin, no hay llamada".
  const endedByHost = useCallback(() => {
    clear();
    setSession(null);
    setStatus('ended');
    setEndReason('host-left');
  }, [clear]);
  return { status, error, endReason, session, joinCall, leaveCall, connected, failed, endedByHost };
}

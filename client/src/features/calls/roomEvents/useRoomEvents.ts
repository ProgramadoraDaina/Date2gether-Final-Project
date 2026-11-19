'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';

export interface RoomEventParticipant {
  participantId: string;
  userName: string;
}

// Único tipo soportado hoy (ver start-room-event.dto.ts del backend); el
// resto del código ya está armado para sumar 'votacion' más adelante sin
// tocar esta forma.
export type RoomEventType = 'roulette';

export interface RoomEventState {
  type: RoomEventType;
  participants: RoomEventParticipant[];
  winner: RoomEventParticipant;
  startedAt: number;
  expiresAt: number;
}

interface UseRoomEventsResult {
  // Resultado vigente para el cartel de abajo (null si nunca hubo uno o ya venció).
  settled: RoomEventState | null;
  // Girada recién llegada en vivo, para animar la ruleta. null si nunca giró
  // acá o si ya se descartó (ver dismissSpin).
  spin: RoomEventState | null;
  dismissSpin(): void;
  // Cierre manual del cartel de abajo, antes de que venzan los 15 minutos.
  clearSettled(): void;
  startRoulette(participantIds: string[]): void;
}

export function useRoomEvents(socket: Socket | null): UseRoomEventsResult {
  const [settled, setSettled] = useState<RoomEventState | null>(null);
  const [spin, setSpin] = useState<RoomEventState | null>(null);
  const expiryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // El servidor manda expiresAt absoluto (ver chat.gateway.ts): no hay
  // broadcast aparte cuando vence, cada cliente se encarga solo de ocultar
  // el cartel llegado ese momento (mismo patrón de timers locales que ya usa
  // ReactionsProvider para las reacciones, solo que a escala de minutos).
  const scheduleExpiry = useCallback((state: RoomEventState) => {
    if (expiryTimer.current) clearTimeout(expiryTimer.current);
    const msLeft = state.expiresAt - Date.now();
    if (msLeft <= 0) {
      setSettled(null);
      return;
    }
    expiryTimer.current = setTimeout(() => setSettled(null), msLeft);
  }, []);

  useEffect(() => {
    if (!socket) return;
    // Sync al unirse/reconectar: nunca anima, solo deja listo el cartel si
    // el resultado todavía está vigente (ver comentario en el gateway).
    function onEventState(state: RoomEventState) {
      setSettled(state);
      scheduleExpiry(state);
    }
    // Girada en vivo: todos la reciben al mismo tiempo, incluida la persona
    // que la disparó (el gateway no excluye al emisor).
    function onEventStarted(state: RoomEventState) {
      setSpin(state);
      setSettled(state);
      scheduleExpiry(state);
    }
    socket.on('eventState', onEventState);
    socket.on('eventStarted', onEventStarted);
    return () => {
      socket.off('eventState', onEventState);
      socket.off('eventStarted', onEventStarted);
    };
  }, [socket, scheduleExpiry]);

  useEffect(() => {
    const timer = expiryTimer;
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const startRoulette = useCallback(
    (participantIds: string[]) => {
      socket?.emit('startRoomEvent', { type: 'roulette', participantIds });
    },
    [socket],
  );

  const dismissSpin = useCallback(() => setSpin(null), []);

  const clearSettled = useCallback(() => {
    if (expiryTimer.current) clearTimeout(expiryTimer.current);
    setSettled(null);
  }, []);

  return { settled, spin, dismissSpin, clearSettled, startRoulette };
}

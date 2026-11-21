'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';

export interface RoomEventParticipant {
  participantId: string;
  userName: string;
}

export type RoomEventType = 'roulette' | 'poll';

export interface RouletteEventState {
  type: 'roulette';
  participants: RoomEventParticipant[];
  winner: RoomEventParticipant;
  startedAt: number;
  expiresAt: number;
}

export interface PollEventState {
  type: 'poll';
  question: string;
  options: string[];
  multipleChoice: boolean;
  anonymous: boolean;
  participants: RoomEventParticipant[];
  // participantId -> índices de opción elegidos; ausente = todavía no votó.
  votes: Record<string, number[]>;
  closed: boolean;
  startedAt: number;
  expiresAt: number;
}

export type RoomEventState = RouletteEventState | PollEventState;

interface UseRoomEventsResult {
  // Resultado vigente para el cartel/panel de abajo (null si nunca hubo uno o ya venció).
  settled: RoomEventState | null;
  // Girada recién llegada en vivo, para animar la ruleta. null si nunca giró
  // acá o si ya se descartó (ver dismissSpin). Nunca se setea para 'poll'.
  spin: RouletteEventState | null;
  dismissSpin(): void;
  // Cierre manual del cartel/panel de abajo, antes de que venzan los 15 minutos.
  clearSettled(): void;
  startRoulette(participantIds: string[]): void;
  startPoll(
    participantIds: string[],
    question: string,
    options: string[],
    config: { multipleChoice: boolean; anonymous: boolean },
  ): void;
  castPollVote(optionIndexes: number[]): void;
  closePoll(): void;
}

export function useRoomEvents(socket: Socket | null): UseRoomEventsResult {
  const [settled, setSettled] = useState<RoomEventState | null>(null);
  const [spin, setSpin] = useState<RouletteEventState | null>(null);
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
    // Sync al unirse/reconectar, y también los votos/cierre en vivo de una
    // encuesta: nunca anima, solo deja listo el cartel/panel (ver comentario
    // en el gateway).
    function onEventState(state: RoomEventState) {
      setSettled(state);
      scheduleExpiry(state);
    }
    // Girada en vivo: todos la reciben al mismo tiempo, incluida la persona
    // que la disparó (el gateway no excluye al emisor). Solo la ruleta anima;
    // una encuesta nueva se sincroniza como settled sin disparar la rueda.
    function onEventStarted(state: RoomEventState) {
      if (state.type === 'roulette') setSpin(state);
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

  const startPoll = useCallback(
    (
      participantIds: string[],
      question: string,
      options: string[],
      config: { multipleChoice: boolean; anonymous: boolean },
    ) => {
      socket?.emit('startRoomEvent', {
        type: 'poll',
        participantIds,
        question,
        options,
        multipleChoice: config.multipleChoice,
        anonymous: config.anonymous,
      });
    },
    [socket],
  );

  const castPollVote = useCallback(
    (optionIndexes: number[]) => {
      socket?.emit('castPollVote', { optionIndexes });
    },
    [socket],
  );

  const closePoll = useCallback(() => {
    socket?.emit('closePollEvent');
  }, [socket]);

  const dismissSpin = useCallback(() => setSpin(null), []);

  const clearSettled = useCallback(() => {
    if (expiryTimer.current) clearTimeout(expiryTimer.current);
    setSettled(null);
  }, []);

  return {
    settled,
    spin,
    dismissSpin,
    clearSettled,
    startRoulette,
    startPoll,
    castPollVote,
    closePoll,
  };
}

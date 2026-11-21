import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react';
import type { Socket } from 'socket.io-client';
import {
  useRoomEvents,
  type PollEventState,
  type RouletteEventState,
} from './useRoomEvents';

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

const baseState: RouletteEventState = {
  type: 'roulette',
  participants: [
    { participantId: 'p1', userName: 'Ana' },
    { participantId: 'p2', userName: 'Beto' },
  ],
  winner: { participantId: 'p1', userName: 'Ana' },
  startedAt: Date.now(),
  expiresAt: Date.now() + 15 * 60 * 1000,
};

describe('useRoomEvents', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('startRoulette emite startRoomEvent con el tipo y los ids pedidos', () => {
    const socket = createFakeSocket();
    const { result } = renderHook(() => useRoomEvents(socket as unknown as Socket));

    act(() => result.current.startRoulette(['p1', 'p2']));

    expect(socket.emit).toHaveBeenCalledWith('startRoomEvent', {
      type: 'roulette',
      participantIds: ['p1', 'p2'],
    });
  });

  it('no explota si todavía no hay socket (sala sin conectar)', () => {
    const { result } = renderHook(() => useRoomEvents(null));
    expect(() => act(() => result.current.startRoulette(['p1']))).not.toThrow();
  });

  it('eventStarted (girada en vivo) setea spin y settled a la vez', () => {
    const socket = createFakeSocket();
    const { result } = renderHook(() => useRoomEvents(socket as unknown as Socket));

    act(() => socket.callbacks.eventStarted(baseState));

    expect(result.current.spin).toEqual(baseState);
    expect(result.current.settled).toEqual(baseState);
  });

  it('eventState (sync al unirse) setea settled pero nunca dispara la animación (spin)', () => {
    const socket = createFakeSocket();
    const { result } = renderHook(() => useRoomEvents(socket as unknown as Socket));

    act(() => socket.callbacks.eventState(baseState));

    expect(result.current.settled).toEqual(baseState);
    expect(result.current.spin).toBeNull();
  });

  it('dismissSpin limpia la ruleta animada pero mantiene el cartel de resultado', () => {
    const socket = createFakeSocket();
    const { result } = renderHook(() => useRoomEvents(socket as unknown as Socket));
    act(() => socket.callbacks.eventStarted(baseState));

    act(() => result.current.dismissSpin());

    expect(result.current.spin).toBeNull();
    expect(result.current.settled).toEqual(baseState);
  });

  it('clearSettled cierra el cartel manualmente antes de que venza', () => {
    const socket = createFakeSocket();
    const { result } = renderHook(() => useRoomEvents(socket as unknown as Socket));
    act(() => socket.callbacks.eventState(baseState));

    act(() => result.current.clearSettled());

    expect(result.current.settled).toBeNull();
  });

  it('el cartel se oculta solo cuando pasan los 15 minutos (expiresAt), sin esperar otro evento', () => {
    jest.useFakeTimers();
    const socket = createFakeSocket();
    const { result } = renderHook(() => useRoomEvents(socket as unknown as Socket));
    const state: RouletteEventState = {
      ...baseState,
      startedAt: Date.now(),
      expiresAt: Date.now() + 5000,
    };

    act(() => socket.callbacks.eventState(state));
    expect(result.current.settled).toEqual(state);

    act(() => jest.advanceTimersByTime(4999));
    expect(result.current.settled).toEqual(state);

    act(() => jest.advanceTimersByTime(2));
    expect(result.current.settled).toBeNull();
  });

  it('al desuscribirse, limpia los listeners del socket', () => {
    const socket = createFakeSocket();
    const { unmount } = renderHook(() => useRoomEvents(socket as unknown as Socket));

    unmount();

    expect(socket.off).toHaveBeenCalledWith('eventState', expect.any(Function));
    expect(socket.off).toHaveBeenCalledWith('eventStarted', expect.any(Function));
  });

  const pollState: PollEventState = {
    type: 'poll',
    question: '¿Pizza o sushi?',
    options: ['Pizza', 'Sushi'],
    multipleChoice: false,
    anonymous: false,
    participants: [
      { participantId: 'p1', userName: 'Ana' },
      { participantId: 'p2', userName: 'Beto' },
    ],
    votes: {},
    closed: false,
    startedAt: Date.now(),
    expiresAt: Date.now() + 15 * 60 * 1000,
  };

  it('startPoll emite startRoomEvent con los datos de la encuesta', () => {
    const socket = createFakeSocket();
    const { result } = renderHook(() => useRoomEvents(socket as unknown as Socket));

    act(() =>
      result.current.startPoll(['p1', 'p2'], '¿Pizza o sushi?', ['Pizza', 'Sushi'], {
        multipleChoice: false,
        anonymous: false,
      }),
    );

    expect(socket.emit).toHaveBeenCalledWith('startRoomEvent', {
      type: 'poll',
      participantIds: ['p1', 'p2'],
      question: '¿Pizza o sushi?',
      options: ['Pizza', 'Sushi'],
      multipleChoice: false,
      anonymous: false,
    });
  });

  it('castPollVote emite castPollVote con los índices elegidos', () => {
    const socket = createFakeSocket();
    const { result } = renderHook(() => useRoomEvents(socket as unknown as Socket));

    act(() => result.current.castPollVote([1]));

    expect(socket.emit).toHaveBeenCalledWith('castPollVote', { optionIndexes: [1] });
  });

  it('closePoll emite closePollEvent sin payload', () => {
    const socket = createFakeSocket();
    const { result } = renderHook(() => useRoomEvents(socket as unknown as Socket));

    act(() => result.current.closePoll());

    expect(socket.emit).toHaveBeenCalledWith('closePollEvent');
  });

  it('eventStarted de una encuesta setea settled pero nunca dispara spin (es solo de la ruleta)', () => {
    const socket = createFakeSocket();
    const { result } = renderHook(() => useRoomEvents(socket as unknown as Socket));

    act(() => socket.callbacks.eventStarted(pollState));

    expect(result.current.settled).toEqual(pollState);
    expect(result.current.spin).toBeNull();
  });

  it('eventState con una encuesta actualizada (voto o cierre) solo pisa settled', () => {
    const socket = createFakeSocket();
    const { result } = renderHook(() => useRoomEvents(socket as unknown as Socket));
    act(() => socket.callbacks.eventStarted(pollState));

    const updated: PollEventState = { ...pollState, votes: { p1: [0] } };
    act(() => socket.callbacks.eventState(updated));

    expect(result.current.settled).toEqual(updated);
    expect(result.current.spin).toBeNull();
  });
});

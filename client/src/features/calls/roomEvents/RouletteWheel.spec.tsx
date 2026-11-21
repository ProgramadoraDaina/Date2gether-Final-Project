import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { act, render, screen } from '@testing-library/react';
import { RouletteWheel } from './RouletteWheel';
import type { RouletteEventState } from './useRoomEvents';

const state: RouletteEventState = {
  type: 'roulette',
  participants: [
    { participantId: 'p1', userName: 'Ana' },
    { participantId: 'p2', userName: 'Beto' },
    { participantId: 'p3', userName: 'Caro' },
  ],
  winner: { participantId: 'p2', userName: 'Beto' },
  startedAt: Date.now(),
  expiresAt: Date.now() + 15 * 60 * 1000,
};

describe('RouletteWheel', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('arranca mostrando que está girando, sin adelantar el ganador', () => {
    render(<RouletteWheel state={state} onDone={jest.fn()} />);

    expect(screen.getByText(/Roulette…/)).toBeInTheDocument();
    expect(screen.queryByText(/won the roulette/)).not.toBeInTheDocument();
  });

  it('dibuja un gajo (nombre) por cada participante', () => {
    render(<RouletteWheel state={state} onDone={jest.fn()} />);

    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.getByText('Beto')).toBeInTheDocument();
    expect(screen.getByText('Caro')).toBeInTheDocument();
  });

  it('al terminar de girar muestra el nombre del ganador, y después llama a onDone', () => {
    jest.useFakeTimers();
    const onDone = jest.fn();
    render(<RouletteWheel state={state} onDone={onDone} />);

    act(() => jest.advanceTimersByTime(4500));
    expect(screen.getByText(/Beto won the roulette/)).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();

    act(() => jest.advanceTimersByTime(2500));
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});

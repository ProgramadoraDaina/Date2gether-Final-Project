import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react';
import { EventTicker } from './EventTicker';
import type { RoomEventState } from './useRoomEvents';

const state: RoomEventState = {
  type: 'roulette',
  participants: [{ participantId: 'p1', userName: 'Dai' }],
  winner: { participantId: 'p1', userName: 'Dai' },
  startedAt: Date.now(),
  expiresAt: Date.now() + 15 * 60 * 1000,
};

describe('EventTicker', () => {
  it('muestra el nombre de quien ganó', () => {
    render(<EventTicker state={state} onClose={jest.fn()} />);
    expect(screen.getByText(/Dai won the roulette/)).toBeInTheDocument();
  });

  it('el botón de cerrar llama a onClose', () => {
    const onClose = jest.fn();
    render(<EventTicker state={state} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

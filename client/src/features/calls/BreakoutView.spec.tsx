import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useLanguageStore } from '../translation/store';

jest.mock('@/lib/breakouts', () => ({
  returnFromBreakoutRoom: jest.fn(),
}));
jest.mock('./BreakoutHostConsole', () => ({
  BreakoutHostConsole: () => <div data-testid="host-console">host console</div>,
}));
jest.mock('./BreakoutSelfStatus', () => ({
  BreakoutSelfStatus: ({ onReturn }: { onReturn: () => void }) => (
    <div data-testid="self-status">
      self status
      <button type="button" onClick={onReturn}>
        Volver
      </button>
    </div>
  ),
}));

const roomCode = 'abc-defg-hij';
const roomToken = 'room-token';
const currentParticipantId = 'admin-sub';
const assignment = {
  breakoutId: 'breakout-1',
  label: 'Mini sala 1',
  leavePolicy: 'locked' as const,
};

function baseProps() {
  return {
    roomCode,
    roomToken,
    currentParticipantId,
    participants: [],
  };
}

// Decisión 5 (design.md "Frontend: un punto de montaje y un selector puro
// de 4 estados", tasks.md 5.4): único montaje -- nunca dos vistas de mini
// sala a la vez, en ningún estado de los cuatro.
describe('BreakoutView', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useLanguageStore.setState({ language: 'es' });
  });

  it('[5.4] guest-idle (no-admin, sin asignación): no renderiza ninguna vista de mini sala', async () => {
    const { BreakoutView } = await import('./BreakoutView');
    render(<BreakoutView {...baseProps()} isCurrentUserAdmin={false} assignment={null} />);

    expect(screen.queryByTestId('self-status')).toBeNull();
    expect(screen.queryByTestId('host-console')).toBeNull();
  });

  it('[5.4] guest-occupant (no-admin, con asignación): renderiza SOLO el estado propio', async () => {
    const { BreakoutView } = await import('./BreakoutView');
    render(<BreakoutView {...baseProps()} isCurrentUserAdmin={false} assignment={assignment} />);

    expect(screen.getByTestId('self-status')).toBeInTheDocument();
    expect(screen.queryByTestId('host-console')).toBeNull();
  });

  it('[5.4] host (admin, sin asignación): muestra el disparador del dock; al abrirlo, monta la consola y NUNCA el estado propio', async () => {
    const { BreakoutView } = await import('./BreakoutView');
    render(<BreakoutView {...baseProps()} isCurrentUserAdmin assignment={null} />);

    expect(screen.queryByTestId('self-status')).toBeNull();
    const trigger = screen.getByRole('button', { name: 'Mini salas' });
    await act(async () => {
      fireEvent.click(trigger);
    });

    expect(screen.getByTestId('host-console')).toBeInTheDocument();
    expect(screen.queryByTestId('self-status')).toBeNull();
  });

  it('[5.4] host-occupant (admin, con asignación): al abrir el dock, la consola Y la franja de estado propio aparecen DENTRO del mismo montaje', async () => {
    const { BreakoutView } = await import('./BreakoutView');
    render(<BreakoutView {...baseProps()} isCurrentUserAdmin assignment={assignment} />);

    const trigger = screen.getByRole('button', { name: 'Mini salas' });
    await act(async () => {
      fireEvent.click(trigger);
    });

    expect(screen.getByTestId('host-console')).toBeInTheDocument();
    expect(screen.getByTestId('self-status')).toBeInTheDocument();
  });

  it('host-occupant: la franja propia está visible sin abrir la consola', async () => {
    const { BreakoutView } = await import('./BreakoutView');
    render(<BreakoutView {...baseProps()} isCurrentUserAdmin assignment={assignment} />);

    expect(screen.getByTestId('self-status')).toBeInTheDocument();
    expect(screen.queryByTestId('host-console')).toBeNull();
  });

  it('[5.4] "Volver" en el estado propio llama returnFromBreakoutRoom con el breakoutId asignado', async () => {
    const { returnFromBreakoutRoom } = await import('@/lib/breakouts');
    const { BreakoutView } = await import('./BreakoutView');
    render(<BreakoutView {...baseProps()} isCurrentUserAdmin={false} assignment={assignment} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Volver' }));
    });

    expect(returnFromBreakoutRoom).toHaveBeenCalledWith(roomCode, roomToken, assignment.breakoutId);
  });
});

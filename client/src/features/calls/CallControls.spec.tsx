import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react';
import { CallControls } from './CallControls';
import { useLanguageStore } from '../translation/store';
import type { CallSessionState } from './useCallSession';

function buildState(overrides: Partial<CallSessionState> = {}): CallSessionState {
  return {
    status: 'idle',
    error: null,
    session: null,
    connected: jest.fn(),
    failed: jest.fn(),
    joinCall: jest.fn<CallSessionState['joinCall']>(),
    leaveCall: jest.fn<CallSessionState['leaveCall']>(),
    ...overrides,
  };
}

describe('CallControls', () => {
  beforeEach(() => {
    localStorage.clear();
    useLanguageStore.setState({ language: 'es' });
  });
  it('muestra el botón "Llamar" en estado idle y dispara joinCall con el código de sala', () => {
    const joinCall = jest.fn<CallSessionState['joinCall']>();
    render(
      <CallControls roomCode="ABC123" roomToken="room-token" session={buildState({ joinCall })} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Llamar' }));

    expect(joinCall).toHaveBeenCalledWith('ABC123', 'room-token');
  });

  it('muestra "Conectando..." mientras el status es connecting', () => {
    render(
      <CallControls
        roomCode="ABC123"
        roomToken="room-token"
        session={buildState({ status: 'connecting' })}
      />,
    );

    expect(screen.getByText('Conectando...')).toBeInTheDocument();
  });

  it('muestra el mensaje de error en estado error', () => {
    render(
      <CallControls
        roomCode="ABC123"
        roomToken="room-token"
        session={buildState({ status: 'error', error: 'No se pudo iniciar la llamada' })}
      />,
    );

    expect(screen.getByText('No se pudo iniciar la llamada')).toBeInTheDocument();
  });

  it('permite cancelar mientras LiveKit conecta', () => {
    const leaveCall = jest.fn<CallSessionState['leaveCall']>();
    render(
      <CallControls
        roomCode="ABC123"
        roomToken="token"
        session={buildState({ status: 'connecting', leaveCall })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(leaveCall).toHaveBeenCalledTimes(1);
  });
});

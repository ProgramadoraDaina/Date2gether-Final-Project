import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react';
import { CallControls } from './CallControls';
import { useLanguageStore } from '../translation/store';
import type { CallSessionState } from './useCallSession';

function buildState(overrides: Partial<CallSessionState> = {}): CallSessionState {
  return {
    status: 'idle',
    error: null,
    meetingSession: null,
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

  it('muestra el botón "Colgar" en estado in-call y dispara leaveCall al hacer click', () => {
    const leaveCall = jest.fn<CallSessionState['leaveCall']>();
    render(
      <CallControls
        roomCode="ABC123"
        roomToken="room-token"
        session={buildState({ status: 'in-call', leaveCall })}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Colgar' }));

    expect(leaveCall).toHaveBeenCalledTimes(1);
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
});

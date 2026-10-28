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

  it('no renderiza nada en estado idle: la conexión arranca sola al entrar a la sala', () => {
    const { container } = render(
      <CallControls roomCode="ABC123" roomToken="room-token" session={buildState()} />,
    );

    expect(container).toBeEmptyDOMElement();
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

  it('en estado error permite reintentar la conexión con el mismo código y token', () => {
    const joinCall = jest.fn<CallSessionState['joinCall']>();
    render(
      <CallControls
        roomCode="ABC123"
        roomToken="room-token"
        session={buildState({ status: 'error', error: 'No se pudo iniciar la llamada', joinCall })}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(joinCall).toHaveBeenCalledWith('ABC123', 'room-token');
  });

  it('no renderiza nada en estado in-call', () => {
    const { container } = render(
      <CallControls
        roomCode="ABC123"
        roomToken="room-token"
        session={buildState({ status: 'in-call' })}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});

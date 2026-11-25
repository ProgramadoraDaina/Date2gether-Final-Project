import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react';
import { BreakoutSelfStatus } from './BreakoutSelfStatus';
import { useLanguageStore } from '../translation/store';

describe('BreakoutSelfStatus', () => {
  beforeEach(() => {
    useLanguageStore.setState({ language: 'es' });
  });

  it('muestra la etiqueta de la mini sala', () => {
    render(
      <BreakoutSelfStatus
        assignment={{ breakoutId: 'breakout-1', label: 'Mini sala 1', leavePolicy: 'locked' }}
        onReturn={jest.fn()}
      />,
    );

    expect(screen.getByText('Mini sala 1')).toBeInTheDocument();
  });

  it('con política free_return muestra el botón "Volver" y lo invoca al click', () => {
    const onReturn = jest.fn();
    render(
      <BreakoutSelfStatus
        assignment={{ breakoutId: 'breakout-1', label: 'Mini sala 1', leavePolicy: 'free_return' }}
        onReturn={onReturn}
      />,
    );

    const button = screen.getByRole('button', { name: 'Volver' });
    fireEvent.click(button);

    expect(onReturn).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('El host te va a devolver a la sala principal.')).toBeNull();
  });

  it('con política locked no muestra el botón "Volver" y explica que el host va a devolver', () => {
    render(
      <BreakoutSelfStatus
        assignment={{ breakoutId: 'breakout-1', label: 'Mini sala 1', leavePolicy: 'locked' }}
        onReturn={jest.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Volver' })).toBeNull();
    expect(screen.getByText('El host te va a devolver a la sala principal.')).toBeInTheDocument();
  });

  it('deshabilita el botón "Volver" mientras la solicitud de retorno está en vuelo', () => {
    render(
      <BreakoutSelfStatus
        assignment={{ breakoutId: 'breakout-1', label: 'Mini sala 1', leavePolicy: 'free_return' }}
        onReturn={jest.fn()}
        returning
      />,
    );

    expect(screen.getByRole('button', { name: 'Volver' })).toBeDisabled();
  });

  it('con cuenta regresiva muestra arriba cuánto falta para volver a la principal', () => {
    const closesAt = new Date(Date.now() + 30_000).toISOString();
    render(
      <BreakoutSelfStatus
        assignment={{
          breakoutId: 'breakout-1',
          label: 'Mini sala 1',
          leavePolicy: 'locked',
          closesAt,
        }}
        onReturn={jest.fn()}
      />,
    );

    expect(screen.getByText('Volvés a la sala principal en')).toBeInTheDocument();
    expect(screen.getByRole('timer')).toHaveTextContent('00:30');
  });

  it('un admin ve "Volver" aunque la mini sala sea locked', () => {
    render(
      <BreakoutSelfStatus
        assignment={{ breakoutId: 'breakout-1', label: 'Mini sala 1', leavePolicy: 'locked' }}
        onReturn={jest.fn()}
        isAdmin
      />,
    );

    expect(screen.getByRole('button', { name: 'Volver' })).toBeInTheDocument();
    expect(screen.queryByText('El host te va a devolver a la sala principal.')).toBeNull();
  });
});

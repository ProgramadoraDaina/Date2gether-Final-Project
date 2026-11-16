import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react';
import { RoomEventButton } from './RoomEventButton';

// useTranslation() arranca en inglés por default en los tests (no hay
// localStorage que rehidrate el idioma antes del primer render, ver
// store.ts): se consulta por el texto traducido, no por la clave en español.
const participants = [
  { participantId: 'p1', userName: 'Ana' },
  { participantId: 'p2', userName: 'Beto' },
];

function openRoulettePicker() {
  fireEvent.click(screen.getByRole('button', { name: /Start an event/ }));
  fireEvent.click(screen.getByRole('menuitem', { name: /Roulette/ }));
}

describe('RoomEventButton', () => {
  it('no renderiza nada si quien mira no puede moderar la sala', () => {
    const { container } = render(
      <RoomEventButton canManage={false} participants={participants} onStartRoulette={jest.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('abre el menú y la ruleta trae a todos los participantes tildados por default', () => {
    render(
      <RoomEventButton canManage={true} participants={participants} onStartRoulette={jest.fn()} />,
    );

    openRoulettePicker();

    expect(screen.getByRole('checkbox', { name: 'Ana' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Beto' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Spin the wheel' })).toBeEnabled();
  });

  it('destildar a alguien y girar manda startRoulette solo con los que quedaron tildados', () => {
    const onStartRoulette = jest.fn();
    render(
      <RoomEventButton canManage={true} participants={participants} onStartRoulette={onStartRoulette} />,
    );
    openRoulettePicker();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Beto' }));
    fireEvent.click(screen.getByRole('button', { name: 'Spin the wheel' }));

    expect(onStartRoulette).toHaveBeenCalledWith(['p1']);
  });

  it('"Clear selection" destilda a todos y deshabilita "Spin the wheel"; "Select all" los vuelve a tildar', () => {
    render(
      <RoomEventButton canManage={true} participants={participants} onStartRoulette={jest.fn()} />,
    );
    openRoulettePicker();

    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(screen.getByRole('checkbox', { name: 'Ana' })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Spin the wheel' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
    expect(screen.getByRole('checkbox', { name: 'Ana' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Beto' })).toBeChecked();
  });

  it('sin nadie más en la sala, avisa y no deja girar', () => {
    render(<RoomEventButton canManage={true} participants={[]} onStartRoulette={jest.fn()} />);
    openRoulettePicker();

    expect(screen.getByText('There is no one else in the room yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Spin the wheel' })).toBeDisabled();
  });

  it('Cancel cierra el diálogo sin disparar la ruleta', () => {
    const onStartRoulette = jest.fn();
    render(
      <RoomEventButton canManage={true} participants={participants} onStartRoulette={onStartRoulette} />,
    );
    openRoulettePicker();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onStartRoulette).not.toHaveBeenCalled();
  });
});

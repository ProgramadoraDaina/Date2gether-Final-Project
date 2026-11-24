import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen, within } from '@testing-library/react';
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

function openPollDialog() {
  fireEvent.click(screen.getByRole('button', { name: /Start an event/ }));
  fireEvent.click(screen.getByRole('menuitem', { name: /Poll/ }));
}

describe('RoomEventButton', () => {
  it('no renderiza nada si quien mira no puede moderar la sala', () => {
    const { container } = render(
      <RoomEventButton
        canManage={false}
        participants={participants}
        onStartRoulette={jest.fn()}
        onStartPoll={jest.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  describe('ruleta', () => {
    it('abre el menú y la ruleta trae a todos los participantes tildados por default', () => {
      render(
        <RoomEventButton
          canManage={true}
          participants={participants}
          onStartRoulette={jest.fn()}
          onStartPoll={jest.fn()}
        />,
      );

      openRoulettePicker();

      expect(screen.getByRole('checkbox', { name: 'Ana' })).toBeChecked();
      expect(screen.getByRole('checkbox', { name: 'Beto' })).toBeChecked();
      expect(screen.getByRole('button', { name: 'Spin the wheel' })).toBeEnabled();
    });

    it('destildar a alguien y girar manda startRoulette solo con los que quedaron tildados', () => {
      const onStartRoulette = jest.fn();
      render(
        <RoomEventButton
          canManage={true}
          participants={participants}
          onStartRoulette={onStartRoulette}
          onStartPoll={jest.fn()}
        />,
      );
      openRoulettePicker();

      fireEvent.click(screen.getByRole('checkbox', { name: 'Beto' }));
      fireEvent.click(screen.getByRole('button', { name: 'Spin the wheel' }));

      expect(onStartRoulette).toHaveBeenCalledWith(['p1']);
    });

    it('"Clear selection" destilda a todos y deshabilita "Spin the wheel"; "Select all" los vuelve a tildar', () => {
      render(
        <RoomEventButton
          canManage={true}
          participants={participants}
          onStartRoulette={jest.fn()}
          onStartPoll={jest.fn()}
        />,
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
      render(
        <RoomEventButton
          canManage={true}
          participants={[]}
          onStartRoulette={jest.fn()}
          onStartPoll={jest.fn()}
        />,
      );
      openRoulettePicker();

      // Hay dos diálogos montados (ruleta + encuesta, ver RoomEventButton.tsx);
      // solo el que está showModal() cuenta como accesible, así que se
      // restringe la búsqueda a ese para no chocar con el mismo mensaje en
      // el diálogo de encuesta, también sin participantes.
      const dialog = screen.getByRole('dialog');
      expect(
        within(dialog).getByText('There is no one else in the room yet.'),
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Spin the wheel' })).toBeDisabled();
    });

    it('Cancel cierra el diálogo sin disparar la ruleta', () => {
      const onStartRoulette = jest.fn();
      render(
        <RoomEventButton
          canManage={true}
          participants={participants}
          onStartRoulette={onStartRoulette}
          onStartPoll={jest.fn()}
        />,
      );
      openRoulettePicker();

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(onStartRoulette).not.toHaveBeenCalled();
    });
  });

  describe('encuesta', () => {
    function fillPoll() {
      fireEvent.change(screen.getByLabelText('Question'), {
        target: { value: 'Pizza or sushi?' },
      });
      fireEvent.change(screen.getByLabelText('Option 1'), { target: { value: 'Pizza' } });
      fireEvent.change(screen.getByLabelText('Option 2'), { target: { value: 'Sushi' } });
    }

    it('crear encuesta queda deshabilitado hasta tener pregunta y 2 opciones', () => {
      render(
        <RoomEventButton
          canManage={true}
          participants={participants}
          onStartRoulette={jest.fn()}
          onStartPoll={jest.fn()}
        />,
      );
      openPollDialog();

      expect(screen.getByRole('button', { name: 'Create poll' })).toBeDisabled();

      fillPoll();

      expect(screen.getByRole('button', { name: 'Create poll' })).toBeEnabled();
    });

    it('crea la encuesta con la configuración elegida y a los participantes tildados', () => {
      const onStartPoll = jest.fn();
      render(
        <RoomEventButton
          canManage={true}
          participants={participants}
          onStartRoulette={jest.fn()}
          onStartPoll={onStartPoll}
        />,
      );
      openPollDialog();
      fillPoll();
      fireEvent.click(screen.getByRole('checkbox', { name: 'Allow choosing several options' }));
      fireEvent.click(screen.getByRole('checkbox', { name: 'Hide who voted for what' }));
      fireEvent.click(screen.getByRole('checkbox', { name: 'Beto' }));

      fireEvent.click(screen.getByRole('button', { name: 'Create poll' }));

      expect(onStartPoll).toHaveBeenCalledWith(['p1'], 'Pizza or sushi?', ['Pizza', 'Sushi'], {
        multipleChoice: true,
        anonymous: true,
      });
    });

    it('agregar y quitar opciones respeta el mínimo de 2', () => {
      render(
        <RoomEventButton
          canManage={true}
          participants={participants}
          onStartRoulette={jest.fn()}
          onStartPoll={jest.fn()}
        />,
      );
      openPollDialog();

      fireEvent.click(screen.getByRole('button', { name: /Add option/ }));
      expect(screen.getByLabelText('Option 3')).toBeInTheDocument();

      fireEvent.click(screen.getAllByRole('button', { name: 'Remove option' })[0]);
      fireEvent.click(screen.getAllByRole('button', { name: 'Remove option' })[0]);
      expect(screen.queryByLabelText('Option 3')).not.toBeInTheDocument();
      expect(screen.getAllByRole('button', { name: 'Remove option' })[0]).toBeDisabled();
    });

    it('opciones en blanco no cuentan para la validación', () => {
      render(
        <RoomEventButton
          canManage={true}
          participants={participants}
          onStartRoulette={jest.fn()}
          onStartPoll={jest.fn()}
        />,
      );
      openPollDialog();

      fireEvent.change(screen.getByLabelText('Question'), { target: { value: 'Pizza o sushi?' } });
      fireEvent.change(screen.getByLabelText('Option 1'), { target: { value: 'Pizza' } });

      expect(screen.getByRole('button', { name: 'Create poll' })).toBeDisabled();
    });
  });
});

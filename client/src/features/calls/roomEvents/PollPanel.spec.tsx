import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react';
import { PollPanel } from './PollPanel';
import type { PollEventState } from './useRoomEvents';

const baseState: PollEventState = {
  type: 'poll',
  question: 'Pizza or sushi?',
  options: ['Pizza', 'Sushi'],
  multipleChoice: false,
  anonymous: false,
  participants: [
    { participantId: 'p1', userName: 'Ana' },
    { participantId: 'p2', userName: 'Beto' },
  ],
  votes: { p1: [0] },
  closed: false,
  startedAt: Date.now(),
  expiresAt: Date.now() + 15 * 60 * 1000,
};

describe('PollPanel', () => {
  it('muestra la pregunta, las opciones con su conteo y quién votó (no anónima)', () => {
    render(
      <PollPanel
        state={baseState}
        currentParticipantId="p2"
        canManage={false}
        onVote={jest.fn()}
        onClose={jest.fn()}
      />,
    );

    expect(screen.getByText('Pizza or sushi?')).toBeInTheDocument();
    expect(screen.getByText('Pizza')).toBeInTheDocument();
    expect(screen.getByText('Sushi')).toBeInTheDocument();
    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.getByText(/1\/2/)).toBeInTheDocument();
  });

  it('muestra el porcentaje sobre quienes ya votaron, no el conteo crudo', () => {
    render(
      <PollPanel
        state={baseState}
        currentParticipantId="p2"
        canManage={false}
        onVote={jest.fn()}
        onClose={jest.fn()}
      />,
    );

    // Un solo voto emitido (p1 -> Pizza): Pizza es el 100% de los que
    // respondieron, Sushi el 0%, aunque solo haya 1 voto en total.
    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(screen.getByText('0%')).toBeInTheDocument();
  });

  it('con anonymous=true no muestra la lista de quién votó', () => {
    render(
      <PollPanel
        state={{ ...baseState, anonymous: true }}
        currentParticipantId="p2"
        canManage={false}
        onVote={jest.fn()}
        onClose={jest.fn()}
      />,
    );

    expect(screen.queryByText('Ana')).not.toBeInTheDocument();
  });

  it('single-choice: elegir una opción vota solo con ese índice', () => {
    const onVote = jest.fn();
    render(
      <PollPanel
        state={baseState}
        currentParticipantId="p2"
        canManage={false}
        onVote={onVote}
        onClose={jest.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('radio', { name: /Sushi/ }));

    expect(onVote).toHaveBeenCalledWith([1]);
  });

  it('single-choice: volver a elegir la misma opción retira el voto', () => {
    const onVote = jest.fn();
    render(
      <PollPanel
        state={baseState}
        currentParticipantId="p1"
        canManage={false}
        onVote={onVote}
        onClose={jest.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('radio', { name: /Pizza/ }));

    expect(onVote).toHaveBeenCalledWith([]);
  });

  it('multiple-choice: marcar una segunda opción la agrega sin perder la primera', () => {
    const onVote = jest.fn();
    const state: PollEventState = { ...baseState, multipleChoice: true };
    render(
      <PollPanel
        state={state}
        currentParticipantId="p1"
        canManage={false}
        onVote={onVote}
        onClose={jest.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('checkbox', { name: /Sushi/ }));

    expect(onVote).toHaveBeenCalledWith([0, 1]);
  });

  it('si la encuesta está cerrada, las opciones no son clickeables y se avisa', () => {
    const onVote = jest.fn();
    render(
      <PollPanel
        state={{ ...baseState, closed: true }}
        currentParticipantId="p2"
        canManage={false}
        onVote={onVote}
        onClose={jest.fn()}
      />,
    );

    expect(screen.getByText('Poll closed')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: /Sushi/ }));
    expect(onVote).not.toHaveBeenCalled();
  });

  it('quien no participa de la encuesta no puede votar', () => {
    const onVote = jest.fn();
    render(
      <PollPanel
        state={baseState}
        currentParticipantId="p3"
        canManage={false}
        onVote={onVote}
        onClose={jest.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('radio', { name: /Sushi/ }));
    expect(onVote).not.toHaveBeenCalled();
  });

  it('destaca el indicador cuando todos ya votaron', () => {
    const state: PollEventState = { ...baseState, votes: { p1: [0], p2: [1] } };
    render(
      <PollPanel
        state={state}
        currentParticipantId="p1"
        canManage={false}
        onVote={jest.fn()}
        onClose={jest.fn()}
      />,
    );

    expect(screen.getByText(/2\/2/)).toBeInTheDocument();
  });

  it('el botón de cerrar panel llama a onClose', () => {
    const onClose = jest.fn();
    render(
      <PollPanel
        state={baseState}
        currentParticipantId="p1"
        canManage={false}
        onVote={jest.fn()}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('canManage muestra "Cerrar encuesta" y llama a onClosePoll', () => {
    const onClosePoll = jest.fn();
    render(
      <PollPanel
        state={baseState}
        currentParticipantId="p1"
        canManage={true}
        onVote={jest.fn()}
        onClose={jest.fn()}
        onClosePoll={onClosePoll}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Close poll' }));

    expect(onClosePoll).toHaveBeenCalledTimes(1);
  });

  it('sin canManage no muestra "Cerrar encuesta"', () => {
    render(
      <PollPanel
        state={baseState}
        currentParticipantId="p1"
        canManage={false}
        onVote={jest.fn()}
        onClose={jest.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Close poll' })).not.toBeInTheDocument();
  });
});

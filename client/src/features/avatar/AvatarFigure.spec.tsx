import { describe, expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { AvatarFigure } from './AvatarFigure';
import type { Avatar } from './catalog';

describe('AvatarFigure', () => {
  it('marca que habla solo cuando la persona está hablando', () => {
    const avatar: Avatar = { head: ['cap'], face: ['mustache'], sticker: true };
    const { rerender } = render(<AvatarFigure avatar={avatar} />);
    const figure = screen.getByTestId('avatar-figure');
    expect(figure).toHaveAttribute('data-animated');
    expect(figure).not.toHaveAttribute('data-speaking');

    rerender(<AvatarFigure avatar={avatar} speaking />);
    expect(figure).toHaveAttribute('data-speaking');
  });

  it('la capa trasera de una pieza va detrás de la silueta y el resto adelante', () => {
    const { container } = render(<AvatarFigure avatar={{ neck: 'strange', sticker: false }} />);
    const svg = container.querySelector('svg')!;
    const back = svg.querySelector('[data-layer="back"]')!;
    const front = svg.querySelector('[data-layer="svg"]')!;
    const silhouette = svg.querySelector('circle[r="56"]:not(clipPath circle)')!;

    expect(
      back.compareDocumentPosition(silhouette) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      silhouette.compareDocumentPosition(front) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('dibuja el borde sticker solo si la persona lo eligió', () => {
    const { container, rerender } = render(
      <AvatarFigure avatar={{ head: ['crown'], sticker: true }} />,
    );
    expect(container.querySelectorAll('[data-slot="head"] g g')).toHaveLength(2);

    rerender(<AvatarFigure avatar={{ head: ['crown'], sticker: false }} />);
    expect(container.querySelectorAll('[data-slot="head"] g g')).toHaveLength(1);
  });

  it('también dibuja el borde sticker para la ropa', () => {
    const { container, rerender } = render(
      <AvatarFigure avatar={{ body: ['blouse'], sticker: true }} />,
    );
    expect(container.querySelectorAll('[data-slot="body"] g g')).toHaveLength(2);

    rerender(<AvatarFigure avatar={{ body: ['blouse'], sticker: false }} />);
    expect(container.querySelectorAll('[data-slot="body"] g g')).toHaveLength(1);
  });

  it('apila varias piezas del mismo slot, en orden, cuando se eligen a la vez', () => {
    const { container } = render(
      <AvatarFigure avatar={{ head: ['crown', 'tiara'], sticker: false }} />,
    );
    const headPieces = container.querySelectorAll('[data-slot="head"]');
    expect(headPieces).toHaveLength(2);
    expect(headPieces[0]).toHaveAttribute('data-piece', 'crown');
    expect(headPieces[1]).toHaveAttribute('data-piece', 'tiara');
  });

  it('dibuja el backSvg de cada pieza de cabeza que lo tenga, en orden, antes de la silueta', () => {
    const { container } = render(
      <AvatarFigure avatar={{ head: ['hairShort', 'hairLong'], sticker: false }} />,
    );
    const backLayers = container.querySelectorAll('[data-slot="head-back"]');
    expect(backLayers).toHaveLength(2);
  });
});

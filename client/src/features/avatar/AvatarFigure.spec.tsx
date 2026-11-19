import { describe, expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { AvatarFigure } from './AvatarFigure';

describe('AvatarFigure', () => {
  it('marca que habla solo cuando la persona está hablando', () => {
    const avatar = { head: 'cap' as const, face: 'mustache' as const, sticker: true };
    const { rerender } = render(<AvatarFigure avatar={avatar} />);
    const figure = screen.getByTestId('avatar-figure');
    expect(figure).toHaveAttribute('data-animated');
    expect(figure).not.toHaveAttribute('data-speaking');

    rerender(<AvatarFigure avatar={avatar} speaking />);
    expect(figure).toHaveAttribute('data-speaking');
  });

  it('dibuja el borde sticker solo si la persona lo eligió', () => {
    const { container, rerender } = render(
      <AvatarFigure avatar={{ head: 'crown', sticker: true }} />,
    );
    expect(container.querySelectorAll('[data-slot="head"] g g')).toHaveLength(2);

    rerender(<AvatarFigure avatar={{ head: 'crown', sticker: false }} />);
    expect(container.querySelectorAll('[data-slot="head"] g g')).toHaveLength(1);
  });
});

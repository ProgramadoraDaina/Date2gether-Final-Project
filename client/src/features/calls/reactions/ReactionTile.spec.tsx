import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react';

const trackRef = { participant: { identity: 'ana' }, source: 'camera' };
let pinned: unknown[] = [];

jest.mock('@livekit/components-react', () => ({
  ParticipantTile: () => <div>Video participante</div>,
  useMaybeTrackRefContext: () => trackRef,
  useMaybeLayoutContext: () => ({ pin: { dispatch: jest.fn() } }),
  usePinnedTracks: () => pinned,
}));
jest.mock('../../translation/useTranslation', () => {
  const t = (key: string) => key;
  return { useTranslation: () => ({ t }) };
});
jest.mock('./useReactions', () => ({
  useReactions: () => ({ reactions: [], stickers: {} }),
}));

describe('ReactionTile', () => {
  it('no muestra el botón de foco cuando hay un solo video', async () => {
    pinned = [];
    const { ReactionTile } = await import('./ReactionTile');
    render(<ReactionTile canFocus={false} />);

    expect(screen.queryByRole('button', { name: 'Poner en foco' })).not.toBeInTheDocument();
  });

  it('muestra el botón de foco cuando hay más de un video', async () => {
    pinned = [];
    const { ReactionTile } = await import('./ReactionTile');
    render(<ReactionTile canFocus />);

    expect(screen.getByRole('button', { name: 'Poner en foco' })).toBeInTheDocument();
  });

  it('deja quitar el foco aunque ya no quede nadie más', async () => {
    pinned = [trackRef];
    const { ReactionTile } = await import('./ReactionTile');
    render(<ReactionTile canFocus={false} />);

    expect(screen.getByRole('button', { name: 'Quitar de foco' })).toBeInTheDocument();
  });
});

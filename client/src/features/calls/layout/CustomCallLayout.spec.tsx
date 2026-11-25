import { describe, expect, it, jest } from '@jest/globals';
import { render, screen, within } from '@testing-library/react';
import type { TrackReferenceOrPlaceholder } from '@livekit/components-react';
import type { LayoutZone } from './layout';

jest.mock('@/features/translation/useTranslation', () => {
  const t = (key: string) => key;
  return { useTranslation: () => ({ t }) };
});
jest.mock('@livekit/components-react', () => {
  const { createContext, useContext } = jest.requireActual<typeof import('react')>('react');
  const TrackRefContext = createContext<{ participant: { identity: string } } | undefined>(
    undefined,
  );
  return {
    TrackRefContext,
    useMaybeTrackRefContext: () => useContext(TrackRefContext),
  };
});
jest.mock('../reactions/ReactionTile', () => {
  const { useMaybeTrackRefContext } = jest.requireMock<{
    useMaybeTrackRefContext: () => { participant: { identity: string } } | undefined;
  }>('@livekit/components-react');
  return {
    ReactionTile: () => <span>{useMaybeTrackRefContext()?.participant.identity}</span>,
  };
});

function track(identity: string, source = 'camera') {
  return { participant: { identity }, source } as unknown as TrackReferenceOrPlaceholder;
}

function zone(id: string, capacity: number, overrides: Partial<LayoutZone> = {}): LayoutZone {
  return {
    id,
    capacity,
    placement: 'bottom',
    width: 100,
    height: 30,
    tileSize: 160,
    aspect: '16:9',
    ...overrides,
  };
}

describe('CustomCallLayout', () => {
  it('pone a cada persona en su zona, con el tamaño y la forma de esa zona', async () => {
    const { CustomCallLayout } = await import('./CustomCallLayout');
    render(
      <CustomCallLayout
        tracks={[track('santi'), track('gabi'), track('daina'), track('joni')]}
        zones={[
          zone('big', 1, { tileSize: 480 }),
          zone('small', 2, { tileSize: 90, aspect: '1:1' }),
        ]}
      />,
    );

    const [big, small] = screen.getAllByTestId('layout-zone');
    expect(within(big).getByText('santi')).toBeInTheDocument();
    expect(
      within(small)
        .getAllByTestId('layout-tile')
        .map((t) => t.textContent),
    ).toEqual(['gabi', 'daina', 'joni']);
    const tile = within(small).getAllByTestId('layout-tile')[0];
    expect(tile).toHaveStyle({ width: '90px', aspectRatio: '1 / 1' });
  });

  it('una pantalla compartida entra primero, a la zona más importante', async () => {
    const { CustomCallLayout } = await import('./CustomCallLayout');
    render(
      <CustomCallLayout
        tracks={[track('santi'), track('gabi-screen', 'screen_share')]}
        zones={[zone('big', 1), zone('small', 4)]}
      />,
    );
    const [big] = screen.getAllByTestId('layout-zone');
    expect(within(big).getByText('gabi-screen')).toBeInTheDocument();
  });

  it('mientras se edita, cada zona muestra su número y cuántos ocupan sus lugares', async () => {
    const { CustomCallLayout } = await import('./CustomCallLayout');
    const props = {
      tracks: [track('santi'), track('gabi'), track('daina'), track('joni')],
      zones: [zone('big', 1), zone('mid', 2), zone('small', 5)],
    };
    const { rerender } = render(<CustomCallLayout {...props} />);
    expect(screen.queryByText(/^Zona 1/)).not.toBeInTheDocument();

    rerender(<CustomCallLayout {...props} editing />);
    const [big, mid, small] = screen.getAllByTestId('layout-zone');
    expect(within(big).getByText('Zona 1 · 1/1')).toBeInTheDocument();
    expect(within(mid).getByText('Zona 2 · 2/2')).toBeInTheDocument();
    expect(within(small).getByText('Zona 3 · 1/5')).toBeInTheDocument();
    expect(screen.getByTestId('layout-stage')).toHaveAttribute('data-editing', 'true');
  });
});

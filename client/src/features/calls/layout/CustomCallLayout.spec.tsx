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

// jsdom has no layout: every measured zone reports 1000x500.
class FakeResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element) {
    this.callback(
      [{ target, contentRect: { width: 1000, height: 500 } } as unknown as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
  disconnect() {}
}
globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;

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
    scale: 100,
    aspect: '16:9',
    ...overrides,
  };
}

describe('CustomCallLayout', () => {
  it('pone a cada persona en su zona y las cámaras llenan el espacio de esa zona', async () => {
    const { CustomCallLayout } = await import('./CustomCallLayout');
    render(
      <CustomCallLayout
        tracks={[track('santi'), track('gabi'), track('daina'), track('joni')]}
        zones={[zone('big', 1), zone('small', 2, { aspect: '1:1' })]}
      />,
    );

    const [big, small] = screen.getAllByTestId('layout-zone');
    expect(within(big).getByText('santi')).toBeInTheDocument();
    expect(
      within(small)
        .getAllByTestId('layout-tile')
        .map((t) => t.textContent),
    ).toEqual(['gabi', 'daina', 'joni']);
    // 1 wide camera in 1000x500 is limited by the height: 500 * 16/9.
    expect(within(big).getByTestId('layout-tile')).toHaveStyle({ width: '888px' });
    // 3 squares in 1000x500 fit best in one row: (1000 - 2 gaps of 6) / 3.
    expect(within(small).getAllByTestId('layout-tile')[0]).toHaveStyle({
      width: '329px',
      aspectRatio: '1 / 1',
    });
  });

  it('el tamaño en % achica las cámaras de esa zona', async () => {
    const { CustomCallLayout } = await import('./CustomCallLayout');
    render(<CustomCallLayout tracks={[track('santi')]} zones={[zone('big', 1, { scale: 50 })]} />);
    expect(screen.getByTestId('layout-tile')).toHaveStyle({ width: '444px' });
  });

  it('las cámaras se recortan a la forma elegida, pero una pantalla compartida se ve entera', async () => {
    const { CustomCallLayout } = await import('./CustomCallLayout');
    render(
      <CustomCallLayout
        tracks={[track('santi'), track('gabi-screen', 'screen_share')]}
        zones={[zone('big', 2)]}
      />,
    );
    const [screenTile, camTile] = screen.getAllByTestId('layout-tile');
    expect(screenTile).toHaveAttribute('data-fit', 'contain');
    expect(camTile).toHaveAttribute('data-fit', 'cover');
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

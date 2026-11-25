import { describe, expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { buildLayoutTree, type LayoutZone, type ZonePlacement } from './layout';
import { LayoutView } from './LayoutView';

function zone(id: string, placement: ZonePlacement, width = 100, height = 30): LayoutZone {
  return { id, capacity: 1, placement, width, height, tileSize: 160, aspect: '16:9' };
}

function renderTree(zones: LayoutZone[]) {
  render(<LayoutView tree={buildLayoutTree(zones)!} renderZone={(z) => z.id} />);
}

describe('LayoutView', () => {
  it('la zona nueva usa su tamaño y la otra ocupa el resto estirándose', () => {
    renderTree([zone('a', 'bottom'), zone('b', 'bottom', 100, 30)]);
    expect(screen.getByText('a')).toHaveStyle({ flex: '1 1 0', alignSelf: 'stretch' });
    expect(screen.getByText('b')).toHaveStyle({ flex: '0 1 30%' });
  });

  it('al poner otra zona al lado, la zona anterior conserva su tamaño', () => {
    renderTree([
      zone('a', 'bottom'),
      zone('b', 'bottom', 100, 30),
      zone('c', 'beside-previous', 30),
    ]);
    const pair = screen.getByText('b').parentElement!;
    expect(pair).toHaveStyle({ flex: '0 1 30%', flexDirection: 'row' });
    expect(screen.getByText('c')).toHaveStyle({ flex: '0 1 30%' });
  });

  it('el otro lado nunca queda en cero aunque la zona pida 100%', () => {
    renderTree([zone('a', 'bottom'), zone('b', 'right', 100, 100)]);
    expect(screen.getByText('b')).toHaveStyle({ flex: '0 1 90%' });
  });
});

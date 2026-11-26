export type ZonePlacement =
  'beside-previous' | 'below-previous' | 'left' | 'right' | 'top' | 'bottom';

export type TileAspect = '16:9' | '4:3' | '1:1' | '9:16';

export interface LayoutZone {
  id: string;
  capacity: number;
  placement: ZonePlacement;
  // Percent of the space the zone is placed into.
  width: number;
  height: number;
  // Percent of the largest tile size that fits the zone.
  scale: number;
  aspect: TileAspect;
}

export const TILE_GAP = 6;

// Largest tile width that fits `count` tiles of this aspect in the zone, trying every column count.
export function fitTiles(
  size: { width: number; height: number },
  count: number,
  aspect: TileAspect,
  scale: number,
  gap = TILE_GAP,
): { width: number } | null {
  if (count <= 0 || size.width <= 0 || size.height <= 0) return null;
  const [w, h] = aspect.split(':').map(Number);
  const ratio = w / h;
  let best = 0;
  for (let columns = 1; columns <= count; columns++) {
    const rows = Math.ceil(count / columns);
    const byWidth = (size.width - gap * (columns - 1)) / columns;
    const byHeight = ((size.height - gap * (rows - 1)) / rows) * ratio;
    best = Math.max(best, Math.min(byWidth, byHeight));
  }
  return { width: Math.floor((best * scale) / 100) };
}

export type LayoutNode =
  | { kind: 'zone'; zone: LayoutZone }
  | {
      kind: 'split';
      direction: 'row' | 'column';
      // Index of the child that keeps its own size; the other one fills the rest.
      sized: 0 | 1;
      children: [LayoutNode, LayoutNode];
    };

function replaceZone(
  node: LayoutNode,
  id: string,
  replace: (leaf: LayoutNode) => LayoutNode,
): LayoutNode {
  if (node.kind === 'zone') return node.zone.id === id ? replace(node) : node;
  return {
    ...node,
    children: [
      replaceZone(node.children[0], id, replace),
      replaceZone(node.children[1], id, replace),
    ],
  };
}

export function buildLayoutTree(zones: readonly LayoutZone[]): LayoutNode | null {
  if (zones.length === 0) return null;
  let root: LayoutNode = { kind: 'zone', zone: zones[0] };
  for (let i = 1; i < zones.length; i++) {
    const leaf: LayoutNode = { kind: 'zone', zone: zones[i] };
    const { placement } = zones[i];
    if (placement === 'beside-previous' || placement === 'below-previous') {
      const direction = placement === 'beside-previous' ? 'row' : 'column';
      root = replaceZone(root, zones[i - 1].id, (previous) => ({
        kind: 'split',
        direction,
        sized: 1,
        children: [previous, leaf],
      }));
    } else {
      const direction = placement === 'left' || placement === 'right' ? 'row' : 'column';
      const before = placement === 'left' || placement === 'top';
      root = {
        kind: 'split',
        direction,
        sized: before ? 0 : 1,
        children: before ? [leaf, root] : [root, leaf],
      };
    }
  }
  return root;
}

interface OrderableTrack {
  source: string;
  participant: { isLocal?: boolean };
}

// Pantallas compartidas primero, después tu cámara: así quedás siempre en la Zona 1.
export function orderForZones<T extends OrderableTrack>(tracks: readonly T[]): T[] {
  const rank = (track: T) =>
    track.source === 'screen_share' ? 0 : track.participant.isLocal ? 1 : 2;
  return [...tracks].sort((a, b) => rank(a) - rank(b));
}

// Zonas que reciben al menos una persona: las vacías no ocupan lugar y su espacio se reparte.
export function zonesInUse(zones: readonly LayoutZone[], count: number): LayoutZone[] {
  let seated = 0;
  let used = 0;
  while (used < zones.length && (used === 0 || seated < count)) {
    seated += zones[used].capacity;
    used++;
  }
  return zones.slice(0, used);
}

export function assignToZones<T>(zones: readonly LayoutZone[], items: readonly T[]): T[][] {
  const groups: T[][] = [];
  let next = 0;
  zones.forEach((zone, index) => {
    const end = index === zones.length - 1 ? items.length : next + zone.capacity;
    groups.push(items.slice(next, end));
    next = Math.min(end, items.length);
  });
  return groups;
}

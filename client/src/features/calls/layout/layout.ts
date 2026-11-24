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
  // Camera tile width in px.
  tileSize: number;
  aspect: TileAspect;
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

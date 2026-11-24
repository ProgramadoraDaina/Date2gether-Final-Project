import { describe, expect, it } from '@jest/globals';
import { assignToZones, buildLayoutTree, type LayoutZone, type ZonePlacement } from './layout';

function zone(id: string, placement: ZonePlacement = 'bottom', capacity = 1): LayoutZone {
  return { id, capacity, placement, width: 30, height: 40, tileSize: 160, aspect: '16:9' };
}

describe('buildLayoutTree', () => {
  it('sin zonas no hay distribución', () => {
    expect(buildLayoutTree([])).toBeNull();
  });

  it('la primera zona ocupa todo, ignora su posición', () => {
    expect(buildLayoutTree([zone('a', 'left')])).toEqual({ kind: 'zone', zone: zone('a', 'left') });
  });

  it.each([
    ['left', 'row', ['b', 'a'], 0],
    ['right', 'row', ['a', 'b'], 1],
    ['top', 'column', ['b', 'a'], 0],
    ['bottom', 'column', ['a', 'b'], 1],
  ] as const)(
    '%s acopla la zona nueva contra todo lo anterior',
    (placement, direction, order, sized) => {
      const tree = buildLayoutTree([zone('a'), zone('b', placement)]);
      expect(tree).toMatchObject({ kind: 'split', direction, sized });
      if (tree?.kind !== 'split') throw new Error('expected split');
      expect(tree.children.map((c) => (c.kind === 'zone' ? c.zone.id : 'split'))).toEqual(order);
    },
  );

  it('al lado del anterior divide solo la zona anterior, no todo el bloque', () => {
    const tree = buildLayoutTree([zone('a'), zone('b', 'bottom'), zone('c', 'beside-previous')]);
    expect(tree).toMatchObject({
      kind: 'split',
      direction: 'column',
      children: [
        { kind: 'zone', zone: { id: 'a' } },
        {
          kind: 'split',
          direction: 'row',
          sized: 1,
          children: [
            { kind: 'zone', zone: { id: 'b' } },
            { kind: 'zone', zone: { id: 'c' } },
          ],
        },
      ],
    });
  });

  it('abajo del anterior divide la zona anterior en columna', () => {
    const tree = buildLayoutTree([zone('a'), zone('b', 'right'), zone('c', 'below-previous')]);
    expect(tree).toMatchObject({
      direction: 'row',
      children: [{ zone: { id: 'a' } }, { direction: 'column', sized: 1 }],
    });
  });
});

describe('assignToZones', () => {
  const people = Array.from({ length: 19 }, (_, i) => `p${i}`);

  it('reparte en orden según la cantidad de cada zona (1 grande, 3, 5, 10)', () => {
    const zones = [
      zone('a', 'left', 1),
      zone('b', 'bottom', 3),
      zone('c', 'right', 5),
      zone('d', 'top', 10),
    ];
    const groups = assignToZones(zones, people);
    expect(groups.map((g) => g.length)).toEqual([1, 3, 5, 10]);
    expect(groups[0]).toEqual(['p0']);
    expect(groups[1]).toEqual(['p1', 'p2', 'p3']);
  });

  it('lo que no entra va a la última zona: nadie queda afuera', () => {
    const groups = assignToZones(
      [zone('a', 'left', 1), zone('b', 'bottom', 2)],
      people.slice(0, 6),
    );
    expect(groups).toEqual([['p0'], ['p1', 'p2', 'p3', 'p4', 'p5']]);
  });

  it('con menos gente que lugares, las zonas sobrantes quedan vacías', () => {
    expect(assignToZones([zone('a', 'left', 2), zone('b', 'bottom', 2)], ['p0'])).toEqual([
      ['p0'],
      [],
    ]);
  });
});

import { describe, expect, it } from '@jest/globals';
import {
  assignToZones,
  buildLayoutTree,
  fitTiles,
  zonesInUse,
  type LayoutZone,
  type ZonePlacement,
} from './layout';

describe('fitTiles', () => {
  it('una sola cámara 16:9 llena la zona hasta tocar el lado que limita', () => {
    expect(fitTiles({ width: 1600, height: 1000 }, 1, '16:9', 100)).toEqual({ width: 1600 });
    expect(fitTiles({ width: 1600, height: 450 }, 1, '16:9', 100)).toEqual({ width: 800 });
  });

  it('elige filas y columnas que dejan las cámaras lo más grandes posible', () => {
    // 4 squares in a wide zone fit best as one row.
    expect(fitTiles({ width: 1000, height: 260 }, 4, '1:1', 100, 0)).toEqual({ width: 250 });
    // 4 squares in a square zone fit best as 2x2.
    expect(fitTiles({ width: 500, height: 500 }, 4, '1:1', 100, 0)).toEqual({ width: 250 });
  });

  it('descuenta el espacio entre cámaras', () => {
    expect(fitTiles({ width: 506, height: 250 }, 2, '1:1', 100, 6)).toEqual({ width: 250 });
  });

  it('el tamaño en % achica las cámaras respecto del máximo que entra', () => {
    expect(fitTiles({ width: 1600, height: 1000 }, 1, '16:9', 50)).toEqual({ width: 800 });
  });

  it('sin gente o sin medida todavía no calcula nada', () => {
    expect(fitTiles({ width: 0, height: 0 }, 3, '16:9', 100)).toBeNull();
    expect(fitTiles({ width: 800, height: 600 }, 0, '16:9', 100)).toBeNull();
  });
});

function zone(id: string, placement: ZonePlacement = 'bottom', capacity = 1): LayoutZone {
  return { id, capacity, placement, width: 30, height: 40, scale: 100, aspect: '16:9' };
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

describe('zonesInUse', () => {
  const zone = (id: string, capacity: number) =>
    ({
      id,
      capacity,
      placement: 'bottom',
      width: 100,
      height: 30,
      scale: 100,
      aspect: '16:9',
    }) as const;
  const party = [zone('centro', 1), zone('abajo', 2), zone('derecha', 3)];
  const ids = (count: number) => zonesInUse(party, count).map((z) => z.id);

  it('solo: una zona que ocupa todo', () => {
    expect(ids(1)).toEqual(['centro']);
  });

  it('de 2 a 3 personas: centro y abajo', () => {
    expect(ids(2)).toEqual(['centro', 'abajo']);
    expect(ids(3)).toEqual(['centro', 'abajo']);
  });

  it('desde 4 personas aparece la zona de la derecha', () => {
    expect(ids(4)).toEqual(['centro', 'abajo', 'derecha']);
    expect(ids(6)).toEqual(['centro', 'abajo', 'derecha']);
  });

  it('sin nadie todavía se muestra la primera zona', () => {
    expect(ids(0)).toEqual(['centro']);
  });
});

describe('zonesInUse con todas las combinaciones', () => {
  const PLACEMENTS = [
    'beside-previous',
    'below-previous',
    'left',
    'right',
    'top',
    'bottom',
  ] as const;

  function* configs(): Generator<LayoutZone[]> {
    for (let count = 1; count <= 4; count++) {
      const total = PLACEMENTS.length ** (count - 1) * 3 ** count;
      for (let n = 0; n < total; n++) {
        let rest = n;
        const zones: LayoutZone[] = [];
        for (let i = 0; i < count; i++) {
          const capacity = (rest % 3) + 1;
          rest = Math.floor(rest / 3);
          const placement = i === 0 ? 'bottom' : PLACEMENTS[rest % PLACEMENTS.length];
          if (i > 0) rest = Math.floor(rest / PLACEMENTS.length);
          zones.push({
            id: `z${i}`,
            capacity,
            placement,
            width: 30,
            height: 30,
            scale: 100,
            aspect: '16:9',
          });
        }
        yield zones;
      }
    }
  }

  it('nadie queda afuera, ninguna zona visible queda vacía y la pantalla siempre se arma', () => {
    let checked = 0;
    for (const zones of configs()) {
      for (let people = 0; people <= 12; people++) {
        const shown = zonesInUse(zones, people);
        const groups = assignToZones(
          shown,
          Array.from({ length: people }, (_, i) => i),
        );
        expect(shown.length).toBeGreaterThan(0);
        expect(shown).toEqual(zones.slice(0, shown.length));
        expect(groups.flat()).toHaveLength(people);
        if (people > 0) for (const group of groups) expect(group.length).toBeGreaterThan(0);
        expect(buildLayoutTree(shown)).not.toBeNull();
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(100_000);
  });
});

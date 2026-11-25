import { describe, expect, it } from '@jest/globals';
import { resolveBreakoutViewState } from './breakoutViewState';

const assignment = { breakoutId: 'breakout-1', label: 'Mini sala 1', leavePolicy: 'locked' as const };

// Decisión 5 (design.md "Frontend: un punto de montaje y un selector puro
// de 4 estados", tasks.md 5.1): puro, sin React -- la matriz de 4 estados
// se testea sin renderizar nada.
describe('resolveBreakoutViewState', () => {
  it('[5.1] no-admin sin asignación -> guest-idle', () => {
    expect(resolveBreakoutViewState({ isAdmin: false, assignment: null })).toBe('guest-idle');
  });

  it('[5.1] no-admin con asignación -> guest-occupant', () => {
    expect(resolveBreakoutViewState({ isAdmin: false, assignment })).toBe('guest-occupant');
  });

  it('[5.1] admin sin asignación -> host', () => {
    expect(resolveBreakoutViewState({ isAdmin: true, assignment: null })).toBe('host');
  });

  it('[5.1] admin con asignación -> host-occupant', () => {
    expect(resolveBreakoutViewState({ isAdmin: true, assignment })).toBe('host-occupant');
  });

  it('[5.1] exhaustivo: cada una de las 4 combinaciones produce un estado distinto', () => {
    const results = new Set([
      resolveBreakoutViewState({ isAdmin: false, assignment: null }),
      resolveBreakoutViewState({ isAdmin: false, assignment }),
      resolveBreakoutViewState({ isAdmin: true, assignment: null }),
      resolveBreakoutViewState({ isAdmin: true, assignment }),
    ]);
    expect(results.size).toBe(4);
  });
});

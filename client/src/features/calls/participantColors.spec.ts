import { describe, expect, it } from '@jest/globals';
import { NAME_COLOR_HEX } from '@/lib/nameColors';
import { colorForIdentity } from './participantColors';

describe('colorForIdentity', () => {
  it('usa el color que eligió la persona', () => {
    expect(colorForIdentity('ana', { ana: NAME_COLOR_HEX.teal })).toBe(NAME_COLOR_HEX.teal);
  });

  it('sin color elegido, la misma identity siempre recibe el mismo color de la paleta', () => {
    const first = colorForIdentity('invitado-1', {});
    expect(Object.values(NAME_COLOR_HEX)).toContain(first);
    expect(colorForIdentity('invitado-1', {})).toBe(first);
  });
});

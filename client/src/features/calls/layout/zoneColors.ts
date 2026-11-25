import type { CSSProperties } from 'react';
import { NAME_COLOR_HEX, type NameColorId } from '@/lib/nameColors';

// Same palette as participant name colors, ordered so neighbouring zones contrast.
const ORDER: NameColorId[] = ['purple', 'teal', 'amber', 'pink', 'green', 'navy', 'orange', 'red'];
const DARK_TEXT = new Set<NameColorId>(['amber', 'green', 'orange']);

export function zoneColorStyle(index: number): CSSProperties {
  const id = ORDER[index % ORDER.length];
  return {
    '--zone-color': NAME_COLOR_HEX[id],
    '--zone-text': DARK_TEXT.has(id) ? '#15171c' : '#ffffff',
  } as CSSProperties;
}

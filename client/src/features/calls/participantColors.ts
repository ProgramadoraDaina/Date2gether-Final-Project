import { createContext, useContext } from 'react';
import { NAME_COLOR_HEX, NAME_COLOR_IDS } from '@/lib/nameColors';

// Identity de LiveKit (participantId de la presencia) -> color de nombre en hex.
export type ParticipantColors = Record<string, string>;

export const ParticipantColorsContext = createContext<ParticipantColors>({});

// Sin color elegido, la misma identity siempre cae en el mismo color de la paleta.
export function colorForIdentity(identity: string, colors: ParticipantColors): string {
  const chosen = colors[identity];
  if (chosen) return chosen;
  let hash = 0;
  for (const char of identity) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return NAME_COLOR_HEX[NAME_COLOR_IDS[hash % NAME_COLOR_IDS.length]];
}

export function useParticipantColor(identity: string): string {
  return colorForIdentity(identity, useContext(ParticipantColorsContext));
}

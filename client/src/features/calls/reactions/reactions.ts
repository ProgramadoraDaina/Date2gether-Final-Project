import type { BurstPlan } from './burstEffects';

export const REACTIONS_TOPIC = 'reactions';

export const REACTION_EMOJIS = ['💖', '👍', '🎉', '👏', '😂', '😮', '😢', '🤔'] as const;

export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];

export interface Reaction {
  id: string;
  emoji: ReactionEmoji;
  identity: string;
  name: string;
  at: number;
  // Ya formó parte de una explosión: deja de flotar, pero sigue en el tile de quien la mandó.
  exploded: boolean;
}

export interface ReactionBurst {
  id: string;
  plan: BurstPlan;
}

export const REACTION_LIFETIME_MS = 4000;
export const BURST_THRESHOLD = 6;
export const BURST_WINDOW_MS = 2000;
// Cubre el peor caso del plan aleatorio: última oleada (~700ms de retraso) + partícula más lenta.
export const BURST_DURATION_MS = 2600;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function encodeReaction(emoji: ReactionEmoji): Uint8Array {
  return encoder.encode(JSON.stringify({ emoji }));
}

// Cualquier participante puede publicar datos: solo se aceptan emojis de la lista.
export function decodeReaction(payload: Uint8Array): ReactionEmoji | null {
  try {
    const { emoji } = JSON.parse(decoder.decode(payload)) as { emoji?: unknown };
    return REACTION_EMOJIS.find((allowed) => allowed === emoji) ?? null;
  } catch {
    return null;
  }
}

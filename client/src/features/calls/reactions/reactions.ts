import type { BurstPlan } from './burstEffects';

export const REACTIONS_TOPIC = 'reactions';

export const REACTION_EMOJIS = ['💖', '👍', '🎉', '👏', '😂', '😮', '😢', '🤔'] as const;

// Un emoji estándar de REACTION_EMOJIS o un emoji de la sala con la forma `custom:<uuid>`.
export type ReactionKey = string;

const CUSTOM_PREFIX = 'custom:';

export function customReactionKey(id: string): ReactionKey {
  return `${CUSTOM_PREFIX}${id}`;
}

export function customIdOf(key: ReactionKey): string | null {
  return key.startsWith(CUSTOM_PREFIX) ? key.slice(CUSTOM_PREFIX.length) : null;
}

export interface Reaction {
  id: string;
  key: ReactionKey;
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

export function encodeReaction(key: ReactionKey): Uint8Array {
  return encoder.encode(JSON.stringify({ key }));
}

// Cualquier participante puede publicar datos: solo se aceptan los emojis estándar
// y los emojis que existen en la sala.
export function decodeReaction(
  payload: Uint8Array,
  roomEmojiIds: ReadonlySet<string>,
): ReactionKey | null {
  try {
    const { key } = JSON.parse(decoder.decode(payload)) as { key?: unknown };
    if (typeof key !== 'string') return null;
    if (REACTION_EMOJIS.some((emoji) => emoji === key)) return key;
    const customId = customIdOf(key);
    return customId && roomEmojiIds.has(customId) ? key : null;
  } catch {
    return null;
  }
}

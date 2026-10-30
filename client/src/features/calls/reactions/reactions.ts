export const REACTIONS_TOPIC = 'reactions';

export const REACTION_EMOJIS = ['💖', '👍', '🎉', '👏', '😂', '😮', '😢', '🤔'] as const;

export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];

export interface Reaction {
  id: string;
  emoji: ReactionEmoji;
  identity: string;
  name: string;
  at: number;
}

export const REACTION_LIFETIME_MS = 4000;

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

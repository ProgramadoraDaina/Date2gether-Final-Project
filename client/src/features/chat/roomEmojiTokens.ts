import type { RoomEmoji } from '@/lib/api';

export type MessageSegment = { kind: 'text'; text: string } | { kind: 'emoji'; emoji: RoomEmoji };

const TOKEN = /:([a-z0-9_]{2,32}):/g;

// Un `:nombre:` que no existe en la sala queda como texto, igual que en Discord.
export function splitRoomEmojiTokens(
  text: string,
  emojisByName: ReadonlyMap<string, RoomEmoji>,
): MessageSegment[] {
  const segments: MessageSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(TOKEN)) {
    const emoji = emojisByName.get(match[1]);
    if (!emoji) continue;
    if (match.index > last) segments.push({ kind: 'text', text: text.slice(last, match.index) });
    segments.push({ kind: 'emoji', emoji });
    last = match.index + match[0].length;
  }
  if (last < text.length) segments.push({ kind: 'text', text: text.slice(last) });
  return segments;
}

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
    // Los sonidos de sala no tienen imagen: solo se usan desde la botonera, nunca en el chat.
    if (!emoji || emoji.kind !== 'emoji') continue;
    if (match.index > last) segments.push({ kind: 'text', text: text.slice(last, match.index) });
    segments.push({ kind: 'emoji', emoji });
    last = match.index + match[0].length;
  }
  if (last < text.length) segments.push({ kind: 'text', text: text.slice(last) });
  return segments;
}

const MAX_JUMBO_EMOJIS = 3;
const PICTOGRAPHIC = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

// Como en WhatsApp/Discord: un mensaje de pocos emojis solos se muestra grande, tipo sticker.
export function isJumboEmojiMessage(segments: MessageSegment[]): boolean {
  let count = 0;
  for (const segment of segments) {
    if (segment.kind === 'emoji') {
      count++;
      continue;
    }
    for (const { segment: grapheme } of graphemes.segment(segment.text)) {
      if (/^\s+$/u.test(grapheme)) continue;
      if (!PICTOGRAPHIC.test(grapheme)) return false;
      count++;
    }
  }
  return count > 0 && count <= MAX_JUMBO_EMOJIS;
}

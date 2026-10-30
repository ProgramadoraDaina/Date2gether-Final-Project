import { describe, expect, it } from '@jest/globals';
import { customReactionKey, decodeReaction, encodeReaction } from './reactions';

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const ROOM_EMOJI_ID = '3f1c2a9e-7b4d-4e8a-9c1f-2d5e6a7b8c9d';
const roomEmojiIds = new Set([ROOM_EMOJI_ID]);

describe('decodeReaction', () => {
  it('recupera el emoji estándar que se codificó al enviar', () => {
    expect(decodeReaction(encodeReaction('🎉'), roomEmojiIds)).toBe('🎉');
  });

  it('acepta un emoji que existe en la sala', () => {
    const key = customReactionKey(ROOM_EMOJI_ID);
    expect(decodeReaction(encodeReaction(key), roomEmojiIds)).toBe(key);
  });

  it('descarta un emoji de sala que no existe (borrado o de otra sala)', () => {
    const key = customReactionKey('00000000-0000-0000-0000-000000000000');
    expect(decodeReaction(encodeReaction(key), roomEmojiIds)).toBeNull();
  });

  it('descarta emojis estándar fuera de la lista permitida', () => {
    expect(decodeReaction(encode({ key: '💩' }), roomEmojiIds)).toBeNull();
  });

  it('descarta texto que no es una reacción', () => {
    expect(decodeReaction(encode({ key: '<img src=x onerror=alert(1)>' }), roomEmojiIds)).toBeNull();
    expect(decodeReaction(encode({ key: 42 }), roomEmojiIds)).toBeNull();
    expect(decodeReaction(new TextEncoder().encode('no es json'), roomEmojiIds)).toBeNull();
  });
});

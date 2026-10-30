import { describe, expect, it } from '@jest/globals';
import { decodeReaction, encodeReaction } from './reactions';

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

describe('decodeReaction', () => {
  it('recupera el emoji que se codificó al enviar', () => {
    expect(decodeReaction(encodeReaction('🎉'))).toBe('🎉');
  });

  it('descarta emojis fuera de la lista permitida', () => {
    expect(decodeReaction(encode({ emoji: '💩' }))).toBeNull();
  });

  it('descarta texto que no es una reacción', () => {
    expect(decodeReaction(encode({ emoji: '<img src=x onerror=alert(1)>' }))).toBeNull();
    expect(decodeReaction(new TextEncoder().encode('no es json'))).toBeNull();
  });
});
